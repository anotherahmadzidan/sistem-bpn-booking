const pool = require('../config/db');
const { kirimNotifikasi, kirimNotifikasiAdmin, kirimNotifikasiAman } = require('../utils/notifikasi');
const { serverError } = require('../utils/http');
const { reserveKuotaAktif, kurangiKuotaAktif, getEffectiveKuota } = require('../utils/kuota');
const { requireIndonesianPhone } = require('../utils/phone');

// Zona waktu wajib eksplisit: tanpa timeZone, Node memakai zona waktu OS server
// sehingga tanggal di notifikasi bisa meleset satu hari dari jadwal sebenarnya.
const formatTgl = (d) => new Date(d).toLocaleDateString('id-ID', {
    timeZone: 'Asia/Makassar',
    day: '2-digit', month: 'long', year: 'numeric'
});

const escapeHTML = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const isDateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

const toDateOnly = (value) => {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

    const parsed = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Makassar',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(parsed);
    }

    const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : '';
};

const todayWita = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
}).format(new Date());

const isPastDate = (value) => isDateOnly(value) && value < todayWita();
const isFutureDate = (value) => isDateOnly(value) && value > todayWita();

// Batas panjang input. Tanpa ini, kiriman panjang memicu ER_DATA_TOO_LONG (500)
// atau terpotong diam-diam bila MySQL tidak berjalan di mode strict.
const MAX_LENGTHS = {
    nomor_berkas: 100,
    nama_pemohon: 150,
    alamat_lokasi: 500,
    koordinat_maps: 100,
    alasan: 500
};

const checkMaxLength = (values) => {
    for (const [field, value] of Object.entries(values)) {
        const limit = MAX_LENGTHS[field];
        if (limit && String(value || '').length > limit) {
            return `Isian ${field.replace(/_/g, ' ')} maksimal ${limit} karakter`;
        }
    }
    return null;
};

// Koordinat dipakai untuk menyusun URL Google Maps di panel admin & petugas,
// jadi formatnya harus dipastikan angka - bukan teks bebas.
const isValidKoordinat = (value) => {
    const match = String(value || '').trim().match(/^(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (!match) return false;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
};

// CEK KUOTA - dipanggil saat pemohon pilih tanggal
const cekKuota = async (req, res) => {
    const { kecamatan_id, kelurahan_id, petugas_id, tanggal } = req.query;
    if (!kecamatan_id || !kelurahan_id || !petugas_id || !tanggal)
        return res.status(400).json({ message: 'Parameter kurang' });

    try {
        const [kec, kel, pet] = await Promise.all([
            getEffectiveKuota({ tipe: 'kecamatan', id: kecamatan_id, tanggal }),
            getEffectiveKuota({ tipe: 'kelurahan', id: kelurahan_id, tanggal }),
            getEffectiveKuota({ tipe: 'petugas', id: petugas_id, tanggal }),
        ]);

        const tersedia = kec.tersedia && kel.tersedia && pet.tersedia;
        res.json({ tersedia, kecamatan: kec, kelurahan: kel, petugas: pet });
    } catch (err) {
        return serverError(res, err);
    }
};

// BUAT BOOKING BARU
const createBooking = async (req, res) => {
    const {
        nomor_berkas, nama_pemohon, tanggal_berkas,
        kecamatan_id, kelurahan_id, alamat_lokasi,
        koordinat_maps, no_telepon, petugas_id, tanggal_diminta
    } = req.body;

    const user_id = req.user.id;

    if (!nomor_berkas || !nama_pemohon || !tanggal_berkas || !kecamatan_id ||
        !kelurahan_id || !alamat_lokasi || !no_telepon || !petugas_id || !tanggal_diminta)
        return res.status(400).json({ message: 'Semua field wajib diisi' });

    let normalizedPhone;
    try {
        normalizedPhone = requireIndonesianPhone(no_telepon);
    } catch (err) {
        return res.status(err.status || 400).json({ message: err.message, code: err.code });
    }

    const lengthError = checkMaxLength({
        nomor_berkas, nama_pemohon, alamat_lokasi, koordinat_maps
    });
    if (lengthError) {
        return res.status(400).json({ message: lengthError });
    }

    if (koordinat_maps && !isValidKoordinat(koordinat_maps)) {
        return res.status(400).json({ message: 'Format koordinat tidak valid. Gunakan format lintang,bujur' });
    }

    if (!isDateOnly(tanggal_berkas) || !isDateOnly(tanggal_diminta)) {
        return res.status(400).json({ message: 'Format tanggal tidak valid' });
    }

    if (isFutureDate(tanggal_berkas)) {
        return res.status(400).json({ message: 'Tanggal berkas tidak boleh melebihi hari ini' });
    }

    if (isPastDate(tanggal_diminta)) {
        return res.status(400).json({ message: 'Tanggal peninjauan tidak boleh tanggal yang sudah lewat' });
    }

    let bookingId;
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Cek nomor berkas duplikat.
        // FOR UPDATE wajib: tanpa penguncian baris, dua request bersamaan dengan
        // nomor berkas sama sama-sama lolos pemeriksaan ini.
        const [duplikat] = await conn.query(
            'SELECT id FROM bookings WHERE nomor_berkas = ? FOR UPDATE', [nomor_berkas]
        );
        if (duplikat.length > 0) {
            await conn.rollback();
            return res.status(409).json({ message: 'Nomor berkas sudah terdaftar' });
        }

        const [wilayah] = await conn.query(
            'SELECT id FROM kelurahan WHERE id = ? AND kecamatan_id = ?',
            [kelurahan_id, kecamatan_id]
        );
        if (wilayah.length === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Kelurahan tidak sesuai dengan kecamatan yang dipilih' });
        }

        const [petugasAktif] = await conn.query(
            'SELECT id FROM petugas WHERE id = ? AND is_active = 1',
            [petugas_id]
        );
        if (petugasAktif.length === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Petugas tidak aktif atau tidak ditemukan' });
        }

        const kuota = await reserveKuotaAktif(conn, { kecamatan_id, kelurahan_id, petugas_id }, tanggal_diminta);
        if (!kuota.ok) {
            await conn.rollback();
            return res.status(409).json({ message: kuota.message });
        }

        // Insert booking
        const [result] = await conn.query(
            `INSERT INTO bookings
        (nomor_berkas, user_id, petugas_id, kecamatan_id, kelurahan_id,
         nama_pemohon, tanggal_berkas, alamat_lokasi, koordinat_maps,
         no_telepon, tanggal_diminta, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [nomor_berkas, user_id, petugas_id, kecamatan_id, kelurahan_id,
                nama_pemohon, tanggal_berkas, alamat_lokasi, koordinat_maps,
                normalizedPhone, tanggal_diminta]
        );

        await conn.commit();
        bookingId = result.insertId;
    } catch (err) {
        try { await conn.rollback(); } catch {}
        // Kolom nomor_berkas punya UNIQUE KEY, jadi lomba antar-request tetap
        // tertahan di database. Tanpa penanganan ini pemohon melihat 500,
        // bukan pesan yang menjelaskan bahwa nomornya sudah terpakai.
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                code: 'NOMOR_BERKAS_TERPAKAI',
                message: 'Nomor berkas sudah terdaftar'
            });
        }
        return serverError(res, err);
    } finally {
        conn.release();
    }

    // Notifikasi HARUS di luar blok transaksi di atas: bagian ini memakai
    // pool.query lagi, jadi koneksi transaksi wajib sudah dilepas. Bila masih
    // dipegang, dua request bersamaan akan saling menunggu koneksi dan pool
    // terkunci permanen (mysql2 tidak punya batas waktu antrean).
    await kirimNotifikasiAman(async () => {
        const nomorAman = escapeHTML(nomor_berkas);
        const namaAman = escapeHTML(nama_pemohon);
        const [[userInfo], [petugasInfo]] = await Promise.all([
            pool.query('SELECT email, nama_lengkap FROM users WHERE id = ?', [user_id]),
            pool.query('SELECT email, nama_lengkap FROM petugas WHERE id = ?', [petugas_id])
        ]);
        await Promise.all([kirimNotifikasi({
            user_id: user_id,
            booking_id: bookingId,
            judul: 'Booking Berhasil Diajukan',
            pesan: `Permohonan berkas <strong>${nomorAman}</strong> berhasil diajukan dan sedang menunggu konfirmasi petugas.`,
            email_user: userInfo[0]?.email,
            nomor_berkas: nomor_berkas
        }), kirimNotifikasi({
            recipient_role: 'petugas',
            recipient_id: petugas_id,
            booking_id: bookingId,
            judul: 'Tugas Pemeriksaan Baru',
            pesan: `Berkas <strong>${nomorAman}</strong> dari <strong>${namaAman}</strong> masuk dan menunggu tindak lanjut jadwal.`,
            email_user: petugasInfo[0]?.email,
            nomor_berkas: nomor_berkas
        }), kirimNotifikasiAdmin({
            booking_id: bookingId,
            judul: 'Berkas Baru Masuk',
            pesan: `Berkas <strong>${nomorAman}</strong> dari <strong>${namaAman}</strong> ditugaskan kepada <strong>${escapeHTML(petugasInfo[0]?.nama_lengkap || 'petugas')}</strong>.`,
            nomor_berkas: nomor_berkas
        })]);
    });

    res.status(201).json({ message: 'Booking berhasil dibuat', booking_id: bookingId });
};

// LIHAT RIWAYAT BOOKING PEMOHON
const getMyBookings = async (req, res) => {
    const user_id = req.user.id;
    try {
        const [rows] = await pool.query(
            `SELECT b.*, 
        k.nama_kecamatan, kel.nama_kelurahan,
        p.nama_lengkap AS nama_petugas, p.nip,
        rl.diminta_oleh AS last_reschedule_by,
        rl.alasan AS last_reschedule_alasan,
        rl.tanggal_lama AS last_tanggal_lama,
        rl.tanggal_baru AS last_tanggal_baru
       FROM bookings b
       JOIN kecamatan k ON b.kecamatan_id = k.id
       JOIN kelurahan kel ON b.kelurahan_id = kel.id
       JOIN petugas p ON b.petugas_id = p.id
       LEFT JOIN reschedule_log rl ON rl.id = (
         SELECT rl2.id FROM reschedule_log rl2
         WHERE rl2.booking_id = b.id
         ORDER BY rl2.created_at DESC, rl2.id DESC
         LIMIT 1
       )
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC`,
            [user_id]
        );
        res.json(rows);
    } catch (err) {
        return serverError(res, err);
    }
};

// RESCHEDULE OLEH PEMOHON (maks 1x)
const rescheduleBooking = async (req, res) => {
    const { id } = req.params;
    const { tanggal_baru, alasan } = req.body;
    const user_id = req.user.id;

    if (!tanggal_baru)
        return res.status(400).json({ message: 'Tanggal baru wajib diisi' });

    if (!isDateOnly(tanggal_baru)) {
        return res.status(400).json({ message: 'Format tanggal baru tidak valid' });
    }

    if (isPastDate(tanggal_baru)) {
        return res.status(400).json({ message: 'Tanggal baru tidak boleh tanggal yang sudah lewat' });
    }

    const alasanLengthError = checkMaxLength({ alasan });
    if (alasanLengthError) {
        return res.status(400).json({ message: alasanLengthError });
    }

    let booking;
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.query(
            'SELECT * FROM bookings WHERE id = ? AND user_id = ? FOR UPDATE',
            [id, user_id]
        );
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Booking tidak ditemukan' });
        }

        booking = rows[0];

        if (booking.reschedule_count >= 1) {
            await conn.rollback();
            return res.status(403).json({ message: 'Batas reschedule sudah tercapai (maksimal 1x)' });
        }

        if (!['jadwal_fix', 'rescheduled_by_petugas'].includes(booking.status)) {
            await conn.rollback();
            return res.status(403).json({ message: 'Booking tidak dapat direschedule pada status ini' });
        }

        if (toDateOnly(booking.tanggal_diminta) === tanggal_baru) {
            await conn.rollback();
            return res.status(400).json({
                message: 'Tanggal baru harus berbeda dari jadwal yang sedang berlaku'
            });
        }

        const kuota = await reserveKuotaAktif(conn, booking, tanggal_baru);
        if (!kuota.ok) {
            await conn.rollback();
            return res.status(409).json({ message: kuota.message });
        }

        await kurangiKuotaAktif(conn, booking);

        // Log reschedule
        await conn.query(
            `INSERT INTO reschedule_log (booking_id, tanggal_lama, tanggal_baru, diminta_oleh, alasan)
       VALUES (?, ?, ?, 'user', ?)`,
            [id, booking.tanggal_diminta, tanggal_baru, alasan || null]
        );

        // Update booking
        await conn.query(
            `UPDATE bookings SET tanggal_diminta = ?, reschedule_count = reschedule_count + 1,
       status = 'rescheduled_by_user', updated_at = NOW() WHERE id = ?`,
            [tanggal_baru, id]
        );

        await conn.commit();
    } catch (err) {
        try { await conn.rollback(); } catch {}
        return serverError(res, err);
    } finally {
        conn.release();
    }

    await kirimNotifikasiAman(async () => {
        const nomorAman = escapeHTML(booking.nomor_berkas);
        const alasanAman = escapeHTML(alasan);
        const [[userInfo], [petugasInfo]] = await Promise.all([
            pool.query('SELECT email, nama_lengkap FROM users WHERE id = ?', [booking.user_id]),
            pool.query('SELECT email, nama_lengkap FROM petugas WHERE id = ?', [booking.petugas_id])
        ]);
        const pemohonAman = escapeHTML(userInfo[0]?.nama_lengkap || 'pemohon');
        await Promise.all([kirimNotifikasi({
            user_id: booking.user_id,
            booking_id: parseInt(id),
            judul: 'Pengajuan Reschedule Terkirim',
            pesan: `Permintaan perubahan jadwal berkas <strong>${nomorAman}</strong> ke tanggal <strong>${tanggal_baru}</strong> sudah dikirim ke petugas.`,
            email_user: userInfo[0]?.email,
            nomor_berkas: booking.nomor_berkas
        }), kirimNotifikasi({
            recipient_role: 'petugas',
            recipient_id: booking.petugas_id,
            booking_id: parseInt(id),
            judul: 'Pemohon Mengajukan Reschedule',
            pesan: `Pemohon <strong>${pemohonAman}</strong> meminta perubahan jadwal berkas <strong>${nomorAman}</strong> ke tanggal <strong>${tanggal_baru}</strong>.${alasan ? ' Alasan: ' + alasanAman : ''}`,
            email_user: petugasInfo[0]?.email,
            nomor_berkas: booking.nomor_berkas
        }), kirimNotifikasiAdmin({
            booking_id: parseInt(id),
            judul: 'Reschedule Diajukan Pemohon',
            pesan: `Pemohon <strong>${pemohonAman}</strong> mengajukan reschedule berkas <strong>${nomorAman}</strong> kepada <strong>${escapeHTML(petugasInfo[0]?.nama_lengkap || 'petugas')}</strong>.`,
            nomor_berkas: booking.nomor_berkas
        })]);
    });

    res.json({ message: 'Reschedule berhasil diajukan' });
};

// SETUJUI JADWAL BARU YANG DIUSULKAN PETUGAS
const approvePetugasSchedule = async (req, res) => {
    const { id } = req.params;
    const user_id = req.user.id;

    let booking;
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.query(
            'SELECT * FROM bookings WHERE id = ? AND user_id = ? FOR UPDATE',
            [id, user_id]
        );
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Booking tidak ditemukan' });
        }

        booking = rows[0];
        if (booking.status !== 'rescheduled_by_petugas') {
            await conn.rollback();
            return res.status(403).json({ message: 'Jadwal ini tidak menunggu persetujuan pemohon' });
        }

        await conn.query(
            `UPDATE bookings SET status = 'jadwal_fix', tanggal_fix = tanggal_diminta,
       updated_at = NOW() WHERE id = ?`,
            [id]
        );

        await conn.commit();
    } catch (err) {
        try { await conn.rollback(); } catch {}
        return serverError(res, err);
    } finally {
        conn.release();
    }

    await kirimNotifikasiAman(async () => {
        const nomorAman = escapeHTML(booking.nomor_berkas);
        const [[userInfo], [petugasInfo]] = await Promise.all([
            pool.query('SELECT nama_lengkap FROM users WHERE id = ?', [booking.user_id]),
            pool.query('SELECT email, nama_lengkap FROM petugas WHERE id = ?', [booking.petugas_id])
        ]);
        await Promise.all([kirimNotifikasi({
            recipient_role: 'petugas',
            recipient_id: booking.petugas_id,
            booking_id: parseInt(id),
            judul: 'Jadwal Disetujui Pemohon',
            pesan: `Pemohon <strong>${escapeHTML(userInfo[0]?.nama_lengkap || 'pemohon')}</strong> menyetujui jadwal baru berkas <strong>${nomorAman}</strong> pada <strong>${formatTgl(booking.tanggal_diminta)}</strong>.`,
            email_user: petugasInfo[0]?.email,
            nomor_berkas: booking.nomor_berkas
        }), kirimNotifikasiAdmin({
            booking_id: parseInt(id),
            judul: 'Jadwal Disetujui Pemohon',
            pesan: `Pemohon menyetujui jadwal baru berkas <strong>${nomorAman}</strong> yang diusulkan oleh <strong>${escapeHTML(petugasInfo[0]?.nama_lengkap || 'petugas')}</strong>.`,
            nomor_berkas: booking.nomor_berkas
        })]);
    });

    res.json({ message: 'Jadwal baru berhasil disetujui' });
};

// BATALKAN PERMOHONAN OLEH PEMOHON SAAT JADWAL PETUGAS TIDAK DISEPAKATI
const cancelBooking = async (req, res) => {
    const { id } = req.params;
    const user_id = req.user.id;
    const alasan = ((req.body && req.body.alasan) || '').trim();

    if (!alasan) {
        return res.status(400).json({ message: 'Alasan pembatalan wajib diisi' });
    }

    const alasanLengthError = checkMaxLength({ alasan });
    if (alasanLengthError) {
        return res.status(400).json({ message: alasanLengthError });
    }

    let booking;
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.query(
            'SELECT * FROM bookings WHERE id = ? AND user_id = ? FOR UPDATE',
            [id, user_id]
        );
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Booking tidak ditemukan' });
        }

        booking = rows[0];
        if (booking.status !== 'rescheduled_by_petugas') {
            await conn.rollback();
            return res.status(403).json({
                message: 'Permohonan hanya dapat dibatalkan saat menunggu persetujuan jadwal dari petugas'
            });
        }

        await kurangiKuotaAktif(conn, booking);

        await conn.query(
            `INSERT INTO reschedule_log (booking_id, tanggal_lama, tanggal_baru, diminta_oleh, alasan)
       VALUES (?, ?, ?, 'user', ?)`,
            [id, booking.tanggal_diminta, booking.tanggal_diminta, '[DIBATALKAN] ' + alasan]
        );

        await conn.query(
            `UPDATE bookings SET status = 'dibatalkan', tanggal_fix = NULL, updated_at = NOW()
       WHERE id = ?`,
            [id]
        );

        await conn.commit();
    } catch (err) {
        try { await conn.rollback(); } catch {}
        return serverError(res, err);
    } finally {
        conn.release();
    }

    await kirimNotifikasiAman(async () => {
        const nomorAman = escapeHTML(booking.nomor_berkas);
        const alasanAman = escapeHTML(alasan);
        const [[userInfo], [petugasInfo]] = await Promise.all([
            pool.query('SELECT email, nama_lengkap FROM users WHERE id = ?', [booking.user_id]),
            pool.query('SELECT email, nama_lengkap FROM petugas WHERE id = ?', [booking.petugas_id])
        ]);
        const pemohonAman = escapeHTML(userInfo[0]?.nama_lengkap || 'pemohon');

        await Promise.all([kirimNotifikasi({
            user_id: booking.user_id,
            booking_id: parseInt(id),
            judul: 'Permohonan Dibatalkan',
            pesan: `Permohonan berkas <strong>${nomorAman}</strong> berhasil dibatalkan. Alasan: <strong>${alasanAman}</strong>.`,
            email_user: userInfo[0]?.email,
            nomor_berkas: booking.nomor_berkas
        }), kirimNotifikasi({
            recipient_role: 'petugas',
            recipient_id: booking.petugas_id,
            booking_id: parseInt(id),
            judul: 'Permohonan Dibatalkan Pemohon',
            pesan: `Pemohon <strong>${pemohonAman}</strong> membatalkan permohonan berkas <strong>${nomorAman}</strong>. Alasan: <strong>${alasanAman}</strong>.`,
            email_user: petugasInfo[0]?.email,
            nomor_berkas: booking.nomor_berkas
        }), kirimNotifikasiAdmin({
            booking_id: parseInt(id),
            judul: 'Permohonan Dibatalkan Pemohon',
            pesan: `Pemohon <strong>${pemohonAman}</strong> membatalkan permohonan berkas <strong>${nomorAman}</strong> yang ditangani <strong>${escapeHTML(petugasInfo[0]?.nama_lengkap || 'petugas')}</strong>. Alasan: <strong>${alasanAman}</strong>.`,
            nomor_berkas: booking.nomor_berkas
        })]);
    });

    res.json({ message: 'Permohonan berhasil dibatalkan' });
};

module.exports = { createBooking, getMyBookings, rescheduleBooking, approvePetugasSchedule, cancelBooking, cekKuota };
