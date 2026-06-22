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

const fromUri = parseDatabaseUrl(
    process.env.MYSQL_ADDON_URI
    || process.env.MYSQL_URL
    || process.env.DATABASE_URL
);
const useSsl = ['1', 'true', 'yes'].includes(String(process.env.DB_SSL || '').toLowerCase());
const connectionTimeout = Number(process.env.DB_CONNECT_TIMEOUT_MS || 8000);
const queryTimeout = Number(process.env.DB_QUERY_TIMEOUT_MS || 8000);
const dnsRetryDelay = Number(process.env.DB_DNS_RETRY_DELAY_MS || 500);

const config = {
    host: process.env.MYSQL_ADDON_HOST || process.env.MYSQLHOST || process.env.MYSQL_HOST || fromUri.host || process.env.DB_HOST,
    port: Number(process.env.MYSQL_ADDON_PORT || process.env.MYSQLPORT || process.env.MYSQL_PORT || fromUri.port || process.env.DB_PORT || 3306),
    user: process.env.MYSQL_ADDON_USER || process.env.MYSQLUSER || process.env.MYSQL_USER || fromUri.user || process.env.DB_USER,
    password: process.env.MYSQL_ADDON_PASSWORD || process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || fromUri.password || process.env.DB_PASSWORD,
    database: process.env.MYSQL_ADDON_DB || process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || fromUri.database || process.env.DB_NAME,
    timezone: process.env.DB_TIMEZONE || '+08:00',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: Number(process.env.DB_QUEUE_LIMIT || 100),
    connectTimeout: connectionTimeout,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
};

if (useSsl) {
    config.ssl = {
        rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false'
    };
}

const pool = mysql.createPool(config);

const applyQueryTimeout = (query, timeoutMs) => {
    if (typeof query === 'string') {
        return { sql: query, timeout: timeoutMs };
    }
    return {
        ...query,
        timeout: Number(query.timeout || timeoutMs)
    };
};

const wait = (duration) => new Promise(resolve => setTimeout(resolve, duration));

const runWithDnsRetry = async (operation) => {
    try {
        return await operation();
    } catch (err) {
        if (!['ENOTFOUND', 'EAI_AGAIN'].includes(String(err?.code || '').toUpperCase())) {
            throw err;
        }

        await wait(dnsRetryDelay);
        return operation();
    }
};

const wrapQueryMethods = (target) => {
    if (!target || target.__queryTimeoutWrapped) return target;

    ['query', 'execute'].forEach(method => {
        if (typeof target[method] !== 'function') return;
        const original = target[method].bind(target);
        target[method] = (query, values) =>
            runWithDnsRetry(() =>
                original(applyQueryTimeout(query, queryTimeout), values)
            );
    });

    Object.defineProperty(target, '__queryTimeoutWrapped', {
        value: true,
        enumerable: false
    });
    return target;
};

wrapQueryMethods(pool);

const getConnection = pool.getConnection.bind(pool);
pool.getConnection = async () => wrapQueryMethods(await getConnection());

pool.timeouts = Object.freeze({
    connection: connectionTimeout,
    query: queryTimeout,
    dnsRetryDelay
});

module.exports = pool;
