const jwt = require('jsonwebtoken');
const pool = require('../config/db');
require('dotenv').config();

// Peran istimewa yang statusnya harus diperiksa ulang ke database.
//
// Token JWT bersifat stateless: menonaktifkan atau menghapus petugas TIDAK
// membatalkan token yang sudah terlanjur dipegang. Tanpa pemeriksaan ini,
// petugas yang baru dinonaktifkan admin masih bisa mengonfirmasi jadwal dan
// menginput hasil sampai tokennya kedaluwarsa (default 1 hari).
const VERIFIED_ROLES = {
    petugas: {
        sql: 'SELECT is_active FROM petugas WHERE id = ? LIMIT 1',
        isActive: (row) => Number(row.is_active) === 1,
        message: 'Akun petugas sudah tidak aktif. Silakan hubungi admin.'
    },
    admin: {
        sql: 'SELECT id FROM admin WHERE id = ? LIMIT 1',
        isActive: () => true,
        message: 'Akun admin sudah tidak tersedia.'
    }
};

// Cache singkat agar tidak menambah satu query ke setiap request; dengan pool
// koneksi yang kecil, biayanya terasa. Konsekuensinya penonaktifan berlaku
// paling lambat setelah TTL ini - kecuali cache dibersihkan lebih dulu lewat
// invalidateAccountStatus() saat admin mengubah data petugas.
const ACCOUNT_STATUS_TTL_MS = Number(process.env.ACCOUNT_STATUS_TTL_MS || 30000);
const ACCOUNT_STATUS_MAX_ENTRIES = 500;
const accountStatusCache = new Map();

const cacheKey = (role, id) => `${role}:${id}`;

function invalidateAccountStatus(role, id) {
    accountStatusCache.delete(cacheKey(role, id));
}

async function isAccountUsable(role, id) {
    const config = VERIFIED_ROLES[role];
    if (!config) return true;

    const key = cacheKey(role, id);
    const cached = accountStatusCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.usable;

    const [rows] = await pool.query(config.sql, [id]);
    const usable = rows.length > 0 && config.isActive(rows[0]);

    // Pembersihan sederhana supaya cache tidak tumbuh tanpa batas.
    if (accountStatusCache.size >= ACCOUNT_STATUS_MAX_ENTRIES) {
        accountStatusCache.clear();
    }
    accountStatusCache.set(key, { usable, expiresAt: Date.now() + ACCOUNT_STATUS_TTL_MS });
    return usable;
}

const verifyToken = (role) => async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

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

    // Kegagalan database di sini sengaja dibiarkan naik ke error handler agar
    // terlaporkan sebagai 503, bukan diam-diam meloloskan akun yang sudah mati.
    if (!(await isAccountUsable(decoded.role, decoded.id))) {
        return res.status(401).json({
            message: VERIFIED_ROLES[decoded.role].message,
            code: 'ACCOUNT_INACTIVE'
        });
    }

    req.user = decoded;
    next();
};

module.exports = verifyToken;
module.exports.invalidateAccountStatus = invalidateAccountStatus;
