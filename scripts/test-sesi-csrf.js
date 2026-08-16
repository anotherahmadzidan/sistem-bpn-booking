/**
 * Test untuk sesi berbasis cookie dan proteksi CSRF.
 *
 * Memindahkan token dari localStorage ke cookie httpOnly menutup pencurian
 * token lewat XSS, tetapi membuka risiko CSRF: cookie dikirim browser secara
 * otomatis, termasuk pada permintaan yang dipicu situs lain. Test ini menjaga
 * agar kedua sisi itu tidak pernah terlepas satu sama lain.
 */
const assert = require('assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'sesi-csrf-test-secret-minimal-32-karakter';

const {
    SESSION_COOKIE,
    CSRF_COOKIE,
    setSessionCookies,
    clearSessionCookies,
    readAuthToken
} = require('../utils/sesi');
const { verifyCsrf } = require('../middleware/csrf');

function fakeRes() {
    const jar = {};
    return {
        jar,
        cookie: (name, value, options) => { jar[name] = { value, options }; },
        clearCookie: (name, options) => { jar[name] = { cleared: true, options }; }
    };
}

function fakeReq({ method = 'POST', cookies = {}, headers = {} } = {}) {
    const cookieHeader = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    return {
        method,
        headers: { ...headers, ...(cookieHeader ? { cookie: cookieHeader } : {}) }
    };
}

function jalankanCsrf(req) {
    let hasil = { lanjut: false, status: null, body: null };
    const res = {
        status(code) { hasil.status = code; return this; },
        json(body) { hasil.body = body; return this; }
    };
    verifyCsrf(req, res, () => { hasil.lanjut = true; });
    return hasil;
}

const token = jwt.sign({ id: 1, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1d' });

function testAtributCookie() {
    for (const env of ['development', 'production']) {
        const semula = process.env.NODE_ENV;
        process.env.NODE_ENV = env;
        try {
            const res = fakeRes();
            const csrf = setSessionCookies(res, token);
            const sesi = res.jar[SESSION_COOKIE];
            const anti = res.jar[CSRF_COOKIE];

            assert.strictEqual(sesi.options.httpOnly, true,
                'cookie sesi WAJIB httpOnly, kalau tidak XSS bisa membacanya lagi');
            assert.strictEqual(sesi.options.sameSite, 'lax',
                'sameSite menahan permintaan lintas situs yang mengubah data');
            assert.strictEqual(sesi.options.secure, env === 'production',
                'cookie hanya boleh dikirim lewat HTTPS di production');
            assert.strictEqual(sesi.value, token);
            assert.ok(Math.abs(sesi.options.maxAge - 24 * 60 * 60 * 1000) < 5000,
                'masa berlaku cookie harus mengikuti klaim exp pada token');

            assert.strictEqual(anti.options.httpOnly, false,
                'cookie CSRF justru HARUS terbaca JavaScript untuk dikirim balik sebagai header');
            assert.ok(/^[0-9a-f]{64}$/.test(csrf), 'token CSRF harus acak dan panjang');
        } finally {
            process.env.NODE_ENV = semula;
        }
    }

    const res = fakeRes();
    clearSessionCookies(res);
    assert.strictEqual(res.jar[SESSION_COOKIE].cleared, true);
    assert.strictEqual(res.jar[CSRF_COOKIE].cleared, true);
}

function testSumberToken() {
    assert.deepStrictEqual(
        readAuthToken(fakeReq({ cookies: { [SESSION_COOKIE]: token } })),
        { token, source: 'cookie' }
    );
    assert.deepStrictEqual(
        readAuthToken(fakeReq({ headers: { authorization: `Bearer ${token}` } })),
        { token, source: 'header' },
        'header Authorization tetap diterima untuk klien non-browser'
    );
    // Cookie harus menang: browser selalu mengirimnya, itu sumber yang dipercaya.
    assert.strictEqual(
        readAuthToken(fakeReq({
            cookies: { [SESSION_COOKIE]: token },
            headers: { authorization: 'Bearer token-lain' }
        })).source,
        'cookie'
    );
    assert.strictEqual(readAuthToken(fakeReq({})).token, null);
}

function testCsrf() {
    const csrf = 'a'.repeat(64);

    // Metode aman tidak pernah diperiksa.
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        assert.strictEqual(
            jalankanCsrf(fakeReq({ method, cookies: { [CSRF_COOKIE]: csrf } })).lanjut,
            true,
            `${method} tidak boleh diblokir CSRF`
        );
    }

    // Inti serangan CSRF: situs lain memicu POST, cookie ikut terkirim otomatis,
    // tetapi penyerang tidak bisa membaca cookie untuk menyusun headernya.
    const tanpaHeader = jalankanCsrf(fakeReq({ cookies: { [CSRF_COOKIE]: csrf } }));
    assert.strictEqual(tanpaHeader.lanjut, false, 'POST tanpa header CSRF harus ditolak');
    assert.strictEqual(tanpaHeader.status, 403);
    assert.strictEqual(tanpaHeader.body.code, 'CSRF_TOKEN_INVALID');

    const headerSalah = jalankanCsrf(fakeReq({
        cookies: { [CSRF_COOKIE]: csrf },
        headers: { 'x-csrf-token': 'b'.repeat(64) }
    }));
    assert.strictEqual(headerSalah.lanjut, false, 'header CSRF yang salah harus ditolak');

    const cocok = jalankanCsrf(fakeReq({
        cookies: { [CSRF_COOKIE]: csrf },
        headers: { 'x-csrf-token': csrf }
    }));
    assert.strictEqual(cocok.lanjut, true, 'header CSRF yang cocok harus diteruskan');

    // Panjang berbeda tidak boleh membuat perbandingan waktu-tetap melempar error.
    const pendek = jalankanCsrf(fakeReq({
        cookies: { [CSRF_COOKIE]: csrf },
        headers: { 'x-csrf-token': 'pendek' }
    }));
    assert.strictEqual(pendek.lanjut, false);

    // Tanpa cookie CSRF berarti bukan sesi cookie (login, atau klien yang
    // memakai header Authorization) - jalur itu memang kebal CSRF.
    assert.strictEqual(jalankanCsrf(fakeReq({})).lanjut, true);
}

function testTokenTidakAdaDiFrontend() {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', 'public', 'js');
    const temuan = [];

    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
        const isi = fs.readFileSync(path.join(dir, file), 'utf8');
        isi.split('\n').forEach((baris, index) => {
            if (/localStorage\.(set|get)Item\(\s*['"]token['"]/.test(baris)
                || /['"]Authorization['"]\s*:/.test(baris)) {
                temuan.push(`${file}:${index + 1}  ${baris.trim().slice(0, 90)}`);
            }
        });
    }

    assert.deepStrictEqual(
        temuan, [],
        'Token JWT tidak boleh kembali ke localStorage atau header Authorization:\n' + temuan.join('\n')
    );

    // Respons login tidak lagi memuat `token`, jadi kode yang memakainya
    // sebagai penanda "sudah masuk" akan diam-diam gagal: pengguna dilempar
    // kembali ke form login padahal sesinya sudah aktif. Penandanya kini `role`.
    const bergantungToken = [];
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
        const isi = fs.readFileSync(path.join(dir, file), 'utf8');
        isi.split('\n').forEach((baris, index) => {
            if (baris.trim().startsWith('//')) return;
            if (/\bdata\.token\b/.test(baris)) {
                bergantungToken.push(`${file}:${index + 1}  ${baris.trim().slice(0, 90)}`);
            }
        });
    }
    assert.deepStrictEqual(
        bergantungToken, [],
        'Jangan memakai data.token sebagai penanda sesi; pakai data.role:\n' + bergantungToken.join('\n')
    );
}

testAtributCookie();
testSumberToken();
testCsrf();
testTokenTidakAdaDiFrontend();

console.log('Session cookie & CSRF: OK');
