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
 *  4. Pesan "Petugas berhasil ditambahkan" tidak punya masa berlaku. Ia tetap
 *     terpampang saat admin sudah mulai mengetik petugas BERIKUTNYA, seolah
 *     isian yang sedang diketik itulah yang barusan tersimpan. Ketiga
 *     formulir kuota memakai pola yang sama dan tunduk pada aturan yang sama.
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
        _pendengar: {},
        addEventListener(jenis, fn) {
            (this._pendengar[jenis] = this._pendengar[jenis] || []).push(fn);
        },
        /** Meniru pengguna yang berinteraksi dengan kolom ini. */
        _picu(jenis) {
            for (const fn of this._pendengar[jenis] || []) fn({ target: this });
        },
        setAttribute() {},
        removeAttribute() {},
        focus() {},
        closest() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; }
    };
}

/**
 * Jam palsu. Masa berlaku pesan sukses diukur dengan setTimeout; menunggunya
 * sungguhan membuat pengujian menahan 6 detik tanpa alasan.
 */
function buatJam() {
    let urut = 0;
    const antrean = new Map();
    return {
        setTimeout(fn, ms) { antrean.set(++urut, { fn, ms }); return urut; },
        clearTimeout(id) { antrean.delete(id); },
        jumlahTertunda() { return antrean.size; },
        majukan(ms) {
            for (const [id, tugas] of [...antrean]) {
                if (tugas.ms <= ms) { antrean.delete(id); tugas.fn(); }
            }
        }
    };
}

function muatAdminJs() {
    const jam = buatJam();
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
        setTimeout: (fn, ms) => jam.setTimeout(fn, ms),
        clearTimeout: (id) => jam.clearTimeout(id),
        setInterval, clearInterval,
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
    const baca = (nama) => vm.runInContext(nama, ctx);
    return { ctx, ambil, jam, baca };
}

async function ujiKlien() {
    const { ctx, ambil, jam, baca } = muatAdminJs();

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

    // --- 2c. pesan sukses punya masa berlaku -----------------------
    const sukses = ambil('petugas-success');

    // (i) Mengetik di kolom mana pun = admin beralih ke petugas berikutnya.
    for (const [inputId] of kolom) {
        tampilkanUlangSukses(ctx, sukses, jam);
        ambil(inputId)._picu('input');
        assert.strictEqual(
            sukses.style.display, 'none',
            'mengetik di ' + inputId + ' seharusnya mencabut pesan sukses'
        );
        assert.strictEqual(sukses.textContent, '', 'teks pesan sukses seharusnya ikut dikosongkan');
    }

    // (ii) Tanpa diapa-apakan pun pesan hilang sendiri setelah masa berlakunya.
    tampilkanUlangSukses(ctx, sukses, jam);
    jam.majukan(5000);
    assert.strictEqual(sukses.style.display, 'block', 'pesan tidak boleh hilang sebelum masa berlakunya habis');
    jam.majukan(6000);
    assert.strictEqual(sukses.style.display, 'none', 'pesan seharusnya hilang sendiri setelah masa berlakunya');

    // (iii) Penghitung waktu tidak boleh menumpuk saat pesan tampil berulang.
    tampilkanUlangSukses(ctx, sukses, jam);
    tampilkanUlangSukses(ctx, sukses, jam);
    assert.strictEqual(jam.jumlahTertunda(), 1, 'hanya boleh ada satu penghitung waktu yang aktif');
    ambil('new-nip')._picu('input');
    assert.strictEqual(jam.jumlahTertunda(), 0, 'penghitung waktu harus ikut dimatikan saat pesan dicabut');

    lolos.push('pesan sukses hilang saat admin mengetik dan setelah masa berlakunya habis');

    // --- 2d. ketiga formulir kuota memakai aturan yang sama --------
    // Daftar kolomnya diambil dari KUOTA_FORM di admin.js, bukan disalin ke
    // sini, supaya penambahan kolom baru ikut terjaga dengan sendirinya.
    const kuotaForm = baca('KUOTA_FORM');
    assert.ok(kuotaForm, 'KUOTA_FORM tidak terjangkau dari admin.js');
    assert.deepStrictEqual(
        Object.keys(kuotaForm).sort(),
        ['kecamatan', 'kelurahan', 'petugas'],
        'ketiga formulir kuota harus ikut terjaga'
    );

    for (const [tipe, m] of Object.entries(kuotaForm)) {
        const kotak = ambil(m.suc);
        const kolomKuota = [m.id, m.mode, m.tgl, m.tglEnd, m.max, m.unl].filter(Boolean);

        for (const inputId of kolomKuota) {
            // 'change' untuk dropdown, tanggal, dan kotak centang.
            tampilkanUlangSukses(ctx, kotak, jam, m.suc);
            ambil(inputId)._picu('change');
            assert.strictEqual(
                kotak.style.display, 'none',
                'mengubah ' + inputId + ' seharusnya mencabut pesan sukses ' + tipe
            );

            tampilkanUlangSukses(ctx, kotak, jam, m.suc);
            ambil(inputId)._picu('input');
            assert.strictEqual(
                kotak.style.display, 'none',
                'mengetik di ' + inputId + ' seharusnya mencabut pesan sukses ' + tipe
            );
        }

        tampilkanUlangSukses(ctx, kotak, jam, m.suc);
        jam.majukan(6000);
        assert.strictEqual(
            kotak.style.display, 'none',
            'pesan sukses ' + tipe + ' seharusnya hilang sendiri setelah masa berlakunya'
        );
    }

    // Penghitung waktu tiap kotak berdiri sendiri: memunculkan pesan di satu
    // formulir tidak boleh mematikan hitungan formulir lain.
    tampilkanUlangSukses(ctx, ambil('kec-success'), jam, 'kec-success');
    tampilkanUlangSukses(ctx, ambil('kel-success'), jam, 'kel-success');
    assert.strictEqual(jam.jumlahTertunda(), 2, 'tiap kotak pesan harus punya penghitung sendiri');
    assert.strictEqual(ambil('kec-success').style.display, 'block', 'pesan kecamatan tidak boleh ikut tercabut');

    lolos.push('ketiga formulir kuota memakai aturan masa berlaku yang sama');
}

/** Memunculkan kembali pesan sukses untuk pemeriksaan berikutnya. */
function tampilkanUlangSukses(ctx, sukses, jam, sucId) {
    ctx.tampilkanSukses(sucId || 'petugas-success', 'Berhasil disimpan');
    assert.strictEqual(sukses.style.display, 'block', 'pesan sukses gagal dimunculkan');
    assert.ok(jam.jumlahTertunda() >= 1, 'pesan sukses harus disertai penghitung waktu');
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
