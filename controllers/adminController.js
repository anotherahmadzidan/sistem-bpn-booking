const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { ensureNotificationSchema } = require('../utils/notifikasi');
const { serverError } = require('../utils/http');
const {
    ensureQuotaSchema,
    setKuotaHarian,
    setKuotaRentang,
    isDateOnly
} = require('../utils/kuota');

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

        const [kecamatanTargets] = await pool.query(
            `SELECT id AS kecamatan_id, nama_kecamatan
             FROM kecamatan
             ORDER BY nama_kecamatan`
        );
        const [kecTanggal] = await pool.query(
            `SELECT kecamatan_id, kuota_max, terisi, is_unlimited, set_order
             FROM kuota_kecamatan
             WHERE tanggal = ?`,
            [tanggal]
        );
        const [kecDefault] = await pool.query(
            `SELECT target_id AS kecamatan_id, kuota_max, is_unlimited, set_order
             FROM kuota_default
             WHERE tipe = 'kecamatan'`
        );

        const kelParams = [];
        let kelWhere = '';
        if (kecamatan_id) {
            kelWhere = 'WHERE k.kecamatan_id = ?';
            kelParams.push(kecamatan_id);
        }
        const [kelurahanTargets] = await pool.query(
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
        );
        const [kelTanggal] = await pool.query(
            `SELECT kelurahan_id, kuota_max, terisi, is_unlimited, set_order
             FROM kuota_kelurahan
             WHERE tanggal = ?`,
            [tanggal]
        );
        const [kelDefault] = await pool.query(
            `SELECT target_id AS kelurahan_id, kuota_max, is_unlimited, set_order
             FROM kuota_default
             WHERE tipe = 'kelurahan'`
        );

        const [petugasTargets] = await pool.query(
            `SELECT id AS petugas_id, nip, nama_lengkap
             FROM petugas
             WHERE is_active = 1
             ORDER BY nama_lengkap`
        );
        const [petTanggal] = await pool.query(
            `SELECT petugas_id, kuota_max, terisi, 0 AS is_unlimited, set_order
             FROM kuota_petugas
             WHERE tanggal = ?`,
            [tanggal]
        );
        const [petDefault] = await pool.query(
            `SELECT target_id AS petugas_id, kuota_max, 0 AS is_unlimited, set_order
             FROM kuota_default
             WHERE tipe = 'petugas'`
        );

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
