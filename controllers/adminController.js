const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { ensureNotificationSchema } = require('../utils/notifikasi');
const { serverError } = require('../utils/http');
const {
    requireIndonesianPhone,
    assertPhoneAvailable,
    acquirePhoneLock,
    releasePhoneLock,
    ensurePhoneSchema
} = require('../utils/phone');
const {
    ensureQuotaSchema,
    setKuotaHarian,
    setKuotaRentang,
    isDateOnly
} = require('../utils/kuota');

// Validasi sisi server untuk data petugas (defense-in-depth, tidak hanya klien).
const NIP_REGEX = /^\d{18}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function validatePetugasInput({ nip, nama_lengkap, email, password, requirePassword }) {
    if (!NIP_REGEX.test(String(nip || '')))
        return 'NIP harus terdiri dari 18 digit angka';
    if (String(nama_lengkap || '').trim().length < 3)
        return 'Nama lengkap minimal 3 karakter';
    if (!EMAIL_REGEX.test(String(email || '').trim()))
        return 'Format email tidak valid';
    if (requirePassword && String(password || '').length < 6)
        return 'Password minimal 6 karakter';
    if (!requirePassword && password && String(password).length < 6)
        return 'Password minimal 6 karakter';
    return null;
}

// SEMUA BOOKINGS
const getAllBookings = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT b.*,
        k.nama_kecamatan, kel.nama_kelurahan,
        p.nama_lengkap AS nama_petugas,
        u.nama_lengkap AS nama_user, u.email AS email_user
       FROM bookings b
       JOIN kecamatan k ON b.kecamatan_id = k.id
       JOIN kelurahan kel ON b.kelurahan_id = kel.id
       JOIN petugas p ON b.petugas_id = p.id
       JOIN users u ON b.user_id = u.id
       ORDER BY b.created_at DESC`
        );
        res.json(rows);
    } catch (err) {
        return serverError(res, err);
    }
};

// SEMUA PETUGAS
const getAllPetugas = async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, nip, nama_lengkap, email, no_hp, is_active, created_at FROM petugas ORDER BY nama_lengkap'
        );
        res.json(rows);
    } catch (err) {
        return serverError(res, err);
    }
};

// TAMBAH PETUGAS
const tambahPetugas = async (req, res) => {
    const { nip, nama_lengkap, email, password } = req.body;
    if (!nip || !nama_lengkap || !email || !req.body.no_hp || !password)
        return res.status(400).json({ message: 'Semua field wajib diisi' });

    const validationError = validatePetugasInput({ nip, nama_lengkap, email, password, requirePassword: true });
    if (validationError)
        return res.status(400).json({ message: validationError });

    let no_hp;
    try {
        no_hp = requireIndonesianPhone(req.body.no_hp);
    } catch (err) {
        return res.status(err.status || 400).json({ message: err.message, code: err.code });
    }

    let connection;
    let phoneLockName = null;
    try {
        await ensurePhoneSchema();
        connection = await pool.getConnection();
        phoneLockName = await acquirePhoneLock(connection, no_hp);
        await connection.beginTransaction();

        const [exist] = await connection.query(
            'SELECT id FROM petugas WHERE nip = ? OR email = ?', [nip, email]
        );
        if (exist.length > 0) {
            await connection.rollback();
            return res.status(409).json({ message: 'NIP atau email sudah terdaftar' });
        }
        await assertPhoneAvailable(connection, no_hp);

        const hash = await bcrypt.hash(password, 10);
        const [result] = await connection.query(
            'INSERT INTO petugas (nip, nama_lengkap, email, no_hp, password) VALUES (?, ?, ?, ?, ?)',
            [nip, nama_lengkap, email, no_hp, hash]
        );
        await connection.commit();
        res.status(201).json({
            message: 'Petugas berhasil ditambahkan',
            petugas: {
                id: result.insertId,
                nip,
                nama_lengkap,
                email,
                no_hp,
                is_active: 1
            }
        });
    } catch (err) {
        if (connection) {
            try {
                await connection.rollback();
            } catch {}
        }
        if (err.status) {
            return res.status(err.status).json({ message: err.message, code: err.code });
        }
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                message: 'NIP, email, atau nomor HP sudah terdaftar.',
                code: 'ACCOUNT_DATA_ALREADY_REGISTERED'
            });
        }
        return serverError(res, err);
    } finally {
        await releasePhoneLock(connection, phoneLockName);
        connection?.release();
    }
};

// EDIT PETUGAS
const editPetugas = async (req, res) => {
    const { id } = req.params;
    const { nip, nama_lengkap, email, password } = req.body;

    if (!nip || !nama_lengkap || !email || !req.body.no_hp) {
        return res.status(400).json({ message: 'NIP, nama, email, dan nomor HP wajib diisi' });
    }

    const validationError = validatePetugasInput({ nip, nama_lengkap, email, password, requirePassword: false });
    if (validationError)
        return res.status(400).json({ message: validationError });

    let no_hp;
    try {
        no_hp = requireIndonesianPhone(req.body.no_hp);
    } catch (err) {
        return res.status(err.status || 400).json({ message: err.message, code: err.code });
    }

    let connection;
    let phoneLockName = null;
    try {
        await ensurePhoneSchema();
        connection = await pool.getConnection();
        phoneLockName = await acquirePhoneLock(connection, no_hp);
        await connection.beginTransaction();

        const [conflict] = await connection.query(
            'SELECT id, nip, email FROM petugas WHERE (email = ? OR nip = ?) AND id <> ? LIMIT 1',
            [email, nip, id]
        );
        if (conflict.length > 0) {
            await connection.rollback();
            const message = String(conflict[0].nip) === String(nip)
                ? 'NIP sudah digunakan petugas lain.'
                : 'Email sudah digunakan petugas lain.';
            return res.status(409).json({ message });
        }
        await assertPhoneAvailable(connection, no_hp, { excludePetugasId: id });

        if (password) {
            const hash = await bcrypt.hash(password, 10);
            await connection.query(
                'UPDATE petugas SET nip=?, nama_lengkap=?, email=?, no_hp=?, password=?, updated_at=NOW() WHERE id=?',
                [nip, nama_lengkap, email, no_hp, hash, id]
            );
        } else {
            await connection.query(
                'UPDATE petugas SET nip=?, nama_lengkap=?, email=?, no_hp=?, updated_at=NOW() WHERE id=?',
                [nip, nama_lengkap, email, no_hp, id]
            );
        }
        await connection.commit();
        res.json({
            message: 'Data petugas berhasil diupdate',
            petugas: { id: Number(id), nip, nama_lengkap, email, no_hp }
        });
    } catch (err) {
        if (connection) {
            try {
                await connection.rollback();
            } catch {}
        }
        if (err.status) {
            return res.status(err.status).json({ message: err.message, code: err.code });
        }
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                message: 'Email atau nomor HP sudah digunakan akun lain.',
                code: 'ACCOUNT_DATA_ALREADY_REGISTERED'
            });
        }
        return serverError(res, err);
    } finally {
        await releasePhoneLock(connection, phoneLockName);
        connection?.release();
    }
};

// AKTIFKAN / NONAKTIFKAN PETUGAS
const togglePetugas = async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query(
            'UPDATE petugas SET is_active = NOT is_active, updated_at = NOW() WHERE id = ?', [id]
        );
        const [rows] = await pool.query(
            'SELECT id, is_active FROM petugas WHERE id = ?',
            [id]
        );
        res.json({
            message: 'Status petugas berhasil diubah',
            petugas: rows[0] || null
        });
    } catch (err) {
        return serverError(res, err);
    }
};

function mapRowsBy(rows, key) {
    return new Map(rows.map(row => [String(row[key]), row]));
}

function buildEffectiveQuotaRow(base, dateQuota, defaultQuota, supportsUnlimited) {
    const dateOrder = Number(dateQuota?.set_order || 0);
    const defaultOrder = Number(defaultQuota?.set_order || 0);
    const defaultWins = defaultQuota && (!dateQuota || defaultOrder >= dateOrder);
    const active = defaultWins ? defaultQuota : dateQuota;

    if (!active) {
        return {
            ...base,
            configured: true,
            kuota_max: 0,
            terisi: Number(dateQuota?.terisi || 0),
            is_unlimited: 1
        };
    }

    return {
        ...base,
        configured: true,
        kuota_max: active.kuota_max,
        terisi: Number(dateQuota?.terisi || 0),
        is_unlimited: supportsUnlimited && active.is_unlimited ? 1 : 0
    };
}

// LIHAT KUOTA
const getKuota = async (req, res) => {
    const { tanggal, kecamatan_id } = req.query;
    if (!tanggal)
        return res.status(400).json({ message: 'Tanggal wajib diisi' });

    try {
        await ensureQuotaSchema();

        const kelParams = [];
        let kelWhere = '';
        if (kecamatan_id) {
            kelWhere = 'WHERE k.kecamatan_id = ?';
            kelParams.push(kecamatan_id);
        }
        const [
            [kecamatanTargets],
            [kecTanggal],
            [kecDefault],
            [kelurahanTargets],
            [kelTanggal],
            [kelDefault],
            [petugasTargets],
            [petTanggal],
            [petDefault]
        ] = await Promise.all([
            pool.query(
                `SELECT id AS kecamatan_id, nama_kecamatan
                 FROM kecamatan
                 ORDER BY nama_kecamatan`
            ),
            pool.query(
                `SELECT kecamatan_id, kuota_max, terisi, is_unlimited, set_order
                 FROM kuota_kecamatan
                 WHERE tanggal = ?`,
                [tanggal]
            ),
            pool.query(
                `SELECT target_id AS kecamatan_id, kuota_max, is_unlimited, set_order
                 FROM kuota_default
                 WHERE tipe = 'kecamatan'`
            ),
            pool.query(
                `SELECT
                    k.id AS kelurahan_id,
                    k.nama_kelurahan,
                    k.kecamatan_id,
                    kc.nama_kecamatan
                 FROM kelurahan k
                 JOIN kecamatan kc ON k.kecamatan_id = kc.id
                 ${kelWhere}
                 ORDER BY kc.nama_kecamatan, k.nama_kelurahan`,
                kelParams
            ),
            pool.query(
                `SELECT kelurahan_id, kuota_max, terisi, is_unlimited, set_order
                 FROM kuota_kelurahan
                 WHERE tanggal = ?`,
                [tanggal]
            ),
            pool.query(
                `SELECT target_id AS kelurahan_id, kuota_max, is_unlimited, set_order
                 FROM kuota_default
                 WHERE tipe = 'kelurahan'`
            ),
            pool.query(
                `SELECT id AS petugas_id, nip, nama_lengkap
                 FROM petugas
                 WHERE is_active = 1
                 ORDER BY nama_lengkap`
            ),
            pool.query(
                `SELECT petugas_id, kuota_max, terisi, 0 AS is_unlimited, set_order
                 FROM kuota_petugas
                 WHERE tanggal = ?`,
                [tanggal]
            ),
            pool.query(
                `SELECT target_id AS petugas_id, kuota_max, 0 AS is_unlimited, set_order
                 FROM kuota_default
                 WHERE tipe = 'petugas'`
            )
        ]);

        const kecTanggalMap = mapRowsBy(kecTanggal, 'kecamatan_id');
        const kecDefaultMap = mapRowsBy(kecDefault, 'kecamatan_id');
        const kelTanggalMap = mapRowsBy(kelTanggal, 'kelurahan_id');
        const kelDefaultMap = mapRowsBy(kelDefault, 'kelurahan_id');
        const petTanggalMap = mapRowsBy(petTanggal, 'petugas_id');
        const petDefaultMap = mapRowsBy(petDefault, 'petugas_id');

        res.json({
            kecamatan: kecamatanTargets.map(item => buildEffectiveQuotaRow(
                item,
                kecTanggalMap.get(String(item.kecamatan_id)),
                kecDefaultMap.get(String(item.kecamatan_id)),
                true
            )),
            kelurahan: kelurahanTargets.map(item => buildEffectiveQuotaRow(
                item,
                kelTanggalMap.get(String(item.kelurahan_id)),
                kelDefaultMap.get(String(item.kelurahan_id)),
                true
            )),
            petugas: petugasTargets.map(item => buildEffectiveQuotaRow(
                item,
                petTanggalMap.get(String(item.petugas_id)),
                petDefaultMap.get(String(item.petugas_id)),
                false
            ))
        });
    } catch (err) {
        return serverError(res, err);
    }
};

// SET KUOTA
const setKuota = async (req, res) => {
    const {
        tipe,
        id,
        tanggal,
        tanggal_mulai,
        tanggal_selesai,
        kuota_max,
        is_unlimited,
        mode = 'range'
    } = req.body;
    if (!tipe || !id)
        return res.status(400).json({ message: 'tipe dan target wajib diisi' });

    try {
        if (mode === 'daily') {
            await setKuotaHarian({ tipe, id, kuota_max, is_unlimited });
            return res.json({ message: 'Kuota setiap hari berhasil diset' });
        }

        const mulai = tanggal_mulai || tanggal;
        const selesai = tanggal_selesai || mulai;
        if (!isDateOnly(mulai) || !isDateOnly(selesai)) {
            return res.status(400).json({ message: 'Tanggal mulai dan selesai wajib diisi' });
        }

        const total = await setKuotaRentang({
            tipe,
            id,
            tanggal_mulai: mulai,
            tanggal_selesai: selesai,
            kuota_max,
            is_unlimited
        });
        res.json({ message: `Kuota berhasil diset untuk ${total} hari` });
    } catch (err) {
        if (err.message && (
            err.message.includes('Tipe kuota') ||
            err.message.includes('Kuota') ||
            err.message.includes('tanggal') ||
            err.message.includes('Rentang')
        )) {
            return res.status(400).json({ message: err.message });
        }
        return serverError(res, err);
    }
};

// GET WILAYAH (untuk dropdown form booking)
const getWilayah = async (req, res) => {
    try {
        const [[kecamatan], [kelurahan]] = await Promise.all([
            pool.query('SELECT * FROM kecamatan ORDER BY nama_kecamatan'),
            pool.query('SELECT * FROM kelurahan ORDER BY nama_kelurahan')
        ]);
        res.json({ kecamatan, kelurahan });
    } catch (err) {
        return serverError(res, err);
    }
};

const getDetailBerkas = async (req, res) => {
    const { id } = req.params;
    try {
        // Data booking lengkap
        const [booking] = await pool.query(
            `SELECT b.*,
                k.nama_kecamatan, kel.nama_kelurahan,
                p.nama_lengkap AS nama_petugas, p.nip,
                u.nama_lengkap AS nama_user, u.email AS email_user, u.no_hp
             FROM bookings b
             JOIN kecamatan k ON b.kecamatan_id = k.id
             JOIN kelurahan kel ON b.kelurahan_id = kel.id
             JOIN petugas p ON b.petugas_id = p.id
             JOIN users u ON b.user_id = u.id
             WHERE b.id = ?`, [id]
        );
        if (booking.length === 0)
            return res.status(404).json({ message: 'Berkas tidak ditemukan' });

        const [[reschedule], [hasil], [notif]] = await Promise.all([
            pool.query(
                'SELECT * FROM reschedule_log WHERE booking_id = ? ORDER BY created_at ASC',
                [id]
            ),
            pool.query('SELECT * FROM hasil_pemeriksaan WHERE booking_id = ?', [id]),
            ensureNotificationSchema().then(() => pool.query(
                `SELECT judul, pesan, created_at FROM notifications
                 WHERE booking_id = ? ORDER BY created_at ASC`,
                [id]
            ))
        ]);

        res.json({
            booking: booking[0],
            reschedule_log: reschedule,
            hasil: hasil[0] || null,
            notifikasi: notif
        });
    } catch (err) {
        return serverError(res, err);
    }
};

const hapusBerkas = async (req, res) => {
    const { id } = req.params;
    const { confirmation } = req.body || {};

    if (confirmation !== 'HAPUS') {
        return res.status(400).json({ message: 'Konfirmasi wajib mengetik HAPUS dengan huruf besar' });
    }

    const conn = await pool.getConnection();
    let filesToDelete = [];

    try {
        await conn.beginTransaction();

        const [rows] = await conn.query(
            'SELECT * FROM bookings WHERE id = ? FOR UPDATE',
            [id]
        );
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Berkas tidak ditemukan' });
        }

        const booking = rows[0];
        const [hasilRows] = await conn.query(
            'SELECT foto_lokasi, foto_risalah FROM hasil_pemeriksaan WHERE booking_id = ?',
            [id]
        );
        if (hasilRows[0]) {
            filesToDelete = [hasilRows[0].foto_lokasi, hasilRows[0].foto_risalah].filter(Boolean);
        }

        if (!['ditolak', 'dibatalkan'].includes(booking.status)) {
            await conn.query(
                'UPDATE kuota_kecamatan SET terisi = GREATEST(terisi - 1, 0) WHERE kecamatan_id = ? AND tanggal = ?',
                [booking.kecamatan_id, booking.tanggal_diminta]
            );
            await conn.query(
                'UPDATE kuota_kelurahan SET terisi = GREATEST(terisi - 1, 0) WHERE kelurahan_id = ? AND tanggal = ?',
                [booking.kelurahan_id, booking.tanggal_diminta]
            );
            await conn.query(
                'UPDATE kuota_petugas SET terisi = GREATEST(terisi - 1, 0) WHERE petugas_id = ? AND tanggal = ?',
                [booking.petugas_id, booking.tanggal_diminta]
            );
        }

        await ensureNotificationSchema();
        await conn.query('DELETE FROM notifications WHERE booking_id = ?', [id]);
        await conn.query('DELETE FROM hasil_pemeriksaan WHERE booking_id = ?', [id]);
        await conn.query('DELETE FROM reschedule_log WHERE booking_id = ?', [id]);
        await conn.query('DELETE FROM bookings WHERE id = ?', [id]);

        await conn.commit();

        await Promise.all(filesToDelete.map(async (file) => {
            const uploadPath = path.join(__dirname, '..', 'public', 'uploads', path.basename(file));
            try {
                await fs.promises.unlink(uploadPath);
            } catch {
                // File fisik boleh sudah tidak ada; data database tetap sudah dibersihkan.
            }
        }));

        res.json({ message: 'Berkas berhasil dihapus permanen' });
    } catch (err) {
        await conn.rollback();
        return serverError(res, err);
    } finally {
        conn.release();
    }
};

module.exports = {
    getAllBookings, getAllPetugas, tambahPetugas,
    editPetugas, togglePetugas, getKuota, setKuota,
    getWilayah, getDetailBerkas, hapusBerkas
};
