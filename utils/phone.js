const pool = require('../config/db');

const PHONE_MIN_DIGITS = 10;
const PHONE_MAX_DIGITS = 15;
const PHONE_ALLOWED_PATTERN = /^[0-9+\s-]+$/;

function phoneError(message, code = 'PHONE_INVALID', status = 400) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

function normalizeIndonesianPhone(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return {
            valid: false,
            normalized: '',
            code: 'PHONE_REQUIRED',
            message: 'Nomor HP wajib diisi.'
        };
    }

    if (!PHONE_ALLOWED_PATTERN.test(raw)) {
        return {
            valid: false,
            normalized: '',
            code: 'PHONE_INVALID_CHARACTERS',
            message: 'Nomor HP hanya boleh berisi angka, spasi, tanda plus, dan tanda hubung.'
        };
    }

    const compact = raw.replace(/[\s-]/g, '');
    if (
        (compact.includes('+') && !compact.startsWith('+'))
        || (compact.match(/\+/g) || []).length > 1
    ) {
        return {
            valid: false,
            normalized: '',
            code: 'PHONE_INVALID_FORMAT',
            message: 'Tanda plus hanya boleh digunakan satu kali di awal nomor.'
        };
    }

    let digits = compact.startsWith('+') ? compact.slice(1) : compact;
    if (!/^\d+$/.test(digits)) {
        return {
            valid: false,
            normalized: '',
            code: 'PHONE_INVALID_FORMAT',
            message: 'Format nomor HP tidak valid.'
        };
    }

    if (digits.startsWith('08')) {
        digits = `62${digits.slice(1)}`;
    }

    if (!digits.startsWith('628')) {
        return {
            valid: false,
            normalized: '',
            code: 'PHONE_INVALID_PREFIX',
            message: 'Nomor HP Indonesia harus diawali 08, +628, atau 628.'
        };
    }

    if (digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) {
        return {
            valid: false,
            normalized: '',
            code: 'PHONE_INVALID_LENGTH',
            message: `Nomor HP harus terdiri dari ${PHONE_MIN_DIGITS}-${PHONE_MAX_DIGITS} digit setelah dinormalisasi.`
        };
    }

    return {
        valid: true,
        normalized: digits,
        code: 'PHONE_VALID',
        message: `Nomor akan disimpan sebagai ${digits}.`
    };
}

function requireIndonesianPhone(value) {
    const result = normalizeIndonesianPhone(value);
    if (!result.valid) {
        throw phoneError(result.message, result.code);
    }
    return result.normalized;
}

async function assertPhoneAvailable(
    connection,
    normalizedPhone,
    { excludeUserId = null, excludePetugasId = null } = {}
) {
    const [userRows] = await connection.query(
        `SELECT id
         FROM users
         WHERE no_hp = ?
           AND (? IS NULL OR id <> ?)
         LIMIT 1`,
        [normalizedPhone, excludeUserId, excludeUserId]
    );
    if (userRows.length > 0) {
        throw phoneError(
            'Nomor HP sudah digunakan oleh akun pemohon lain.',
            'PHONE_ALREADY_REGISTERED',
            409
        );
    }

    const [petugasRows] = await connection.query(
        `SELECT id
         FROM petugas
         WHERE no_hp = ?
           AND (? IS NULL OR id <> ?)
         LIMIT 1`,
        [normalizedPhone, excludePetugasId, excludePetugasId]
    );
    if (petugasRows.length > 0) {
        throw phoneError(
            'Nomor HP sudah digunakan oleh akun petugas lain.',
            'PHONE_ALREADY_REGISTERED',
            409
        );
    }
}

async function acquirePhoneLock(connection, normalizedPhone) {
    const lockName = `bpn:phone:${normalizedPhone}`;
    const [rows] = await connection.query(
        'SELECT GET_LOCK(?, 5) AS acquired',
        [lockName]
    );
    if (Number(rows[0]?.acquired) !== 1) {
        throw phoneError(
            'Nomor HP sedang diproses oleh permintaan lain. Silakan coba lagi.',
            'PHONE_LOCK_TIMEOUT',
            409
        );
    }
    return lockName;
}

async function releasePhoneLock(connection, lockName) {
    if (!connection || !lockName) return;
    try {
        await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
    } catch {
        // Lock akan terlepas otomatis ketika koneksi ditutup.
    }
}

let schemaPromise = null;

async function ensurePhoneSchema() {
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
        const report = { normalized: [], invalid: [] };
        const accountOwners = new Map();

        for (const table of ['users', 'petugas']) {
            const [rows] = await pool.query(`SELECT id, no_hp FROM ${table} ORDER BY id`);
            const normalizedOwners = new Map();

            for (const row of rows) {
                const result = normalizeIndonesianPhone(row.no_hp);
                if (!result.valid) {
                    report.invalid.push({
                        table,
                        id: row.id,
                        no_hp: row.no_hp,
                        reason: result.message
                    });
                    continue;
                }

                const previousOwner = normalizedOwners.get(result.normalized);
                if (previousOwner && previousOwner !== row.id) {
                    throw phoneError(
                        `Migrasi nomor HP menemukan duplikasi ${result.normalized} pada tabel ${table}.`,
                        'PHONE_MIGRATION_DUPLICATE',
                        500
                    );
                }
                normalizedOwners.set(result.normalized, row.id);

                const accountOwner = accountOwners.get(result.normalized);
                if (accountOwner) {
                    throw phoneError(
                        `Nomor ${result.normalized} dipakai oleh ${accountOwner.table}#${accountOwner.id} dan ${table}#${row.id}.`,
                        'PHONE_MIGRATION_CROSS_ACCOUNT_DUPLICATE',
                        500
                    );
                }
                accountOwners.set(result.normalized, { table, id: row.id });

                if (String(row.no_hp) !== result.normalized) {
                    await pool.query(
                        `UPDATE ${table} SET no_hp = ? WHERE id = ?`,
                        [result.normalized, row.id]
                    );
                    report.normalized.push({
                        table,
                        id: row.id,
                        from: row.no_hp,
                        to: result.normalized
                    });
                }
            }
        }

        const [bookingRows] = await pool.query(
            'SELECT id, no_telepon FROM bookings ORDER BY id'
        );
        for (const row of bookingRows) {
            const result = normalizeIndonesianPhone(row.no_telepon);
            if (!result.valid) {
                report.invalid.push({
                    table: 'bookings',
                    id: row.id,
                    no_hp: row.no_telepon,
                    reason: result.message
                });
                continue;
            }
            if (String(row.no_telepon) !== result.normalized) {
                await pool.query(
                    'UPDATE bookings SET no_telepon = ? WHERE id = ?',
                    [result.normalized, row.id]
                );
                report.normalized.push({
                    table: 'bookings',
                    id: row.id,
                    from: row.no_telepon,
                    to: result.normalized
                });
            }
        }

        for (const table of ['users', 'petugas']) {
            const [indexes] = await pool.query(`SHOW INDEX FROM ${table}`);
            const hasUniquePhone = indexes.some(index =>
                index.Column_name === 'no_hp' && Number(index.Non_unique) === 0
            );
            if (!hasUniquePhone) {
                await pool.query(
                    `ALTER TABLE ${table} ADD UNIQUE KEY uniq_${table}_no_hp (no_hp)`
                );
            }
        }

        return report;
    })().catch(error => {
        schemaPromise = null;
        throw error;
    });

    return schemaPromise;
}

module.exports = {
    PHONE_MIN_DIGITS,
    PHONE_MAX_DIGITS,
    normalizeIndonesianPhone,
    requireIndonesianPhone,
    assertPhoneAvailable,
    acquirePhoneLock,
    releasePhoneLock,
    ensurePhoneSchema
};
