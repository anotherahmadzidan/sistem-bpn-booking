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
let retryNotBefore = 0;

// Nomor yang SUDAH berbentuk normal tidak perlu dibaca ke aplikasi sama sekali.
// Sebelumnya seluruh isi users, petugas, dan bookings dimuat ke memori setiap
// proses dimulai; dengan filter ini, boot berikutnya praktis tidak memindai apa
// pun karena hampir semua baris sudah normal.
const NORMALIZED_PATTERN = '^628[0-9]{7,12}$';

// Jeda sebelum migrasi boleh dicoba lagi setelah gagal. Tanpa ini, satu data
// bermasalah membuat SETIAP permintaan login mengulang migrasi dari awal lalu
// gagal lagi - beban database berlipat tanpa pernah selesai.
const RETRY_COOLDOWN_MS = Number(process.env.PHONE_MIGRATION_RETRY_MS || 5 * 60 * 1000);

async function normalizeTablePhones({ table, column, report }) {
    const [rows] = await pool.query(
        `SELECT id, ${column} AS phone
         FROM ${table}
         WHERE ${column} IS NOT NULL
           AND ${column} <> ''
           AND ${column} NOT REGEXP ?
         ORDER BY id`,
        [NORMALIZED_PATTERN]
    );

    for (const row of rows) {
        const result = normalizeIndonesianPhone(row.phone);
        if (!result.valid) {
            report.invalid.push({
                table,
                id: row.id,
                no_hp: row.phone,
                reason: result.message
            });
            continue;
        }
        if (String(row.phone) === result.normalized) continue;

        try {
            await pool.query(
                `UPDATE ${table} SET ${column} = ? WHERE id = ?`,
                [result.normalized, row.id]
            );
        } catch (err) {
            // Bentrokan dilaporkan sebagai data yang perlu dikoreksi manual,
            // bukan dilempar sebagai error - satu baris bermasalah tidak boleh
            // menggagalkan seluruh migrasi (dan karenanya seluruh login).
            if (err.code === 'ER_DUP_ENTRY') {
                report.invalid.push({
                    table,
                    id: row.id,
                    no_hp: row.phone,
                    reason: `Nomor ${result.normalized} sudah dipakai akun lain.`
                });
                continue;
            }
            throw err;
        }

        report.normalized.push({
            table,
            id: row.id,
            from: row.phone,
            to: result.normalized
        });
    }
}

async function ensurePhoneSchema() {
    if (schemaPromise) return schemaPromise;
    if (Date.now() < retryNotBefore) {
        throw phoneError(
            'Migrasi nomor HP sedang dalam masa tunggu setelah gagal. Coba lagi beberapa saat.',
            'PHONE_MIGRATION_COOLDOWN',
            503
        );
    }

    schemaPromise = (async () => {
        const report = { normalized: [], invalid: [] };

        await normalizeTablePhones({ table: 'users', column: 'no_hp', report });
        await normalizeTablePhones({ table: 'petugas', column: 'no_hp', report });
        await normalizeTablePhones({ table: 'bookings', column: 'no_telepon', report });

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
        retryNotBefore = Date.now() + RETRY_COOLDOWN_MS;
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
