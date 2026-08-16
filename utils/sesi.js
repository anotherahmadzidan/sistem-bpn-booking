const crypto = require('crypto');
const jwt = require('jsonwebtoken');

/**
 * Pengelolaan sesi lewat cookie.
 *
 * Sebelumnya token JWT disimpan di localStorage dan dikirim lewat header
 * Authorization. Konsekuensinya, satu celah XSS saja cukup untuk membaca token
 * dan mengambil alih akun sepenuhnya.
 *
 * Sekarang token berada di cookie httpOnly sehingga tidak bisa dibaca
 * JavaScript. Tetapi cookie dikirim browser secara OTOMATIS di setiap
 * permintaan, termasuk yang dipicu situs lain - risiko CSRF yang tidak ada
 * pada header Authorization. Karena itu perpindahan ini WAJIB disertai dua
 * pengaman: SameSite pada cookie, dan token CSRF double-submit
 * (lihat middleware/csrf.js).
 */

const SESSION_COOKIE = 'bpn_session';
const CSRF_COOKIE = 'bpn_csrf';
const CSRF_HEADER = 'x-csrf-token';

function parseCookies(req) {
    return String(req.headers?.cookie || '')
        .split(';')
        .map(part => part.trim())
        .filter(Boolean)
        .reduce((cookies, part) => {
            const separator = part.indexOf('=');
            if (separator <= 0) return cookies;
            const key = decodeURIComponent(part.slice(0, separator));
            cookies[key] = decodeURIComponent(part.slice(separator + 1));
            return cookies;
        }, {});
}

function readCookie(req, name) {
    return parseCookies(req)[name] || null;
}

const isProduction = () => process.env.NODE_ENV === 'production';

// Masa berlaku cookie disamakan dengan masa berlaku token, dibaca dari klaim
// `exp` supaya keduanya tidak bisa berbeda karena salah menyalin nilai env.
function cookieMaxAge(token) {
    const decoded = jwt.decode(token);
    const expiresAt = Number(decoded?.exp || 0) * 1000;
    const remaining = expiresAt - Date.now();
    return remaining > 0 ? remaining : 24 * 60 * 60 * 1000;
}

function baseCookieOptions() {
    return {
        // 'lax' menolak pengiriman cookie pada permintaan lintas situs yang
        // mengubah data (POST/PUT/PATCH/DELETE), tetapi tetap mengizinkan
        // pengguna membuka aplikasi dari tautan di email notifikasi.
        sameSite: 'lax',
        secure: isProduction(),
        path: '/'
    };
}

/**
 * Memasang cookie sesi (httpOnly) dan cookie CSRF (sengaja dapat dibaca
 * JavaScript, karena nilainya harus dikirim balik sebagai header).
 */
function setSessionCookies(res, token) {
    const maxAge = cookieMaxAge(token);

    res.cookie(SESSION_COOKIE, token, {
        ...baseCookieOptions(),
        httpOnly: true,
        maxAge
    });

    const csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, csrfToken, {
        ...baseCookieOptions(),
        httpOnly: false,
        maxAge
    });

    return csrfToken;
}

function clearSessionCookies(res) {
    res.clearCookie(SESSION_COOKIE, { ...baseCookieOptions(), httpOnly: true });
    res.clearCookie(CSRF_COOKIE, { ...baseCookieOptions(), httpOnly: false });
}

/**
 * Mengambil token dari cookie, dengan header Authorization sebagai cadangan.
 *
 * Header masih diterima untuk klien non-browser (skrip pemantauan, pengujian)
 * yang tidak menyimpan cookie. Jalur itu kebal CSRF, jadi permintaan yang
 * memakainya dilewati dari pemeriksaan token CSRF.
 */
function readAuthToken(req) {
    const fromCookie = readCookie(req, SESSION_COOKIE);
    if (fromCookie) return { token: fromCookie, source: 'cookie' };

    const authHeader = req.headers['authorization'];
    const fromHeader = authHeader && authHeader.split(' ')[1];
    if (fromHeader) return { token: fromHeader, source: 'header' };

    return { token: null, source: null };
}

module.exports = {
    SESSION_COOKIE,
    CSRF_COOKIE,
    CSRF_HEADER,
    parseCookies,
    readCookie,
    setSessionCookies,
    clearSessionCookies,
    readAuthToken
};
