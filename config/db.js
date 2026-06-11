const mysql = require('mysql2/promise');
require('dotenv').config();

const parseDatabaseUrl = (uri) => {
    if (!uri) return {};
    try {
        const url = new URL(uri);
        return {
            host: url.hostname,
            port: url.port,
            user: decodeURIComponent(url.username || ''),
            password: decodeURIComponent(url.password || ''),
            database: decodeURIComponent((url.pathname || '').replace(/^\//, ''))
        };
    } catch {
        return {};
    }
};

const fromUri = parseDatabaseUrl(process.env.MYSQL_ADDON_URI || process.env.DATABASE_URL);
const useSsl = ['1', 'true', 'yes'].includes(String(process.env.DB_SSL || '').toLowerCase());

const config = {
    host: process.env.MYSQL_ADDON_HOST || fromUri.host || process.env.DB_HOST,
    port: Number(process.env.MYSQL_ADDON_PORT || fromUri.port || process.env.DB_PORT || 3306),
    user: process.env.MYSQL_ADDON_USER || fromUri.user || process.env.DB_USER,
    password: process.env.MYSQL_ADDON_PASSWORD || fromUri.password || process.env.DB_PASSWORD,
    database: process.env.MYSQL_ADDON_DB || fromUri.database || process.env.DB_NAME,
    timezone: process.env.DB_TIMEZONE || '+08:00',
    waitForConnections: true,
    connectionLimit: 10,
};

if (useSsl) {
    config.ssl = {
        rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false'
    };
}

const pool = mysql.createPool(config);

module.exports = pool;
