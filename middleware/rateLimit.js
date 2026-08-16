const rateLimit = require('express-rate-limit');

// Batas ketat untuk endpoint autentikasi (login, register, OTP, reset sandi).
const authLimiter = rateLimit({
    windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    max: Number(process.env.AUTH_RATE_LIMIT_MAX || 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: 'Terlalu banyak percobaan. Silakan coba lagi beberapa menit lagi.'
    }
});

// Batas untuk aksi yang membuat/mengubah data (booking, tindakan petugas,
// pengelolaan admin). Lebih longgar dari authLimiter karena dipakai pengguna
// yang sudah login, tetapi tetap mencegah pengiriman massal.
const writeLimiter = rateLimit({
    windowMs: Number(process.env.WRITE_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    max: Number(process.env.WRITE_RATE_LIMIT_MAX || 100),
    standardHeaders: true,
    legacyHeaders: false,
    // Hanya membatasi metode yang mengubah data; GET untuk menampilkan daftar
    // tidak ikut dihitung agar penggunaan normal tidak terganggu.
    skip: (req) => req.method === 'GET',
    message: {
        message: 'Terlalu banyak permintaan. Silakan tunggu beberapa menit.'
    }
});

// Jaring pengaman untuk seluruh /api. Batasnya sengaja tinggi: tujuannya
// meredam penyalahgunaan otomatis, bukan mengganggu pemakaian wajar.
const apiLimiter = rateLimit({
    windowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60 * 1000),
    max: Number(process.env.API_RATE_LIMIT_MAX || 300),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: 'Terlalu banyak permintaan. Silakan tunggu sebentar.'
    }
});

module.exports = { authLimiter, writeLimiter, apiLimiter };
