/**
 * Menjalankan aplikasi terhadap database PENGEMBANGAN di komputer sendiri,
 * tanpa mengubah berkas .env.
 *
 * Variabel di sini disetel SEBELUM modul mana pun dimuat. dotenv tidak
 * menimpa variabel yang sudah ada, jadi nilai-nilai ini yang menang atas .env.
 *
 * Pakai: npm run dev:lokal
 */
const bawaan = {
    DB_HOST: '127.0.0.1',
    DB_PORT: '3306',
    DB_USER: 'root',
    DB_PASSWORD: '',
    DB_NAME: 'bpn_booking_dev',
    NODE_ENV: 'development',
    // Email ditulis ke berkas, tidak dikirim ke alamat siapa pun.
    EMAIL_PROVIDER: 'berkas',
    // Reminder dimatikan supaya penjadwal tidak ikut jalan saat mengembangkan.
    PETUGAS_REMINDER_ENABLED: 'false',
    JWT_SECRET: 'kunci-pengembangan-lokal-minimal-32-karakter',
    JWT_EXPIRES_IN: '1d',
    // Batas percobaan dilonggarkan HANYA untuk pengembangan: menguji alur
    // login dan OTP berulang kali akan langsung terhalang oleh batas produksi.
    AUTH_RATE_LIMIT_MAX: '1000'
};

for (const [kunci, nilai] of Object.entries(bawaan)) {
    if (process.env[kunci] === undefined) process.env[kunci] = nilai;
}

console.log(`[Dev] Database lokal: ${process.env.DB_USER}@${process.env.DB_HOST}/${process.env.DB_NAME}`);
console.log('[Dev] Email tidak dikirim — ditulis ke tmp/email-keluar/\n');

require('../server');
