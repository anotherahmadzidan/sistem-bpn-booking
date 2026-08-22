/**
 * Mengisi database PENGEMBANGAN dengan data contoh.
 *
 * Semua nama, email, dan nomor di sini fiktif. Skrip ini menolak berjalan
 * kalau DB_HOST bukan localhost, supaya tidak mungkin menimpa data produksi.
 *
 * Pakai:
 *   DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD= DB_NAME=bpn_booking_dev \
 *     node scripts/seed-dev.js
 */
const bcrypt = require('bcryptjs');
require('dotenv').config({ quiet: true });

const HOST_LOKAL = ['localhost', '127.0.0.1', '::1'];
const host = process.env.DB_HOST || process.env.MYSQL_HOST || '';

if (!HOST_LOKAL.includes(host)) {
    console.error(
        `\nDITOLAK: DB_HOST = "${host}" bukan database lokal.\n`
        + 'Skrip ini hanya boleh dijalankan terhadap database pengembangan.\n'
        + 'Jalankan dengan menimpa variabel env, contoh:\n\n'
        + '  DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD= DB_NAME=bpn_booking_dev \\n'
        + '    node scripts/seed-dev.js\n'
    );
    process.exit(1);
}

const pool = require('../config/db');

const SANDI = {
    admin: 'AdminUji123',
    petugas: 'PetugasUji123',
    user: 'PemohonUji123'
};

const KECAMATAN = ['Malili', 'Angkona', 'Wotu', 'Nuha', 'Towuti'];
const KELURAHAN = {
    Malili: ['Puncak Indah', 'Balantang', 'Lakawali'],
    Angkona: ['Solo', 'Tampinna'],
    Wotu: ['Bawalipu', 'Lampenai'],
    Nuha: ['Matano', 'Sorowako'],
    Towuti: ['Timampu', 'Wawondula']
};

(async () => {
    const hash = async (s) => bcrypt.hash(s, 10);

    // Bersihkan dengan urutan yang menghormati foreign key.
    for (const t of [
        'email_reminders', 'notifications', 'hasil_pemeriksaan', 'reschedule_log',
        'bookings', 'otp_tokens', 'pending_registrations',
        'kuota_petugas', 'kuota_kelurahan', 'kuota_kecamatan', 'kuota_default',
        'users', 'petugas', 'admin', 'kelurahan', 'kecamatan'
    ]) {
        await pool.query(`DELETE FROM \`${t}\``);
    }

    for (const nama of KECAMATAN) {
        const [r] = await pool.query(
            'INSERT INTO kecamatan (nama_kecamatan, kabupaten) VALUES (?, ?)',
            [nama, 'Luwu Timur']
        );
        for (const kel of KELURAHAN[nama]) {
            await pool.query(
                'INSERT INTO kelurahan (kecamatan_id, nama_kelurahan) VALUES (?, ?)',
                [r.insertId, kel]
            );
        }
    }

    await pool.query(
        'INSERT INTO admin (username, nama_lengkap, email, password) VALUES (?, ?, ?, ?)',
        ['admin', 'Admin Uji', 'admin.uji@contoh.test', await hash(SANDI.admin)]
    );

    const petugas = [
        ['198001012006041001', 'Petugas Satu Uji', 'petugas1.uji@contoh.test', '6281200000001'],
        ['198002022006042002', 'Petugas Dua Uji', 'petugas2.uji@contoh.test', '6281200000002']
    ];
    for (const [nip, nama, email, hp] of petugas) {
        // harus_ganti_sandi = 1 meniru akun yang dibuatkan admin: sandinya
        // bersifat sementara dan wajib diganti petugas saat login pertama.
        await pool.query(
            `INSERT INTO petugas
                (nip, nama_lengkap, email, no_hp, password, is_active, harus_ganti_sandi)
             VALUES (?, ?, ?, ?, ?, 1, 1)`,
            [nip, nama, email, hp, await hash(SANDI.petugas)]
        );
    }

    const users = [
        ['Pemohon Satu Uji', 'pemohon1.uji@contoh.test', '6281300000001'],
        ['Pemohon Dua Uji', 'pemohon2.uji@contoh.test', '6281300000002']
    ];
    for (const [nama, email, hp] of users) {
        await pool.query(
            `INSERT INTO users (nama_lengkap, email, no_hp, password, email_verified_at, profile_completed_at)
             VALUES (?, ?, ?, ?, NOW(), NOW())`,
            [nama, email, hp, await hash(SANDI.user)]
        );
    }

    console.log(`\nDatabase "${process.env.DB_NAME}" terisi data contoh.\n`);
    console.log('  Admin    : admin                 / ' + SANDI.admin);
    console.log('  Petugas  : 198001012006041001    / ' + SANDI.petugas);
    console.log('             198002022006042002    / ' + SANDI.petugas);
    console.log('  Pemohon  : pemohon1.uji@contoh.test / ' + SANDI.user);
    console.log('\nSeluruh data di atas fiktif dan hanya untuk pengembangan.\n');

    await pool.end();
})().catch((err) => {
    console.error('Seed gagal:', err.message);
    process.exitCode = 1;
});
