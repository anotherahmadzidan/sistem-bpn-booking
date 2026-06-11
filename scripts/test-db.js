require('dotenv').config();
const pool = require('../config/db');

const activeHost = process.env.MYSQL_ADDON_HOST
    || process.env.DB_HOST
    || (process.env.MYSQL_ADDON_URI || '').replace(/^mysql:\/\/[^@]+@/, '').split('/')[0]
    || 'unknown';

const activeDb = process.env.MYSQL_ADDON_DB || process.env.DB_NAME || 'unknown';

(async () => {
    try {
        const [rows] = await pool.query('SELECT DATABASE() AS db, NOW() AS server_time');
        console.log(`[DB] Koneksi berhasil ke ${activeHost}`);
        console.log(`[DB] Database aktif: ${rows[0].db || activeDb}`);
        console.log(`[DB] Waktu server DB: ${rows[0].server_time}`);
        await pool.end();
    } catch (err) {
        console.error('[DB] Koneksi gagal:', err.code || err.message);
        console.error(err.message);
        process.exitCode = 1;
    }
})();
