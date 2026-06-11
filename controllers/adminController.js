const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { ensureNotificationSchema } = require('../utils/notifikasi');
const { serverError } = require('../utils/http');

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
    const { nip, nama_lengkap, email, no_hp, password } = req.body;
    if (!nip || !nama_lengkap || !email || !no_hp || !password)
        return res.status(400).json({ message: 'Semua field wajib diisi' });

    try {
        const [exist] = await pool.query(
            'SELECT id FROM petugas WHERE nip = ? OR email = ?', [nip, email]
        );
        if (exist.length > 0)
            return res.status(409).json({ message: 'NIP atau email sudah terdaftar' });

        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO petugas (nip, nama_lengkap, email, no_hp, password) VALUES (?, ?, ?, ?, ?)',
            [nip, nama_lengkap, email, no_hp, hash]
        );
        res.status(201).json({ message: 'Petugas berhasil ditambahkan' });
    } catch (err) {
        return serverError(res, err);
    }
};

// EDIT PETUGAS
const editPetugas = async (req, res) => {
    const { id } = req.params;
    const { nama_lengkap, email, no_hp, password } = req.body;

    try {
        if (password) {
            const hash = await bcrypt.hash(password, 10);
            await pool.query(
                'UPDATE petugas SET nama_lengkap=?, email=?, no_hp=?, password=?, updated_at=NOW() WHERE id=?',
                [nama_lengkap, email, no_hp, hash, id]
            );
        } else {
            await pool.query(
                'UPDATE petugas SET nama_lengkap=?, email=?, no_hp=?, updated_at=NOW() WHERE id=?',
                [nama_lengkap, email, no_hp, id]
            );
        }
        res.json({ message: 'Data petugas berhasil diupdate' });
    } catch (err) {
        return serverError(res, err);
    }
};

// AKTIFKAN / NONAKTIFKAN PETUGAS
const togglePetugas = async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query(
            'UPDATE petugas SET is_active = NOT is_active, updated_at = NOW() WHERE id = ?', [id]
        );
        res.json({ message: 'Status petugas berhasil diubah' });
    } catch (err) {
        return serverError(res, err);
    }
};

// LIHAT KUOTA
const getKuota = async (req, res) => {
    const { tanggal } = req.query;
    if (!tanggal)
        return res.status(400).json({ message: 'Tanggal wajib diisi' });

    try {
        const [kec] = await pool.query(
            `SELECT kk.*, k.nama_kecamatan
       FROM kuota_kecamatan kk
       JOIN kecamatan k ON kk.kecamatan_id = k.id
       WHERE kk.tanggal = ?`, [tanggal]
        );
        const [kel] = await pool.query(
            `SELECT kk.*, k.nama_kelurahan, kc.nama_kecamatan
       FROM kuota_kelurahan kk
       JOIN kelurahan k ON kk.kelurahan_id = k.id
       JOIN kecamatan kc ON k.kecamatan_id = kc.id
       WHERE kk.tanggal = ?`, [tanggal]
        );
        const [pet] = await pool.query(
            `SELECT kp.*, p.nama_lengkap, p.nip
       FROM kuota_petugas kp
       JOIN petugas p ON kp.petugas_id = p.id
       WHERE kp.tanggal = ?`, [tanggal]
        );
        res.json({ kecamatan: kec, kelurahan: kel, petugas: pet });
    } catch (err) {
        return serverError(res, err);
    }
};

// SET KUOTA
const setKuota = async (req, res) => {
    const { tipe, id, tanggal, kuota_max, is_unlimited } = req.body;
    if (!tipe || !id || !tanggal)
        return res.status(400).json({ message: 'tipe, id, dan tanggal wajib diisi' });

    try {
        if (tipe === 'kecamatan') {
            await pool.query(
                `INSERT INTO kuota_kecamatan (kecamatan_id, tanggal, kuota_max, terisi, is_unlimited)
         VALUES (?, ?, ?, 0, ?)
         ON DUPLICATE KEY UPDATE kuota_max = VALUES(kuota_max), is_unlimited = VALUES(is_unlimited)`,
                [id, tanggal, kuota_max || 10, is_unlimited ? 1 : 0]
            );
        } else if (tipe === 'kelurahan') {
            await pool.query(
                `INSERT INTO kuota_kelurahan (kelurahan_id, tanggal, kuota_max, terisi, is_unlimited)
         VALUES (?, ?, ?, 0, ?)
         ON DUPLICATE KEY UPDATE kuota_max = VALUES(kuota_max), is_unlimited = VALUES(is_unlimited)`,
                [id, tanggal, kuota_max || 10, is_unlimited ? 1 : 0]
            );
        } else if (tipe === 'petugas') {
            await pool.query(
                `INSERT INTO kuota_petugas (petugas_id, tanggal, kuota_max, terisi)
         VALUES (?, ?, ?, 0)
         ON DUPLICATE KEY UPDATE kuota_max = VALUES(kuota_max)`,
                [id, tanggal, kuota_max || 10]
            );
        } else {
            return res.status(400).json({ message: 'Tipe tidak valid' });
        }
        res.json({ message: 'Kuota berhasil diset' });
    } catch (err) {
        return serverError(res, err);
    }
};

// GET WILAYAH (untuk dropdown form booking)
const getWilayah = async (req, res) => {
    try {
        const [kecamatan] = await pool.query('SELECT * FROM kecamatan ORDER BY nama_kecamatan');
        const [kelurahan] = await pool.query(
            'SELECT * FROM kelurahan ORDER BY nama_kelurahan'
        );
        res.json({ kecamatan, kelurahan });
    } catch (err) {
        return serverError(res, err);
    }
};

const hapusPetugas = async (req, res) => {
    const { id } = req.params;
    try {
        // Cek apakah petugas punya booking aktif
        const [aktif] = await pool.query(
            `SELECT COUNT(*) as total FROM bookings 
       WHERE petugas_id = ? AND status NOT IN ('selesai', 'ditolak', 'dibatalkan')`,
            [id]
        );
        if (aktif[0].total > 0) {
            return res.status(400).json({
                message: `Petugas tidak dapat dihapus karena masih memiliki ${aktif[0].total} berkas aktif.`
            });
        }
        await pool.query('DELETE FROM petugas WHERE id = ?', [id]);
        res.json({ message: 'Petugas berhasil dihapus' });
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

        // Riwayat reschedule
        const [reschedule] = await pool.query(
            `SELECT * FROM reschedule_log WHERE booking_id = ? ORDER BY created_at ASC`, [id]
        );

        // Hasil pemeriksaan kalau ada
        const [hasil] = await pool.query(
            `SELECT * FROM hasil_pemeriksaan WHERE booking_id = ?`, [id]
        );

        // Notifikasi yang dikirim untuk berkas ini
        await ensureNotificationSchema();
        const [notif] = await pool.query(
            `SELECT judul, pesan, created_at FROM notifications 
             WHERE booking_id = ? ORDER BY created_at ASC`, [id]
        );

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
    getWilayah, hapusPetugas, getDetailBerkas, hapusBerkas
};
