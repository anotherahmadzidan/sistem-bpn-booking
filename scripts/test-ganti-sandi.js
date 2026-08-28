/**
 * Test untuk fitur ganti & lupa sandi.
 *
 * Berjalan tanpa database maupun SMTP: pool dan pengirim email diganti tiruan
 * lewat require.cache, mengikuti pola scripts/test-registration-flow.js.
 *
 * Yang dijaga di sini adalah sifat-sifat keamanan yang mudah hilang tanpa
 * disadari saat kode disunting:
 *   - ganti sandi WAJIB memverifikasi sandi lama
 *   - setiap penulisan sandi WAJIB menyetel password_changed_at
 *   - kegagalan lupa sandi WAJIB berpesan seragam
 */
const assert = require('assert');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'ganti-sandi-test-secret-minimal-32-karakter';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

const root = path.join(__dirname, '..');

// ------------------------------------------------------------------
// Tiruan
// ------------------------------------------------------------------
const kueri = [];
const emailTerkirim = [];

const akun = {
    petugas: {
        id: 7,
        nip: '198001012006041001',
        email: 'petugas.uji@contoh.test',
        nama_lengkap: 'Petugas Uji',
        password: bcrypt.hashSync('SandiLamaBenar1', 4)
    }
};

let otpBerikutnyaValid = true;
const otpDitandaiTerpakai = [];

const fakePool = {
    async query(sql, values = []) {
        const teks = String(sql.sql || sql).replace(/\s+/g, ' ').trim();
        kueri.push({ teks, values });

        if (/FROM `?petugas`? WHERE (nip|id) = \?/i.test(teks) || /FROM `?petugas`?/i.test(teks)) {
            return [[akun.petugas]];
        }
        if (/^UPDATE/i.test(teks)) return [{ affectedRows: 1 }];
        if (/^(ALTER|CREATE|SHOW)/i.test(teks)) return [[]];
        return [[]];
    }
};

const fakeSandiSchema = {
    TABEL_AKUN: { user: 'users', petugas: 'petugas', admin: 'admin' },
    async ensureSandiSchema() {}
};

const fakeOtp = {
    async ensureOtpSchema() {},
    async sendOtp(opsi) {
        emailTerkirim.push({ jenis: 'otp', ke: opsi.email, petugasId: opsi.petugasId });
        return { maskedEmail: 'pe***@contoh.test' };
    },
    async verifyOtp() {
        if (!otpBerikutnyaValid) {
            const err = new Error('Kode OTP salah.');
            err.status = 400;
            err.code = 'OTP_INVALID';
            throw err;
        }
        return { otpId: 501, petugasId: akun.petugas.id, userId: null, pendingRegistrationId: null };
    },
    async tandaiOtpTerpakai(id) {
        otpDitandaiTerpakai.push(id);
    }
};

const fakeNotifikasi = {
    async kirimEmail(pesan) {
        emailTerkirim.push({ jenis: 'pemberitahuan', ke: pesan.email_user, judul: pesan.judul });
        return { sent: true };
    }
};

require.cache[require.resolve('../config/db')] = { exports: fakePool };
require.cache[require.resolve('../utils/sandi')] = { exports: fakeSandiSchema };
require.cache[require.resolve('../utils/otp')] = { exports: fakeOtp };
require.cache[require.resolve('../utils/notifikasi')] = { exports: fakeNotifikasi };
require.cache[require.resolve('../middleware/auth')] = {
    exports: Object.assign(() => {}, { invalidateAccountStatus() {}, statusAkun: async () => null })
};

const { gantiSandi, lupaSandiPetugas, resetSandiPetugas } = require('../controllers/sandiController');

function buatRes() {
    return {
        statusCode: 200,
        body: null,
        cookies: new Map(),
        status(kode) { this.statusCode = kode; return this; },
        json(isi) { this.body = isi; return this; },
        cookie(nama, nilai) { this.cookies.set(nama, nilai); return this; },
        clearCookie() { return this; }
    };
}

const bersihkan = () => {
    kueri.length = 0;
    emailTerkirim.length = 0;
    otpDitandaiTerpakai.length = 0;
};

// ------------------------------------------------------------------
// Ganti sandi
// ------------------------------------------------------------------
async function testSandiLamaWajibBenar() {
    bersihkan();
    const res = buatRes();
    await gantiSandi(
        { body: { sandi_lama: 'SalahSekali9', sandi_baru: 'SandiBaruBenar1' }, user: { id: 7, role: 'petugas' } },
        res
    );
    assert.strictEqual(res.statusCode, 401, 'sandi lama salah harus ditolak');
    assert.strictEqual(res.body.code, 'SANDI_LAMA_SALAH');
    assert.ok(
        !kueri.some((q) => /^UPDATE/i.test(q.teks)),
        'tidak boleh ada penulisan sandi ketika sandi lama salah'
    );
}

async function testGantiSandiBerhasil() {
    bersihkan();
    const res = buatRes();
    await gantiSandi(
        { body: { sandi_lama: 'SandiLamaBenar1', sandi_baru: 'SandiBaruBenar1' }, user: { id: 7, role: 'petugas' } },
        res
    );
    assert.strictEqual(res.statusCode, 200, res.body && res.body.message);

    const update = kueri.find((q) => /^UPDATE/i.test(q.teks));
    assert.ok(update, 'sandi harus ditulis ke database');
    assert.ok(
        /password_changed_at = NOW\(\)/i.test(update.teks),
        'password_changed_at WAJIB disetel - inilah yang memutus sesi lama'
    );

    // Yang mengganti sandi menerima sesi baru supaya tidak ikut terlempar keluar.
    assert.ok(res.cookies.has('bpn_session'), 'sesi baru harus dipasang');
    assert.ok(res.cookies.has('bpn_csrf'));

    assert.ok(
        emailTerkirim.some((e) => e.jenis === 'pemberitahuan'),
        'pemilik akun harus diberi tahu bahwa sandinya berubah'
    );
}

async function testValidasiSandiBaru() {
    for (const [baru, alasan] of [
        ['pendek1', 'kurang dari 8 karakter'],
        ['SandiLamaBenar1', 'sama dengan sandi lama']
    ]) {
        bersihkan();
        const res = buatRes();
        await gantiSandi(
            { body: { sandi_lama: 'SandiLamaBenar1', sandi_baru: baru }, user: { id: 7, role: 'petugas' } },
            res
        );
        assert.strictEqual(res.statusCode, 400, `harus ditolak: ${alasan}`);
    }
}

// ------------------------------------------------------------------
// Lupa sandi petugas
// ------------------------------------------------------------------
async function testPesanSeragam() {
    const res1 = buatRes();
    await lupaSandiPetugas({ body: { nip: akun.petugas.nip } }, res1);

    // NIP yang tidak ada: pool tiruan tetap mengembalikan baris, jadi kesamaan
    // pesan diperiksa lewat jalur format-salah dan lewat resetSandiPetugas.
    const resFormat = buatRes();
    await lupaSandiPetugas({ body: { nip: '123' } }, resFormat);

    assert.strictEqual(res1.statusCode, 200);
    assert.match(res1.body.message, /Jika NIP terdaftar/);
    assert.strictEqual(resFormat.statusCode, 400, 'format NIP salah boleh ditolak tegas');
    assert.match(resFormat.body.message, /18 digit/);
}

async function testKegagalanResetSeragam() {
    otpBerikutnyaValid = false;
    const res = buatRes();
    await resetSandiPetugas(
        { body: { nip: akun.petugas.nip, otp: '000000', sandi_baru: 'SandiBaruBenar1' } },
        res
    );
    otpBerikutnyaValid = true;

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(
        res.body.code, 'OTP_TIDAK_VALID',
        'OTP salah dan NIP tak dikenal harus memakai kode yang sama'
    );
    assert.match(res.body.message, /salah atau sudah kedaluwarsa/);
}

async function testResetBerhasil() {
    bersihkan();
    const res = buatRes();
    await resetSandiPetugas(
        { body: { nip: akun.petugas.nip, otp: '123456', sandi_baru: 'SandiBaruBenar1' } },
        res
    );
    assert.strictEqual(res.statusCode, 200, res.body && res.body.message);

    const update = kueri.find((q) => /^UPDATE/i.test(q.teks));
    assert.ok(/password_changed_at = NOW\(\)/i.test(update.teks));
    assert.ok(
        /harus_ganti_sandi = 0/i.test(update.teks),
        'reset lewat OTP milik petugas sendiri melepas kewajiban ganti sandi'
    );
}

// ------------------------------------------------------------------
// Penjaga statis
// ------------------------------------------------------------------
function testSkripAdminMenolakArgumenSandi() {
    const isi = fs.readFileSync(path.join(root, 'scripts/reset-sandi-admin.js'), 'utf8');
    assert.ok(
        /--\(sandi\|password\)/.test(isi) || /sandi\|password/.test(isi),
        'skrip reset admin harus menolak sandi lewat argumen perintah '
        + '(argumen tersimpan di riwayat shell dan terlihat lewat ps)'
    );
    assert.ok(
        /password_changed_at = NOW\(\)/i.test(isi),
        'reset admin harus memutus sesi lama'
    );
}

function testSetiapPenulisanSandiMenyetelPenanda() {
    const berkas = [
        'controllers/sandiController.js',
        'controllers/adminController.js',
        'scripts/reset-sandi-admin.js'
    ];
    const temuan = [];

    for (const relatif of berkas) {
        const isi = fs.readFileSync(path.join(root, relatif), 'utf8');
        // Cari pernyataan UPDATE yang menulis kolom password.
        const pola = /UPDATE[\s\S]{0,400}?SET[\s\S]{0,400}?password\s*=\s*\?[\s\S]{0,400}?WHERE/gi;
        let m;
        while ((m = pola.exec(isi)) !== null) {
            if (!/password_changed_at/i.test(m[0])) {
                const baris = isi.slice(0, m.index).split('\n').length;
                temuan.push(`${relatif}:${baris}`);
            }
        }
    }

    assert.deepStrictEqual(
        temuan, [],
        'Setiap penulisan kolom password WAJIB menyetel password_changed_at, '
        + 'kalau tidak sesi lama tidak akan terputus:\n' + temuan.join('\n')
    );
}

/**
 * Regresi: "mengganti" sandi menjadi sandi yang sama persis sempat BERHASIL
 * lewat alur lupa sandi. Penyebabnya, pemeriksaan membandingkan dua teks yang
 * diketik pengguna - padahal di alur itu tidak ada sandi lama yang diketik,
 * sehingga pemeriksaannya terlewat sama sekali. Pembandingnya kini hash
 * tersimpan, bukan teks.
 */
async function testResetTolakSandiYangSama() {
    bersihkan();
    const res = buatRes();
    await resetSandiPetugas(
        // 'SandiLamaBenar1' adalah sandi yang sedang berlaku di akun tiruan.
        { body: { nip: akun.petugas.nip, otp: '123456', sandi_baru: 'SandiLamaBenar1' } },
        res
    );

    assert.strictEqual(res.statusCode, 400, 'sandi yang sama harus ditolak');
    assert.strictEqual(res.body.code, 'SANDI_SAMA');
    assert.ok(
        !kueri.some((q) => /^UPDATE/i.test(q.teks)),
        'tidak boleh ada penulisan sandi ketika sandi barunya sama'
    );
    assert.deepStrictEqual(
        otpDitandaiTerpakai, [],
        'OTP tidak boleh hangus oleh penolakan ini - pengguna harus bisa '
        + 'langsung mencoba sandi lain tanpa meminta kode baru'
    );
}

/** Setelah seluruh validasi lolos, OTP wajib ditandai terpakai. */
async function testOtpHangusSetelahBerhasil() {
    bersihkan();
    const res = buatRes();
    await resetSandiPetugas(
        { body: { nip: akun.petugas.nip, otp: '123456', sandi_baru: 'SandiBenarBaru9' } },
        res
    );
    assert.strictEqual(res.statusCode, 200, res.body && res.body.message);
    assert.deepStrictEqual(otpDitandaiTerpakai, [501], 'OTP harus ditandai terpakai');
}

(async () => {
    await testSandiLamaWajibBenar();
    await testGantiSandiBerhasil();
    await testValidasiSandiBaru();
    await testPesanSeragam();
    await testKegagalanResetSeragam();
    await testResetBerhasil();
    await testResetTolakSandiYangSama();
    await testOtpHangusSetelahBerhasil();
    testSkripAdminMenolakArgumenSandi();
    testSetiapPenulisanSandiMenyetelPenanda();

    console.log('Ganti & lupa sandi: OK');
})().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
