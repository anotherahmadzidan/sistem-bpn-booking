require('dotenv').config();

const { kirimEmail, verifyEmailTransport } = require('../utils/notifikasi');

async function main() {
    const target = (process.env.EMAIL_TEST_TO || process.env.EMAIL_USER || '').trim();

    if (!target) {
        console.error('EMAIL_TEST_TO atau EMAIL_USER belum diisi.');
        process.exitCode = 1;
        return;
    }

    const verify = await verifyEmailTransport();
    if (!verify.ok) {
        process.exitCode = 1;
        return;
    }

    const result = await kirimEmail({
        email_user: target,
        judul: 'Tes Email Sistem Booking',
        pesan: 'Ini adalah email percobaan dari sistem booking BPN Luwu Timur. Jika pesan ini diterima, konfigurasi SMTP sudah benar.',
        nomor_berkas: 'TEST-EMAIL'
    });

    if (!result.sent) {
        process.exitCode = 1;
        return;
    }

    console.log('Email tes berhasil dikirim.');
}

main().catch(err => {
    console.error('Tes email gagal:', err.message);
    process.exitCode = 1;
});
