/**
 * Helper yang dipakai bersama oleh halaman admin, petugas, dan pemohon.
 *
 * Sebelumnya keenam fungsi ini disalin identik di tiga berkas HTML. Akibatnya
 * perbaikan di satu halaman tidak ikut memperbaiki halaman lain - itulah cara
 * celah XSS bertahan di halaman petugas setelah halaman admin diperbaiki.
 *
 * Berkas ini adalah skrip klasik (bukan module) supaya fungsinya tetap global
 * dan atribut onclick="..." di HTML tetap berfungsi.
 */

var WITA_TIME_ZONE = 'Asia/Makassar';

/** Menetralkan HTML. WAJIB dipakai untuk setiap data yang masuk ke innerHTML. */
function escapeHTML(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** Membuang tag HTML dari teks notifikasi yang memang disimpan ber-HTML. */
function stripHTML(value) {
    return String(value == null ? '' : value).replace(/<[^>]*>/g, '');
}

var DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Kolom DATE dikirim server sebagai 'YYYY-MM-DD'.
 * `new Date('2026-08-20')` diurai sebagai tengah malam UTC, sehingga di browser
 * yang zona waktunya di sebelah barat UTC tanggalnya mundur satu hari. Untuk
 * tanggal murni kita render dengan timeZone UTC agar hasilnya persis sama
 * dengan yang tersimpan di database.
 */
function formatDate(d) {
    if (!d) return '-';
    var parts = DATE_ONLY_PATTERN.exec(String(d));
    if (parts) {
        return new Date(Date.UTC(+parts[1], +parts[2] - 1, +parts[3]))
            .toLocaleDateString('id-ID', {
                timeZone: 'UTC', day: '2-digit', month: 'long', year: 'numeric'
            });
    }
    return new Date(d).toLocaleDateString('id-ID', {
        timeZone: WITA_TIME_ZONE, day: '2-digit', month: 'long', year: 'numeric'
    });
}

/** Untuk kolom DATETIME/TIMESTAMP, selalu ditampilkan dalam waktu WITA. */
function formatDateTime(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('id-ID', {
        timeZone: WITA_TIME_ZONE,
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

/** Waktu relatif ("5 menit lalu") untuk daftar notifikasi. */
function formatWaktu(d) {
    if (!d) return '';
    var diff = Date.now() - new Date(d).getTime();
    var menit = Math.floor(diff / 60000);
    var jam = Math.floor(diff / 3600000);
    var hari = Math.floor(diff / 86400000);
    if (menit < 1) return 'Baru saja';
    if (menit < 60) return menit + ' menit lalu';
    if (jam < 24) return jam + ' jam lalu';
    if (hari < 7) return hari + ' hari lalu';
    return new Date(d).toLocaleDateString('id-ID', {
        timeZone: WITA_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric'
    });
}

/**
 * Hanya koordinat "lintang,bujur" yang boleh dijadikan tautan peta.
 *
 * Data lama bisa berisi teks bebas. Pemeriksaan lama `koordinat.includes('http')`
 * bisa ditembus oleh `javascript:alert(1)//http`, yang lalu masuk ke atribut
 * href dan tereksekusi saat diklik.
 */
function safeMapsUrl(koordinat) {
    var match = String(koordinat == null ? '' : koordinat).trim()
        .match(/^(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (!match) return null;
    var lat = Number(match[1]);
    var lng = Number(match[2]);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return 'https://www.google.com/maps?q=' + encodeURIComponent(lat + ',' + lng);
}

/* ------------------------------------------------------------------ *
 * Sesi
 *
 * Token JWT TIDAK lagi disimpan di localStorage. Token berada di cookie
 * httpOnly yang tidak dapat dibaca JavaScript, sehingga celah XSS tidak
 * bisa mencurinya. Browser mengirim cookie itu otomatis, jadi tidak ada
 * header Authorization yang perlu disusun di sini.
 *
 * Yang tersisa di localStorage hanya nama dan peran - dipakai untuk
 * menampilkan sapaan dan memilih halaman, bukan untuk otorisasi. Otorisasi
 * sepenuhnya dilakukan server; kalau nilai itu dipalsukan, API tetap 401.
 * ------------------------------------------------------------------ */

/** Membaca cookie CSRF yang dipasang server saat login. */
function csrfToken() {
    var found = String(document.cookie || '')
        .split(';')
        .map(function (part) { return part.trim(); })
        .find(function (part) { return part.indexOf('bpn_csrf=') === 0; });
    return found ? decodeURIComponent(found.slice('bpn_csrf='.length)) : '';
}

var METODE_AMAN = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Header yang harus menyertai setiap permintaan API.
 * Token CSRF hanya diperlukan untuk metode yang mengubah data.
 */
function headerSesi(method) {
    var upper = String(method || 'GET').toUpperCase();
    if (METODE_AMAN.indexOf(upper) !== -1) return {};
    return { 'X-CSRF-Token': csrfToken() };
}

/** Menghapus sesi di server lalu membersihkan data tampilan di browser. */
async function akhiriSesi(tujuan) {
    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-CSRF-Token': csrfToken() }
        });
    } catch {
        // Kegagalan jaringan tidak boleh menahan pengguna di halaman.
    }
    localStorage.clear();
    window.location.href = tujuan;
}

/** Tautan WhatsApp dari nomor HP Indonesia; null bila nomornya tidak layak. */
function safeWhatsAppUrl(noTelepon) {
    var digits = String(noTelepon == null ? '' : noTelepon)
        .replace(/^0/, '62')
        .replace(/\D/g, '');
    if (!/^62\d{8,13}$/.test(digits)) return null;
    return 'https://wa.me/' + encodeURIComponent(digits);
}
