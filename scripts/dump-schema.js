/**
 * Membuat db/schema.sql dari database yang sedang berjalan.
 *
 * Sebelumnya struktur tabel hanya "tumbuh" lewat fungsi ensure*Schema() saat
 * aplikasi berjalan, sehingga tidak ada satu pun sumber kebenaran yang bisa
 * dipakai untuk menyiapkan database baru atau meninjau perubahan skema.
 *
 * Pakai: node scripts/dump-schema.js
 */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

// Urutan sengaja mengikuti ketergantungan foreign key.
const TABLE_ORDER = [
    'kecamatan', 'kelurahan',
    'users', 'petugas', 'admin',
    'bookings', 'hasil_pemeriksaan', 'reschedule_log',
    'notifications', 'otp_tokens', 'pending_registrations',
    'kuota_default', 'kuota_kecamatan', 'kuota_kelurahan', 'kuota_petugas',
    'email_reminders', 'audit_log'
];

(async () => {
    const [rows] = await pool.query('SHOW TABLES');
    const key = Object.keys(rows[0])[0];
    const existing = new Set(rows.map((row) => row[key]));

    const ordered = TABLE_ORDER.filter((t) => existing.has(t));
    const extra = [...existing].filter((t) => !TABLE_ORDER.includes(t)).sort();
    if (extra.length) {
        console.warn(`[Skema] Tabel di luar daftar urutan, ditambahkan di akhir: ${extra.join(', ')}`);
    }

    const parts = [
        '-- Skema database SIMPETA (BPN Kabupaten Luwu Timur)',
        '-- Dibuat otomatis oleh: node scripts/dump-schema.js',
        '-- Jangan diedit manual; ubah database lalu jalankan ulang skrip ini.',
        '',
        'SET FOREIGN_KEY_CHECKS = 0;',
        ''
    ];

    for (const table of [...ordered, ...extra]) {
        const [created] = await pool.query(`SHOW CREATE TABLE \`${table}\``);
        const ddl = created[0]['Create Table']
            .replace(/ AUTO_INCREMENT=\d+/, '')
            .replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ');
        parts.push(`${ddl};`, '');
    }

    parts.push('SET FOREIGN_KEY_CHECKS = 1;', '');

    const target = path.join(__dirname, '..', 'db', 'schema.sql');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, parts.join('\n'), 'utf8');

    console.log(`Skema ${ordered.length + extra.length} tabel ditulis ke db/schema.sql`);
    await pool.end();
})().catch((err) => {
    console.error('Gagal membuat skema:', err.message);
    process.exitCode = 1;
});
