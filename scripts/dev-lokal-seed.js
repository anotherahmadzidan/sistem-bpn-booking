/** Mengisi database pengembangan lokal. Lihat scripts/seed-dev.js. */
const bawaan = {
    DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_USER: 'root',
    DB_PASSWORD: '', DB_NAME: 'bpn_booking_dev'
};
for (const [k, v] of Object.entries(bawaan)) {
    if (process.env[k] === undefined) process.env[k] = v;
}
require('./seed-dev.js');
