const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { readAuthToken } = require('../utils/sesi');
require('dotenv').config();

/**
 * Verifikasi sesi.
 *
 * Selain memeriksa tanda tangan token, middleware ini menanyakan dua hal ke
 * database:
 *
 * 1. Apakah akunnya masih ada dan aktif. Token JWT bersifat stateless, jadi
 *    menonaktifkan petugas TIDAK membatalkan token yang sudah dipegang.
 * 2. Apakah sandinya berubah setelah token diterbitkan. Tanpa ini, mengganti
 *    sandi karena curiga akun dibajak tidak mengusir siapa pun - token lama
 *    tetap sah sampai kedaluwarsa.
 */

const AKUN = {
    user: {
        // UNIX_TIMESTAMP dihitung MySQL memakai zona waktu servernya sendiri,
        // sama seperti NOW() yang menuliskannya. Membandingkan angka detik
        // seperti ini kebal terhadap selisih zona waktu antara aplikasi dan
        // database - kalau dibandingkan sebagai objek Date, selisih zona bisa
        // membuat seluruh token dianggap kedaluwarsa.
        sql: `SELECT 1 AS ada, 1 AS aktif,
                     UNIX_TIMESTAMP(password_changed_at) AS sandi_diubah_pada
              FROM users WHERE id = ? LIMIT 1`,
        pesanNonaktif: 'Akun tidak ditemukan.'
    },
    petugas: {
        sql: `SELECT 1 AS ada, is_active AS aktif,
                     UNIX_TIMESTAMP(password_changed_at) AS sandi_diubah_pada,
                     harus_ganti_sandi
              FROM petugas WHERE id = ? LIMIT 1`,
        pesanNonaktif: 'Akun petugas sudah tidak aktif. Silakan hubungi admin.'
    },
    admin: {
        sql: `SELECT 1 AS ada, 1 AS aktif,
                     UNIX_TIMESTAMP(password_changed_at) AS sandi_diubah_pada
              FROM admin WHERE id = ? LIMIT 1`,
        pesanNonaktif: 'Akun admin sudah tidak tersedia.'
    }
};

// Endpoint yang tetap boleh diakses petugas yang belum mengganti sandi awalnya.
const BOLEH_SAAT_WAJIB_GANTI = new Set([
    '/api/auth/ganti-sandi',
    '/api/auth/logout'
]);

const ACCOUNT_STATUS_TTL_MS = Number(process.env.ACCOUNT_STATUS_TTL_MS || 30000);
const ACCOUNT_STATUS_MAX_ENTRIES = 500;
const accountStatusCache = new Map();

const cacheKey = (role, id) => `${role}:${id}`;

function invalidateAccountStatus(role, id) {
    accountStatusCache.delete(cacheKey(role, id));
}

async function statusAkun(role, id) {
    const config = AKUN[role];
    if (!config) return null;

    const key = cacheKey(role, id);
    const cached = accountStatusCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.status;

    const [rows] = await pool.query(config.sql, [id]);
    const row = rows[0];
    const status = {
        ada: Boolean(row),
        aktif: Boolean(row) && Number(row.aktif) === 1,
        sandiDiubahPada: row && row.sandi_diubah_pada !== null
            ? Number(row.sandi_diubah_pada)
            : null,
        harusGantiSandi: Boolean(row) && Number(row.harus_ganti_sandi || 0) === 1
    };

    if (accountStatusCache.size >= ACCOUNT_STATUS_MAX_ENTRIES) accountStatusCache.clear();
    accountStatusCache.set(key, { status, expiresAt: Date.now() + ACCOUNT_STATUS_TTL_MS });
    return status;
}

const verifyToken = (role) => async (req, res, next) => {
    const { token } = readAuthToken(req);
    if (!token) return res.status(401).json({ message: 'Token tidak ditemukan' });

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return res.status(401).json({ message: 'Token tidak valid' });
    }

    const allowedRoles = Array.isArray(role) ? role : [role];
    if (role && !allowedRoles.includes(decoded.role)) {
        return res.status(403).json({ message: 'Akses ditolak' });
    }

    const status = await statusAkun(decoded.role, decoded.id);
    if (status) {
        if (!status.ada || !status.aktif) {
            return res.status(401).json({
                message: AKUN[decoded.role].pesanNonaktif,
                code: 'ACCOUNT_INACTIVE'
            });
        }

        // Dibandingkan pada satuan detik karena klaim `iat` memang dibulatkan
        // ke bawah. Kalau dibandingkan sampai milidetik, pengguna yang baru
        // saja mengganti sandinya sendiri justru ikut terlempar keluar.
        if (status.sandiDiubahPada !== null && status.sandiDiubahPada > Number(decoded.iat || 0)) {
            return res.status(401).json({
                message: 'Sandi akun telah diubah. Silakan masuk kembali.',
                code: 'SESSION_REVOKED'
            });
        }

        if (status.harusGantiSandi && !BOLEH_SAAT_WAJIB_GANTI.has(req.originalUrl.split('?')[0])) {
            return res.status(403).json({
                message: 'Anda wajib mengganti sandi sebelum memakai sistem.',
                code: 'WAJIB_GANTI_SANDI'
            });
        }
    }

    req.user = decoded;
    next();
};

module.exports = verifyToken;
module.exports.invalidateAccountStatus = invalidateAccountStatus;
module.exports.statusAkun = statusAkun;
