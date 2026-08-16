const crypto = require('crypto');
const { CSRF_COOKIE, CSRF_HEADER, readCookie } = require('../utils/sesi');

/**
 * Proteksi CSRF pola double-submit.
 *
 * Diperlukan sejak sesi berpindah ke cookie. Cookie dikirim browser secara
 * otomatis, jadi tanpa pengaman ini sebuah situs jahat cukup memuat form
 * tersembunyi untuk membuat pengguna yang sedang login melakukan aksi tanpa
 * sadar. Header Authorization tidak punya masalah ini karena tidak pernah
 * dikirim otomatis.
 *
 * Cara kerjanya: saat login, server memasang dua cookie - sesi (httpOnly) dan
 * token CSRF (dapat dibaca JavaScript). Frontend membaca cookie CSRF lalu
 * mengirimkannya kembali sebagai header. Situs lain tidak dapat membaca cookie
 * milik domain ini, sehingga tidak bisa menyusun header yang cocok.
 *
 * SameSite=lax pada cookie sesi sudah menahan sebagian besar kasus; pemeriksaan
 * ini adalah lapisan kedua untuk browser lama dan serangan dari subdomain.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Perbandingan waktu-tetap agar nilai token tidak bisa ditebak bertahap.
function samaPersis(a, b) {
    const bufferA = Buffer.from(String(a || ''), 'utf8');
    const bufferB = Buffer.from(String(b || ''), 'utf8');
    if (bufferA.length === 0 || bufferA.length !== bufferB.length) return false;
    return crypto.timingSafeEqual(bufferA, bufferB);
}

function verifyCsrf(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();

    const sessionCsrf = readCookie(req, CSRF_COOKIE);

    // Tanpa cookie CSRF berarti permintaan tidak memakai sesi berbasis cookie
    // (login, pendaftaran, atau klien yang memakai header Authorization).
    // Jalur itu tidak rentan CSRF, jadi tidak diperiksa di sini.
    if (!sessionCsrf) return next();

    const sent = req.headers[CSRF_HEADER];
    if (!samaPersis(sent, sessionCsrf)) {
        return res.status(403).json({
            code: 'CSRF_TOKEN_INVALID',
            message: 'Permintaan ditolak karena token keamanan tidak cocok. Muat ulang halaman lalu coba lagi.'
        });
    }

    return next();
}

module.exports = { verifyCsrf };
