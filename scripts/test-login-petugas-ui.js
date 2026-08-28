/**
 * Test keadaan panel di halaman login internal (petugas & admin).
 *
 * Regresi yang dijaga: tab PETUGAS punya sub-keadaan (lupa sandi, pengisian
 * OTP). Sebelumnya switchTab selalu memaksa kembali ke formulir masuk, sehingga
 * berpindah sejenak ke tab ADMIN lalu kembali akan membuang keadaan itu -
 * termasuk saat pengguna sudah berada di layar OTP dan sudah mengetik kodenya.
 *
 * Berjalan tanpa browser: DOM distub secukupnya di dalam vm.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'login-petugas.js'),
    'utf8'
);

const ids = [
    'form-petugas', 'form-admin', 'form-lupa', 'form-otp',
    'btn-tab-petugas', 'btn-tab-admin',
    'nip', 'pet-password', 'pet-error',
    'adm-username', 'adm-password', 'adm-error',
    'lupa-nip', 'lupa-error', 'lupa-info',
    'otp-kode', 'otp-sandi', 'otp-sandi-ulang', 'otp-error', 'otp-sukses',
    'btn-kirim-otp', 'btn-simpan-otp'
];

function buatElemen(id) {
    return {
        id,
        value: '',
        textContent: '',
        disabled: false,
        dataset: {},
        style: { display: id === 'form-petugas' ? 'block' : 'none' },
        classList: {
            _kelas: new Set(),
            add(k) { this._kelas.add(k); },
            remove(k) { this._kelas.delete(k); },
            contains(k) { return this._kelas.has(k); }
        }
    };
}

const elements = Object.fromEntries(ids.map((id) => [id, buatElemen(id)]));

const context = {
    console,
    document: {
        getElementById: (id) => elements[id] || null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {}
    },
    window: { location: { href: '' } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    AppAsync: {
        setButtonLoading: () => true,
        fetchWithTimeout: async () => ({ ok: true, json: async () => ({}) }),
        errorMessage: (e, f) => f
    },
    csrfToken: () => 'uji'
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'public/js/login-petugas.js' });

const panelTampil = () => ids
    .filter((id) => id.startsWith('form-'))
    .find((id) => elements[id].style.display === 'block');

function testTabPetugasMengingatSubKeadaan() {
    vm.runInContext("switchTab('petugas');", context);
    assert.strictEqual(panelTampil(), 'form-petugas');

    vm.runInContext('bukaLupaSandi();', context);
    assert.strictEqual(panelTampil(), 'form-lupa', 'harus pindah ke layar lupa sandi');

    vm.runInContext("switchTab('admin');", context);
    assert.strictEqual(panelTampil(), 'form-admin');

    vm.runInContext("switchTab('petugas');", context);
    assert.strictEqual(
        panelTampil(), 'form-lupa',
        'kembali ke tab PETUGAS harus memulihkan layar lupa sandi, bukan formulir masuk'
    );
}

function testLayarOtpJugaDiingat() {
    // Masuk ke layar OTP seperti setelah permintaan kode berhasil.
    vm.runInContext("tampilkanPanel('form-otp');", context);
    elements['otp-kode'].value = '123456';

    vm.runInContext("switchTab('admin');", context);
    assert.strictEqual(panelTampil(), 'form-admin');

    vm.runInContext("switchTab('petugas');", context);
    assert.strictEqual(
        panelTampil(), 'form-otp',
        'layar OTP harus dipulihkan - kalau tidak, kode yang sudah diketik hilang'
    );
    assert.strictEqual(elements['otp-kode'].value, '123456', 'isian OTP tidak boleh terhapus');
}

function testKembaliMereseIngatan() {
    vm.runInContext('kembaliKeLoginPetugas();', context);
    assert.strictEqual(panelTampil(), 'form-petugas');

    vm.runInContext("switchTab('admin');", context);
    vm.runInContext("switchTab('petugas');", context);
    assert.strictEqual(
        panelTampil(), 'form-petugas',
        'setelah kembali ke halaman masuk, berpindah tab tidak boleh membuka lupa sandi lagi'
    );
}

function testTabAktifIkutBerpindah() {
    vm.runInContext("switchTab('admin');", context);
    assert.ok(elements['btn-tab-admin'].classList.contains('active'));
    assert.ok(!elements['btn-tab-petugas'].classList.contains('active'));

    vm.runInContext("switchTab('petugas');", context);
    assert.ok(elements['btn-tab-petugas'].classList.contains('active'));
    assert.ok(!elements['btn-tab-admin'].classList.contains('active'));
}

testTabPetugasMengingatSubKeadaan();
testLayarOtpJugaDiingat();
testKembaliMereseIngatan();
testTabAktifIkutBerpindah();

console.log('Login internal panel states: OK');
