const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { serverError } = require('../utils/http');
const { setSessionCookies } = require('../utils/sesi');
const { ensureSandiSchema, TABEL_AKUN } = require('../utils/sandi');
const { ensureOtpSchema, sendOtp, verifyOtp, tandaiOtpTerpakai } = require('../utils/otp');
const { kirimEmail } = require('../utils/notifikasi');
const { invalidateAccountStatus } = require('../middleware/auth');
require('dotenv').config();

const MIN_PANJANG_SANDI = 8;
const NIP_REGEX = /^\d{18}$/;

// Satu pesan untuk NIP terdaftar maupun tidak. Kalau dibedakan, layar lupa
// sandi berubah jadi alat untuk memeriksa NIP mana yang punya akun di sistem -
// dan itu membatalkan penyeragaman pesan yang sudah dipasang di halaman login.
const PESAN_SERAGAM =
    'Jika NIP terdaftar, kode OTP telah dikirim ke email yang terdaftar.';

const generateToken = (payload) =>
    jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '1d'
    });

const PESAN_SANDI_SAMA = 'Kata sandi baru harus berbeda dari kata sandi lama';

function validasiSandiBaru(sandiBaru, sandiLama) {
    if (String(sandiBaru || '').length < MIN_PANJANG_SANDI) {
        return `Kata sandi baru minimal ${MIN_PANJANG_SANDI} karakter`;
    }
    // Pemeriksaan cepat bila sandi lama memang diketik pengguna.
    if (sandiLama && sandiBaru === sandiLama) {
        return PESAN_SANDI_SAMA;
    }
    return null;
}

/**
 * Memastikan sandi baru benar-benar berbeda dari yang sedang berlaku.
 *
 * Membandingkan terhadap HASH TERSIMPAN, bukan terhadap teks yang diketik.
 * Perbandingan teks saja tidak cukup: pada alur lupa sandi lewat OTP tidak ada
 * sandi lama yang diketik, sehingga pemeriksaannya terlewat sama sekali dan
 * pengguna bisa "mengganti" sandi menjadi sandi yang sama persis.
 *
 * Sengaja TIDAK dipakai pada reset oleh admin: admin tidak mengetahui sandi
 * petugas, jadi penolakan "sandi sama" di sana akan berubah menjadi alat untuk
 * menebak sandi petugas lewat formulir edit.
 */
async function sandiSamaDenganSekarang(sandiBaru, hashSekarang) {
    if (!hashSekarang) return false;
    return bcrypt.compare(sandiBaru, hashSekarang);
}

/** Menyimpan sandi baru dan memutus seluruh sesi lama akun tersebut. */
async function simpanSandiBaru(role, id, sandiBaru, { hapusWajibGanti = false } = {}) {
    const tabel = TABEL_AKUN[role];
    const hash = await bcrypt.hash(sandiBaru, 10);

    // password_changed_at = NOW() inilah yang membatalkan token lama:
    // middleware menolak token yang diterbitkan sebelum waktu ini.
    const kolomTambahan = hapusWajibGanti && role === 'petugas'
        ? ', harus_ganti_sandi = 0'
        : '';
    await pool.query(
        `UPDATE \`${tabel}\` SET password = ?, password_changed_at = NOW()${kolomTambahan} WHERE id = ?`,
        [hash, id]
    );

    // Supaya perubahan langsung berlaku, tidak menunggu cache middleware habis.
    invalidateAccountStatus(role, id);
}

async function beritahuPemilikAkun({ email, nama, olehAdmin }) {
    if (!email) return;

    const judul = olehAdmin
        ? 'Kata Sandi Anda Direset Admin'
        : 'Kata Sandi Anda Telah Diubah';
    const pesan = olehAdmin
        ? `Yth. <strong>${nama || 'Pengguna'}</strong>, admin baru saja mereset kata sandi akun Anda. `
          + 'Silakan masuk memakai kata sandi sementara yang diberikan admin, lalu segera menggantinya. '
          + 'Jika Anda tidak meminta reset ini, segera hubungi admin.'
        : `Yth. <strong>${nama || 'Pengguna'}</strong>, kata sandi akun Anda baru saja diubah. `
          + 'Jika bukan Anda yang melakukannya, segera hubungi admin karena akun Anda mungkin diakses orang lain.';

    // Kegagalan email tidak boleh menggagalkan penggantian sandi yang sudah
    // tersimpan; cukup dicatat di log.
    try {
        await kirimEmail({ email_user: email, judul, pesan });
    } catch (err) {
        console.error('[Sandi] Gagal mengirim pemberitahuan:', err.message);
    }
}

/**
 * Ganti sandi untuk pemohon, petugas, dan admin.
 *
 * WAJIB menyertakan sandi lama. Tanpa itu, siapa pun yang berhasil mencuri
 * sesi - termasuk lewat komputer kantor yang ditinggal dalam keadaan login -
 * bisa mengunci pemilik akun secara permanen.
 */
const gantiSandi = async (req, res) => {
    const sandiLama = String(req.body.sandi_lama || '');
    const sandiBaru = String(req.body.sandi_baru || '');
    const { id, role } = req.user;

    if (!sandiLama || !sandiBaru) {
        return res.status(400).json({ message: 'Kata sandi lama dan baru wajib diisi' });
    }
    const salah = validasiSandiBaru(sandiBaru, sandiLama);
    if (salah) return res.status(400).json({ message: salah });

    const tabel = TABEL_AKUN[role];
    if (!tabel) return res.status(403).json({ message: 'Peran tidak dikenal' });

    try {
        await ensureSandiSchema();

        const [rows] = await pool.query(
            `SELECT id, password, nama_lengkap, email FROM \`${tabel}\` WHERE id = ? LIMIT 1`,
            [id]
        );
        const akun = rows[0];
        if (!akun) return res.status(404).json({ message: 'Akun tidak ditemukan' });

        if (!(await bcrypt.compare(sandiLama, akun.password))) {
            return res.status(401).json({
                code: 'SANDI_LAMA_SALAH',
                message: 'Kata sandi lama tidak sesuai'
            });
        }

        if (await sandiSamaDenganSekarang(sandiBaru, akun.password)) {
            return res.status(400).json({
                code: 'SANDI_SAMA',
                message: PESAN_SANDI_SAMA
            });
        }

        await simpanSandiBaru(role, id, sandiBaru, { hapusWajibGanti: true });

        // Pengguna yang mengganti sandinya sendiri tidak boleh ikut terlempar
        // keluar oleh pembatalan sesi, jadi ia langsung menerima sesi baru.
        setSessionCookies(res, generateToken({ id, nama: akun.nama_lengkap, role }));

        await beritahuPemilikAkun({
            email: akun.email,
            nama: akun.nama_lengkap,
            olehAdmin: false
        });

        return res.json({ message: 'Kata sandi berhasil diubah.' });
    } catch (err) {
        return serverError(res, err);
    }
};

/** Langkah 1 lupa sandi petugas: kirim OTP ke email yang tersimpan. */
const lupaSandiPetugas = async (req, res) => {
    const nip = String(req.body.nip || '').replace(/\s/g, '');

    // Format boleh ditolak tegas - ini tidak membocorkan apa pun, dan justru
    // menangkap sebagian besar kesalahan ketik pada NIP yang 18 digit.
    if (!NIP_REGEX.test(nip)) {
        return res.status(400).json({ message: 'NIP harus terdiri dari 18 digit angka' });
    }

    try {
        await ensureSandiSchema();
        await ensureOtpSchema();

        const [rows] = await pool.query(
            'SELECT id, email, nama_lengkap FROM petugas WHERE nip = ? AND is_active = 1 LIMIT 1',
            [nip]
        );
        const petugas = rows[0];

        if (petugas && petugas.email) {
            try {
                await sendOtp({
                    petugasId: petugas.id,
                    email: petugas.email,
                    purpose: 'reset_sandi_petugas'
                });
            } catch (kirimErr) {
                // Termasuk cooldown OTP. Tidak boleh muncul di respons: balasan
                // yang berbeda akan menandakan bahwa NIP itu terdaftar.
                console.error('[Lupa Sandi Petugas]', kirimErr.code || 'OTP_GAGAL', kirimErr.message);
            }
        }

        return res.json({ message: PESAN_SERAGAM });
    } catch (err) {
        return serverError(res, err);
    }
};

/** Langkah 2 lupa sandi petugas: verifikasi OTP lalu set sandi baru. */
const resetSandiPetugas = async (req, res) => {
    const nip = String(req.body.nip || '').replace(/\s/g, '');
    const otp = String(req.body.otp || '').trim();
    const sandiBaru = String(req.body.sandi_baru || '');

    if (!NIP_REGEX.test(nip)) {
        return res.status(400).json({ message: 'NIP harus terdiri dari 18 digit angka' });
    }
    const salah = validasiSandiBaru(sandiBaru, null);
    if (salah) return res.status(400).json({ message: salah });

    // SATU pesan untuk semua kegagalan: OTP salah, OTP kedaluwarsa, OTP belum
    // pernah diminta, maupun NIP yang tidak terdaftar. Kalau dibedakan,
    // seseorang bisa memakai layar ini untuk memastikan sebuah NIP punya akun -
    // persis kebocoran yang sudah ditutup di halaman login dan langkah pertama
    // lupa sandi. Bagi pengguna yang sah bedanya juga tidak berguna: baik salah
    // maupun kedaluwarsa, tindakannya sama - periksa email atau minta kode baru.
    const tolak = () => res.status(400).json({
        code: 'OTP_TIDAK_VALID',
        message: 'Kode OTP salah atau sudah kedaluwarsa. Periksa email Anda atau minta kode baru.'
    });

    try {
        await ensureSandiSchema();
        await ensureOtpSchema();

        const [rows] = await pool.query(
            'SELECT id, email, nama_lengkap, password FROM petugas WHERE nip = ? AND is_active = 1 LIMIT 1',
            [nip]
        );
        const petugas = rows[0];
        // NIP tidak dikenal dijawab sama persis dengan OTP salah.
        if (!petugas) return tolak();

        let verified;
        try {
            verified = await verifyOtp({
                email: petugas.email,
                purpose: 'reset_sandi_petugas',
                otp,
                // Masih ada validasi setelah ini. Kode sekali-pakai milik
                // pengguna tidak boleh hangus hanya karena sandi barunya
                // kebetulan sama dengan yang sekarang.
                tandaiTerpakai: false
            });
        } catch (otpErr) {
            // Batas percobaan tetap diberitahukan supaya pengguna tahu harus
            // meminta kode baru; itu hanya bisa tercapai oleh orang yang memang
            // sudah memicu OTP untuk akun ini.
            if (otpErr.code === 'OTP_MAX_ATTEMPTS') {
                return res.status(429).json({ code: otpErr.code, message: otpErr.message });
            }
            console.error('[Reset Sandi Petugas]', otpErr.code || 'OTP_GAGAL', otpErr.message);
            return tolak();
        }

        // OTP harus benar-benar milik petugas ini, bukan milik akun lain yang
        // kebetulan memakai alamat email sama.
        if (Number(verified.petugasId) !== Number(petugas.id)) return tolak();

        // Diperiksa SETELAH OTP terbukti sah, supaya jawabannya tidak bisa
        // dipakai menebak sandi petugas tanpa menguasai emailnya lebih dulu.
        if (await sandiSamaDenganSekarang(sandiBaru, petugas.password)) {
            // OTP sengaja dibiarkan tetap berlaku agar pengguna bisa langsung
            // mencoba lagi dengan sandi lain, tanpa meminta kode baru.
            return res.status(400).json({
                code: 'SANDI_SAMA',
                message: PESAN_SANDI_SAMA + '. Kode OTP Anda masih berlaku, silakan coba sandi lain.'
            });
        }

        // Seluruh validasi lolos: baru sekarang kodenya dihanguskan, sebelum
        // sandi ditulis - supaya tidak mungkin ada sandi tersimpan sementara
        // kodenya masih bisa dipakai lagi.
        await tandaiOtpTerpakai(verified.otpId);

        await simpanSandiBaru('petugas', petugas.id, sandiBaru, { hapusWajibGanti: true });
        await beritahuPemilikAkun({
            email: petugas.email,
            nama: petugas.nama_lengkap,
            olehAdmin: false
        });

        return res.json({ message: 'Kata sandi berhasil diubah. Silakan masuk.' });
    } catch (err) {
        return serverError(res, err);
    }
};

module.exports = {
    MIN_PANJANG_SANDI,
    PESAN_SANDI_SAMA,
    sandiSamaDenganSekarang,
    simpanSandiBaru,
    beritahuPemilikAkun,
    gantiSandi,
    lupaSandiPetugas,
    resetSandiPetugas
};
