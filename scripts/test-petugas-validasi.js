/**
 * Test validasi data petugas di halaman admin.
 *
 * Tiga regresi yang dijaga di sini, semuanya pernah terjadi:
 *
 *  1. Email milik pemohon bisa dipasang ke akun petugas. UNIQUE KEY hanya
 *     berlaku dalam satu tabel, sedangkan pemeriksaan aplikasi dulu hanya
 *     menengok tabel petugas - jadi satu alamat email bisa dimiliki dua akun
 *     sekaligus dan menerima OTP untuk keduanya.
 *
 *  2. Pesan validasi per kolom tidak ikut hilang ketika petugas berhasil
 *     ditambahkan. Nilainya dikosongkan, tetapi "Format NIP valid." dan
 *     kawan-kawannya tetap tertinggal lengkap dengan warna hijaunya di bawah
 *     kolom yang sudah kosong.
 *
 *  3. Nama lengkap divalidasi sebagai "minimal 3 karakter", sehingga "123"
 *     dan "..." lolos sebagai nama petugas. Yang dimaksud adalah 3 HURUF.
 *
 * Berjalan tanpa database maupun browser: pool distub lewat require.cache
 * (pola scripts/test-ganti-sandi.js) dan DOM distub di dalam vm (pola
 * scripts/test-login-petugas-ui.js).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const lolos = [];

// ==================================================================
// BAGIAN 1 - SISI SERVER
// ==================================================================

// Isi database tiruan: satu pemohon dan satu petugas yang sudah ada.
const pemohon = { id: 1, email: 'warga@contoh.test' };
const petugasLama = { id: 7, nip: '198001012006041001', email: 'petugas.lama@contoh.test' };

const kueri = [];
let barisTerakhirDisisipkan = null;

function jawabKueri(sql, values = []) {
    const teks = String(sql.sql || sql).replace(/\s+/g, ' ').trim();
    kueri.push({ teks, values });

    if (/^SELECT id FROM users WHERE LOWER\(email\)/i.test(teks)) {
        return [values[0] === pemohon.email ? [{ id: pemohon.id }] : []];
    }
    if (/^SELECT id FROM petugas WHERE LOWER\(email\)/i.test(teks)) {
        const cocok = values[0] === petugasLama.email && values[1] !== petugasLama.id;
        return [cocok ? [{ id: petugasLama.id }] : []];
    }
    if (/^SELECT id FROM admin WHERE LOWER\(email\)/i.test(teks)) return [[]];
    // editPetugas memastikan dulu petugas yang disunting memang ada.
    if (/^SELECT id FROM petugas WHERE id = \?/i.test(teks)) {
        return [Number(values[0]) === petugasLama.id ? [{ id: petugasLama.id }] : []];
    }
    if (/^SELECT id FROM petugas WHERE nip/i.test(teks)) {
        return [values[0] === petugasLama.nip ? [{ id: petugasLama.id }] : []];
    }
    if (/^INSERT INTO petugas/i.test(teks)) {
        barisTerakhirDisisipkan = values;
        return [{ insertId: 99 }];
    }
    if (/^(UPDATE|ALTER|CREATE|SHOW|SELECT GET_LOCK|SELECT RELEASE_LOCK)/i.test(teks)) {
        return [[{ acquired: 1 }]];
    }
    return [[]];
}

const koneksiTiruan = {
    query: async (sql, values) => jawabKueri(sql, values),
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {}
};

const poolTiruan = {
    query: async (sql, values) => jawabKueri(sql, values),
    getConnection: async () => koneksiTiruan
};

require.cache[require.resolve('../config/db')] = { exports: poolTiruan };
require.cache[require.resolve('../utils/notifikasi')] = {
    exports: { ensureNotificationSchema: async () => {} }
};
require.cache[require.resolve('../utils/sandi')] = {
    exports: { ensureSandiSchema: async () => {}, TABEL_AKUN: {} }
};
require.cache[require.resolve('../utils/auditLog')] = {
    exports: { catatAudit: async () => {} }
};
require.cache[require.resolve('../controllers/sandiController')] = {
    exports: { beritahuPemilikAkun: async () => {} }
};
require.cache[require.resolve('../middleware/auth')] = {
    exports: Object.assign(() => {}, { invalidateAccountStatus() {} })
};

// utils/phone dibiarkan asli KECUALI bagian yang menyentuh skema dan kunci
// database, supaya normalisasi nomor yang dipakai controller tetap yang asli.
const phoneAsli = require('../utils/phone');
require.cache[require.resolve('../utils/phone')] = {
    exports: {
        ...phoneAsli,
        ensurePhoneSchema: async () => ({ normalized: [], invalid: [] }),
        assertPhoneAvailable: async () => {},
        acquirePhoneLock: async () => 'kunci-uji',
        releasePhoneLock: async () => {}
    }
};

const { assertEmailAvailable } = require('../utils/emailAkun');
const { tambahPetugas, editPetugas } = require('../controllers/adminController');

function buatRes() {
    return {
        statusCode: 200,
        body: null,
        status(kode) { this.statusCode = kode; return this; },
        json(isi) { this.body = isi; return this; }
    };
}

const bodyValid = () => ({
    nip: '199002022010011002',
    nama_lengkap: 'Budi Santoso',
    email: 'budi.baru@contoh.test',
    no_hp: '081234567890',
    password: 'SandiAwal123'
});

const NAMA_DITOLAK = ['12', '123', '...', 'A1', '  a  '];
const NAMA_DITERIMA = ['Ali', 'H. Ma' + String.fromCharCode(39) + 'ruf', 'Sri Wahyuni'];

async function ujiServer() {
    // --- 1a. assertEmailAvailable menengok SEMUA tabel akun ---------
    await assert.rejects(
        () => assertEmailAvailable(koneksiTiruan, pemohon.email),
        (err) => err.status === 409 && /pemohon/i.test(err.message),
        'email milik pemohon harus ditolak'
    );
    await assert.rejects(
        () => assertEmailAvailable(koneksiTiruan, petugasLama.email),
        (err) => err.status === 409 && /petugas/i.test(err.message)
    );
    // Huruf kapital berbeda tetap dianggap email yang sama.
    await assert.rejects(
        () => assertEmailAvailable(koneksiTiruan, 'Warga@Contoh.Test'),
        (err) => err.status === 409
    );
    // Saat menyunting, baris petugas itu sendiri bukan bentrokan.
    await assertEmailAvailable(koneksiTiruan, petugasLama.email, { excludePetugasId: petugasLama.id });
    await assertEmailAvailable(koneksiTiruan, 'benar-benar-baru@contoh.test');
    lolos.push('assertEmailAvailable memeriksa users, petugas, dan admin');

    // --- 1b. tambahPetugas menolak email milik pemohon --------------
    let res = buatRes();
    await tambahPetugas({ body: { ...bodyValid(), email: pemohon.email } }, res);
    assert.strictEqual(res.statusCode, 409, 'email pemohon harus ditolak dengan 409');
    assert.match(res.body.message, /pemohon/i);

    res = buatRes();
    await tambahPetugas({ body: bodyValid() }, res);
    assert.strictEqual(res.statusCode, 201, 'email yang belum dipakai harus diterima');
    assert.ok(barisTerakhirDisisipkan, 'petugas seharusnya tersimpan');
    lolos.push('tambahPetugas menolak email yang sudah dipakai pemohon');

    // --- 1c. editPetugas juga memeriksa lintas tabel ----------------
    res = buatRes();
    await editPetugas(
        { params: { id: petugasLama.id }, body: { ...bodyValid(), email: pemohon.email } },
        res
    );
    assert.strictEqual(res.statusCode, 409, 'edit ke email pemohon harus ditolak');
    assert.match(res.body.message, /pemohon/i);
    lolos.push('editPetugas menolak email yang sudah dipakai pemohon');

    // --- 1d. nama lengkap minimal 3 huruf di sisi server ------------
    for (const nama of NAMA_DITOLAK) {
        res = buatRes();
        await tambahPetugas({ body: { ...bodyValid(), nama_lengkap: nama } }, res);
        assert.strictEqual(res.statusCode, 400, 'nama "' + nama + '" seharusnya ditolak');
        assert.match(res.body.message, /3 huruf/i);
    }
    for (const nama of NAMA_DITERIMA) {
        res = buatRes();
        await tambahPetugas({ body: { ...bodyValid(), nama_lengkap: nama } }, res);
        assert.strictEqual(res.statusCode, 201, 'nama "' + nama + '" seharusnya diterima');
    }
    lolos.push('server menolak nama lengkap dengan kurang dari 3 huruf');
}

// ==================================================================
// BAGIAN 2 - SISI KLIEN (public/js/admin.js di dalam vm)
// ==================================================================

const adminHtml = fs.readFileSync(path.join(root, 'public', 'pages', 'admin.html'), 'utf8');

/** Mengambil teks petunjuk awal sebuah <small id="..."> langsung dari HTML. */
function petunjukAwalDariHtml(id) {
    const pola = new RegExp('<small id="' + id + '"[^>]*>([^<]*)</small>');
    const cocok = adminHtml.match(pola);
    assert.ok(cocok, 'petunjuk awal ' + id + ' tidak ditemukan di admin.html');
    return cocok[1].trim();
}

function buatElemen(id, textContent) {
    return {
        id,
        value: '',
        textContent: textContent || '',
        innerHTML: '',
        disabled: false,
        type: 'text',
        title: '',
        dataset: {},
        style: {},
        classList: {
            _kelas: new Set(),
            add(k) { this._kelas.add(k); },
            remove(k) { this._kelas.delete(k); },
            contains(k) { return this._kelas.has(k); },
            toggle(k, paksa) {
                const aktif = paksa === undefined ? !this._kelas.has(k) : Boolean(paksa);
                if (aktif) this._kelas.add(k); else this._kelas.delete(k);
                return aktif;
            }
        },
        addEventListener() {},
        setAttribute() {},
        removeAttribute() {},
        focus() {},
        closest() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; }
    };
}

function muatAdminJs() {
    const simpanan = new Map();
    const ambil = (id) => {
        if (!simpanan.has(id)) {
            const awal = /-feedback$/.test(id) ? petunjukAwalDariHtml(id) : '';
            simpanan.set(id, buatElemen(id, awal));
        }
        return simpanan.get(id);
    };

    const ctx = {
        console,
        setTimeout, clearTimeout, setInterval, clearInterval,
        localStorage: {
            getItem: (k) => (k === 'role' ? 'admin' : 'Admin Uji'),
            setItem() {}, removeItem() {}, clear() {}
        },
        document: {
            getElementById: ambil,
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener() {},
            createElement: () => buatElemen('baru')
        },
        window: { location: { href: '' }, addEventListener() {} },
        escapeHTML: (v) => String(v === undefined || v === null ? '' : v),
        stripHTML: (v) => String(v === undefined || v === null ? '' : v),
        formatDate: (v) => String(v === undefined || v === null ? '' : v),
        formatDateTime: (v) => String(v === undefined || v === null ? '' : v),
        formatWaktu: (v) => String(v === undefined || v === null ? '' : v),
        safeMapsUrl: () => '#',
        safeWhatsAppUrl: () => '#',
        csrfToken: () => 'uji',
        akhiriSesi() {},
        // Semua pemuatan data dianggap kosong; yang diuji hanya formulir.
        apiFetch: async () => ({ ok: true, status: 200, json: async () => [] }),
        AppAsync: {
            setButtonLoading: () => true,
            renderList: async () => {},
            responseError: async (_res, pesan) => new Error(pesan),
            errorMessage: (_e, cadangan) => cadangan
        }
    };
    vm.createContext(ctx);
    vm.runInContext(
        fs.readFileSync(path.join(root, 'public', 'js', 'phone-validation.js'), 'utf8'),
        ctx,
        { filename: 'public/js/phone-validation.js' }
    );
    ctx.PhoneValidation = ctx.window.PhoneValidation;
    vm.runInContext(
        fs.readFileSync(path.join(root, 'public', 'js', 'admin.js'), 'utf8'),
        ctx,
        { filename: 'public/js/admin.js' }
    );
    return { ctx, ambil };
}

async function ujiKlien() {
    const { ctx, ambil } = muatAdminJs();

    // --- 2a. nama lengkap dihitung per HURUF ------------------------
    for (const nama of NAMA_DITOLAK.concat(['-- 99 --'])) {
        ambil('new-nama').value = nama;
        const hasil = ctx.validatePetugasName('new-nama', 'new-nama-feedback', true);
        assert.strictEqual(hasil.valid, false, 'nama "' + nama + '" seharusnya ditolak di klien');
        assert.match(hasil.message, /3 huruf/i);
    }
    for (const nama of NAMA_DITERIMA) {
        ambil('new-nama').value = nama;
        const hasil = ctx.validatePetugasName('new-nama', 'new-nama-feedback', true);
        assert.strictEqual(hasil.valid, true, 'nama "' + nama + '" seharusnya diterima di klien');
    }
    lolos.push('klien menolak nama lengkap dengan kurang dari 3 huruf');

    // --- 2b. pesan validasi ikut hilang setelah berhasil ------------
    const kolom = [
        ['new-nip', 'new-nip-feedback', '199002022010011002'],
        ['new-nama', 'new-nama-feedback', 'Budi Santoso'],
        ['new-email', 'new-email-feedback', 'budi.baru@contoh.test'],
        ['new-hp', 'new-hp-feedback', '081234567890'],
        ['new-password', 'new-password-feedback', 'SandiAwal123']
    ];
    for (const [inputId, , nilai] of kolom) ambil(inputId).value = nilai;

    ctx.apiFetch = async () => ({
        ok: true,
        status: 201,
        json: async () => ({ message: 'Petugas berhasil ditambahkan', petugas: { id: 99 } })
    });

    await ctx.tambahPetugas();

    for (const [inputId, feedbackId] of kolom) {
        const input = ambil(inputId);
        const feedback = ambil(feedbackId);
        assert.strictEqual(input.value, '', inputId + ' seharusnya dikosongkan');
        assert.strictEqual(
            feedback.textContent,
            petunjukAwalDariHtml(feedbackId),
            feedbackId + ' seharusnya kembali ke petunjuk awal, bukan "' + feedback.textContent + '"'
        );
        for (const kelas of ['is-valid', 'is-error']) {
            assert.ok(!feedback.classList.contains(kelas), feedbackId + ' masih berkelas ' + kelas);
        }
        const kelasInput = [
            'petugas-input-valid', 'petugas-input-invalid',
            'phone-input-valid', 'phone-input-invalid'
        ];
        for (const kelas of kelasInput) {
            assert.ok(!input.classList.contains(kelas), inputId + ' masih berkelas ' + kelas);
        }
    }
    assert.strictEqual(
        ambil('petugas-success').style.display, 'block',
        'pesan sukses harus tetap tampil'
    );
    lolos.push('pesan validasi per kolom hilang setelah petugas berhasil ditambahkan');
}

(async () => {
    await ujiServer();
    await ujiKlien();
    console.log('Petugas validation: OK');
    for (const baris of lolos) console.log('  - ' + baris);
})().catch((err) => {
    console.error('Petugas validation: GAGAL\n', err);
    process.exit(1);
});
