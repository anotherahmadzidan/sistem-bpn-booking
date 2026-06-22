const assert = require('assert');
const pool = require('../config/db');
const {
    getReminderWindow,
    reminderTypeForDate,
    buildReminderEmail
} = require('../utils/petugasReminder');

async function main() {
    const window = getReminderWindow(new Date('2026-06-22T00:30:00.000Z'));
    assert.deepStrictEqual(window, {
        hour: 8,
        today: '2026-06-22',
        tomorrow: '2026-06-23'
    });
    assert.strictEqual(reminderTypeForDate('2026-06-22', window), 'hari_h');
    assert.strictEqual(reminderTypeForDate('2026-06-23', window), 'h_minus_1');
    assert.strictEqual(reminderTypeForDate('2026-06-24', window), null);

    const content = buildReminderEmail({
        scheduled_date: '2026-06-23',
        petugas_nama: 'Budi <script>',
        nomor_berkas: 'W-123',
        pemohon_nama: 'Zidan',
        nama_kecamatan: 'Malili',
        nama_kelurahan: 'Atue',
        alamat_lokasi: 'Jl. Test'
    }, 'h_minus_1');

    assert.strictEqual(content.judul, 'Pengingat Pemeriksaan Besok');
    assert.ok(content.pesan.includes('Selasa, 23 Juni 2026'));
    assert.ok(content.pesan.includes('Budi &lt;script&gt;'));
    assert.ok(!content.pesan.includes('Budi <script>'));

    console.log('Petugas email reminder: OK');
}

main()
    .catch(err => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
