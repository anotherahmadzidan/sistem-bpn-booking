const pool = require('../config/db');
const { kirimNotifikasi, kirimNotifikasiAdmin } = require('../utils/notifikasi');
const { serverError } = require('../utils/http');
const { reserveKuotaAktif, kurangiKuotaAktif } = require('../utils/kuota');

const formatTgl = (d) => new Date(d).toLocaleDateString('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric'
});

const escapeHTML = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const isDateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

const todayWita = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
}).format(new Date());

const isPastDate = (value) => isDateOnly(value) && value < todayWita();

// LIHAT DAFTAR TUGAS MASUK
const getTugas = async (req, res) => {
    const petugas_id = req.user.id;
    try {
        const [rows] = await pool.query(
            `SELECT b.*,
        k.nama_kecamatan, kel.nama_kelurahan,
        u.nama_lengkap AS nama_user, u.email AS email_user
       FROM bookings b
       JOIN kecamatan k ON b.kecamatan_id = k.id
       JOIN kelurahan kel ON b.kelurahan_id = kel.id
       JOIN users u ON b.user_id = u.id
       WHERE b.petugas_id = ?
       ORDER BY b.created_at DESC`,
            [petugas_id]
        );
        res.json(rows);
    } catch (err) {
        return serverError(res, err);
    }
};

// KONFIRMASI JADWAL
const konfirmasiJadwal = async (req, res) => {
    const { id } = req.params;
    const petugas_id = req.user.id;
    try {
        const [rows] = await pool.query(
            'SELECT * FROM bookings WHERE id = ? AND petugas_id = ?', [id, petugas_id]
        );
        if (rows.length === 0)
            return res.status(404).json({ message: 'Booking tidak ditemukan' });

        const booking = rows[0];
        if (!['pending', 'rescheduled_by_user'].includes(booking.status))
            return res.status(403).json({ message: 'Status tidak memungkinkan konfirmasi' });

        await pool.query(
            `UPDATE bookings SET status = 'jadwal_fix', tanggal_fix = tanggal_diminta,
       updated_at = NOW() WHERE id = ?`, [id]
        );

        // Kirim notifikasi
        const [userRows] = await pool.query(
            `SELECT u.email FROM users u WHERE u.id = ?`, [booking.user_id]
        );
        await kirimNotifikasi({
            user_id: booking.user_id,
            booking_id: parseInt(id),
            judul: 'Jadwal Pemeriksaan Dikonfirmasi',
            pesan: `Jadwal pemeriksaan berkas <strong>${booking.nomor_berkas}</strong> telah dikonfirmasi. Peninjauan dilakukan pada <strong>${formatTgl(booking.tanggal_diminta)}</strong>.`,
            email_user: userRows[0]?.email,
            nomor_berkas: booking.nomor_berkas
        });
        await kirimNotifikasiAdmin({
            booking_id: parseInt(id),
            judul: 'Jadwal Pemeriksaan Dikonfirmasi',
            pesan: `Petugas mengonfirmasi jadwal pemeriksaan berkas <strong>${booking.nomor_berkas}</strong> pada <strong>${formatTgl(booking.tanggal_diminta)}</strong>.`,
            nomor_berkas: booking.nomor_berkas
        });

        res.json({ message: 'Jadwal dikonfirmasi' });
    } catch (err) {
        return serverError(res, err);
    }
};

// TOLAK & GANTI JADWAL OLEH PETUGAS
const tolakJadwal = async (req, res) => {
    const { id } = req.params;
    const { tanggal_baru } = req.body;
    const alasan = (req.body.alasan || '').trim();
    const petugas_id = req.user.id;

    if (!tanggal_baru)
        return res.status(400).json({ message: 'Tanggal baru wajib diisi' });
    if (!isDateOnly(tanggal_baru))
        return res.status(400).json({ message: 'Format tanggal baru tidak valid' });
    if (isPastDate(tanggal_baru))
        return res.status(400).json({ message: 'Tanggal baru tidak boleh tanggal yang sudah lewat' });
    if (!alasan)
        return res.status(400).json({ message: 'Alasan penggantian jadwal wajib diisi' });

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.query(
            'SELECT * FROM bookings WHERE id = ? AND petugas_id = ? FOR UPDATE',
            [id, petugas_id]
        );
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Booking tidak ditemukan' });
        }

        const booking = rows[0];
        if (!['pending', 'rescheduled_by_user'].includes(booking.status)) {
            await conn.rollback();
            return res.status(403).json({ message: 'Status tidak memungkinkan perubahan jadwal' });
        }

        const kuota = await reserveKuotaAktif(conn, booking, tanggal_baru);
        if (!kuota.ok) {
            await conn.rollback();
            return res.status(409).json({ message: kuota.message });
        }

        await kurangiKuotaAktif(conn, booking);

        await conn.query(
            `INSERT INTO reschedule_log (booking_id, tanggal_lama, tanggal_baru, diminta_oleh, alasan)
       VALUES (?, ?, ?, 'petugas', ?)`,
            [id, booking.tanggal_diminta, tanggal_baru, alasan]
        );

        await conn.query(
            `UPDATE bookings SET tanggal_diminta = ?, tanggal_fix = NULL,
       status = 'rescheduled_by_petugas', updated_at = NOW() WHERE id = ?`,
            [tanggal_baru, id]
        );

        await conn.commit();

        // Kirim notifikasi (setelah commit berhasil)
        const [userRows] = await pool.query(
            'SELECT email FROM users WHERE id = ?', [booking.user_id]
        );
        const alasanAman = escapeHTML(alasan);
        await kirimNotifikasi({
            user_id: booking.user_id,
            booking_id: parseInt(id),
            judul: 'Jadwal Diubah Petugas',
            pesan: `Petugas mengusulkan jadwal baru untuk berkas <strong>${booking.nomor_berkas}</strong> menjadi <strong>${formatTgl(tanggal_baru)}</strong>. Silakan setujui jadwal atau ajukan jadwal lain. Alasan: <strong>${alasanAman}</strong>.`,
            email_user: userRows[0]?.email,
            nomor_berkas: booking.nomor_berkas
        });
        await kirimNotifikasiAdmin({
            booking_id: parseInt(id),
            judul: 'Jadwal Diubah Petugas',
            pesan: `Petugas mengusulkan jadwal baru untuk berkas <strong>${booking.nomor_berkas}</strong> menjadi <strong>${formatTgl(tanggal_baru)}</strong>. Alasan: <strong>${alasanAman}</strong>.`,
            nomor_berkas: booking.nomor_berkas
        });

        res.json({ message: 'Jadwal baru telah dikirim ke pemohon untuk disetujui' });
    } catch (err) {
        await conn.rollback();
        return serverError(res, err);
    } finally {
        conn.release();
    }
};

// TOLAK BERKAS PERMANEN
const tolakBerkas = async (req, res) => {
    const { id } = req.params;
    const { alasan } = req.body;
    const petugas_id = req.user.id;

    if (!alasan || !alasan.trim())
        return res.status(400).json({ message: 'Alasan penolakan wajib diisi' });

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.query(
            'SELECT * FROM bookings WHERE id = ? AND petugas_id = ? FOR UPDATE',
            [id, petugas_id]
        );
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Berkas tidak ditemukan' });
        }

        const booking = rows[0];
        if (!['pending', 'rescheduled_by_user'].includes(booking.status)) {
            await conn.rollback();
            return res.status(403).json({ message: 'Berkas tidak dapat ditolak pada status ini' });
        }

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

        await conn.query(
            `INSERT INTO reschedule_log (booking_id, tanggal_lama, tanggal_baru, diminta_oleh, alasan)
       VALUES (?, ?, ?, 'petugas', ?)`,
            [id, booking.tanggal_diminta, booking.tanggal_diminta, '[DITOLAK] ' + alasan]
        );

        await conn.query(
            `UPDATE bookings SET status = 'ditolak', updated_at = NOW() WHERE id = ?`, [id]
        );

        await conn.commit();

        // Kirim notifikasi (setelah commit berhasil)
        const [userRows] = await pool.query(
            'SELECT email FROM users WHERE id = ?', [booking.user_id]
        );
        const alasanAman = escapeHTML(alasan);
        await kirimNotifikasi({
            user_id: booking.user_id,
            booking_id: parseInt(id),
            judul: 'Permohonan Berkas Ditolak',
            pesan: `Permohonan berkas <strong>${booking.nomor_berkas}</strong> ditolak oleh petugas. Alasan: <strong>${alasanAman}</strong>. Silakan ajukan permohonan baru.`,
            email_user: userRows[0]?.email,
            nomor_berkas: booking.nomor_berkas
        });
        await kirimNotifikasiAdmin({
            booking_id: parseInt(id),
            judul: 'Permohonan Berkas Ditolak',
            pesan: `Petugas menolak berkas <strong>${booking.nomor_berkas}</strong>. Alasan: <strong>${alasanAman}</strong>.`,
            nomor_berkas: booking.nomor_berkas
        });

        res.json({ message: 'Berkas berhasil ditolak' });
    } catch (err) {
        await conn.rollback();
        return serverError(res, err);
    } finally {
        conn.release();
    }
};

// INPUT HASIL PEMERIKSAAN
const inputHasil = async (req, res) => {
    const { id } = req.params;
    const { catatan_lapangan } = req.body;
    const petugas_id = req.user.id;

    try {
        const [rows] = await pool.query(
            'SELECT * FROM bookings WHERE id = ? AND petugas_id = ?', [id, petugas_id]
        );
        if (rows.length === 0)
            return res.status(404).json({ message: 'Booking tidak ditemukan' });

        const booking = rows[0];
        if (booking.status !== 'jadwal_fix')
            return res.status(403).json({ message: 'Pemeriksaan belum bisa diinput, jadwal belum fix' });

        const foto_lokasi = req.files?.foto_lokasi?.[0]?.filename || null;
        const foto_risalah = req.files?.foto_risalah?.[0]?.filename || null;

        await pool.query(
            `INSERT INTO hasil_pemeriksaan
        (booking_id, petugas_id, nomor_berkas, foto_lokasi, foto_risalah, catatan_lapangan)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        foto_lokasi = VALUES(foto_lokasi),
        foto_risalah = VALUES(foto_risalah),
        catatan_lapangan = VALUES(catatan_lapangan),
        updated_at = NOW()`,
            [id, petugas_id, booking.nomor_berkas, foto_lokasi, foto_risalah, catatan_lapangan]
        );

        await pool.query(
            `UPDATE bookings SET status = 'selesai', updated_at = NOW() WHERE id = ?`, [id]
        );

        // Kirim notifikasi
        const [userRows] = await pool.query(
            'SELECT email FROM users WHERE id = ?', [booking.user_id]
        );
        await kirimNotifikasi({
            user_id: booking.user_id,
            booking_id: parseInt(id),
            judul: 'Pemeriksaan Tanah Selesai',
            pesan: `Pemeriksaan tanah berkas <strong>${booking.nomor_berkas}</strong> telah selesai dilakukan. Hasil sudah tersimpan di sistem.`,
            email_user: userRows[0]?.email,
            nomor_berkas: booking.nomor_berkas
        });
        await kirimNotifikasiAdmin({
            booking_id: parseInt(id),
            judul: 'Pemeriksaan Tanah Selesai',
            pesan: `Petugas menyelesaikan pemeriksaan tanah untuk berkas <strong>${booking.nomor_berkas}</strong>.`,
            nomor_berkas: booking.nomor_berkas
        });

        res.json({ message: 'Hasil pemeriksaan berhasil disimpan' });
    } catch (err) {
        return serverError(res, err);
    }
};

module.exports = { getTugas, konfirmasiJadwal, tolakJadwal, inputHasil, tolakBerkas };
