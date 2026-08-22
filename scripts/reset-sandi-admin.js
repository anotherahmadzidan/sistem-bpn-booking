/**
 * Jalur darurat untuk mengatur ulang kata sandi admin.
 *
 * Ini SATU-SATUNYA jalur pemulihan akun admin. Admin tidak bisa mereset
 * sandinya lewat email seperti petugas, karena akun admin memegang kendali
 * penuh atas sistem - membuatnya dapat dipulihkan lewat sebuah kotak surat
 * berarti menurunkan keamanan seluruh sistem menjadi setara keamanan email itu.
 *
 * Yang menjadi bukti identitas di sini adalah AKSES KE SERVER. Skrip ini tidak
 * dapat dijangkau dari internet: ia bukan endpoint, melainkan berkas yang harus
 * dijalankan langsung di mesin tempat aplikasi berada.
 *
 * Skrip ini tidak memberi kemampuan baru kepada siapa pun: orang yang bisa
 * menjalankannya sudah bisa mengubah database secara langsung. Yang ia berikan
 * hanyalah cara yang benar - hash bcrypt yang tepat dan pemutusan sesi lama.
 *
 * Pakai:
 *   node scripts/reset-sandi-admin.js
 */
const bcrypt = require('bcryptjs');
const readline = require('readline');
require('dotenv').config({ quiet: true });

const MIN_PANJANG_SANDI = 8;

// Kode tombol yang tidak ikut ditimpa saat menyamarkan ketikan.
const NEWLINE = 10;
const ENTER = 13;
const CTRL_D = 4;

// Sandi TIDAK boleh diterima lewat argumen perintah: isinya akan tersimpan di
// riwayat shell dan terlihat oleh siapa pun yang menjalankan `ps` di server.
const argumenSandi = process.argv.slice(2).find((a) => /^--(sandi|password)/i.test(a));
if (argumenSandi) {
    console.error(
        '\nDITOLAK: kata sandi tidak boleh diberikan lewat argumen perintah.\n'
        + 'Argumen tersimpan di riwayat shell dan terlihat lewat perintah ps.\n'
        + 'Jalankan tanpa argumen; sandi akan diminta secara interaktif.\n'
    );
    process.exit(1);
}

let rl = null;
let antrean = null;

/**
 * Saat masukan bukan terminal (dipipa, misalnya oleh pengujian otomatis),
 * seluruh isi stdin dibaca sekali di awal. Tanpa ini readline menutup diri
 * begitu pipa mencapai EOF, dan prompt berikutnya tidak pernah terjawab.
 */
async function siapkanMasukan() {
    if (process.stdin.isTTY) return;
    const potongan = [];
    for await (const bagian of process.stdin) potongan.push(bagian);
    antrean = potongan.join('').split(/\r?\n/);
}

function bacaan() {
    if (!rl) {
        rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    }
    return rl;
}

function tanya(teks) {
    if (antrean) {
        process.stdout.write(teks);
        const nilai = antrean.shift() || '';
        process.stdout.write('\n');
        return Promise.resolve(nilai);
    }
    return new Promise((resolve) => bacaan().question(teks, resolve));
}

/**
 * Membaca masukan tanpa menampilkannya di layar. Penyamaran hanya mungkin di
 * terminal sungguhan; pada masukan terpipa tidak ada layar yang bisa diintip.
 */
function tanyaTersembunyi(teks) {
    if (!process.stdin.isTTY) return tanya(teks);

    return new Promise((resolve) => {
        const onData = (char) => {
            const s = String(char);
            const kode = s.charCodeAt(0);
            if (kode === NEWLINE || kode === ENTER || kode === CTRL_D) return;
            readline.moveCursor(process.stdout, -s.length, 0);
            readline.clearLine(process.stdout, 1);
        };
        process.stdin.on('data', onData);
        bacaan().question(teks, (jawab) => {
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
            resolve(jawab);
        });
    });
}

async function selesai(pool, kode = 0) {
    if (rl) rl.close();
    if (pool) await pool.end();
    process.exitCode = kode;
}

(async () => {
    await siapkanMasukan();

    const pool = require('../config/db');
    const { ensureSandiSchema } = require('../utils/sandi');
    await ensureSandiSchema();

    const [admins] = await pool.query(
        'SELECT id, username, nama_lengkap FROM admin ORDER BY id'
    );

    if (admins.length === 0) {
        console.error('\nTidak ada akun admin di database ini.\n');
        return selesai(pool, 1);
    }

    console.log(`\nDatabase: ${process.env.DB_NAME || '(tidak diketahui)'}\n`);
    console.log('Akun admin yang terdaftar:');
    admins.forEach((a, i) => {
        console.log(`  [${i + 1}] ${a.username}  -  ${a.nama_lengkap}`);
    });

    const pilihan = Number(await tanya('\nPilih nomor akun: '));
    const target = admins[pilihan - 1];
    if (!target) {
        console.error('Pilihan tidak valid. Tidak ada yang diubah.');
        return selesai(pool, 1);
    }

    const sandi = await tanyaTersembunyi(`Sandi baru untuk "${target.username}": `);
    const ulangi = await tanyaTersembunyi('Ulangi sandi baru: ');

    if (sandi !== ulangi) {
        console.error('\nSandi tidak sama. Tidak ada yang diubah.\n');
        return selesai(pool, 1);
    }
    if (sandi.length < MIN_PANJANG_SANDI) {
        console.error(`\nSandi minimal ${MIN_PANJANG_SANDI} karakter. Tidak ada yang diubah.\n`);
        return selesai(pool, 1);
    }

    const hash = await bcrypt.hash(sandi, 10);
    // password_changed_at memutus seluruh sesi admin yang masih aktif - penting
    // bila alasan reset adalah dugaan akun dibobol.
    await pool.query(
        'UPDATE admin SET password = ?, password_changed_at = NOW() WHERE id = ?',
        [hash, target.id]
    );

    console.log(`\n  Sandi admin "${target.username}" berhasil diubah.`);
    console.log('  Semua sesi admin yang sedang aktif telah diputus.\n');

    return selesai(pool, 0);
})().catch((err) => {
    console.error('\nGagal:', err.message, '\n');
    if (rl) rl.close();
    process.exitCode = 1;
});
