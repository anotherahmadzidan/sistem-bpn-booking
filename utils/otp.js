const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/db');
const { kirimEmail } = require('./notifikasi');

const OTP_PURPOSES = new Set(['verify_email', 'password_reset']);

function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

const otpExpiresMinutes = positiveNumber(process.env.OTP_EXPIRES_MINUTES, 10);
const otpMaxAttempts = positiveNumber(process.env.OTP_MAX_ATTEMPTS, 5);
const otpCooldownSeconds = positiveNumber(process.env.OTP_RESEND_COOLDOWN_SECONDS, 60);
const pendingRegistrationExpiresMinutes = positiveNumber(process.env.PENDING_REGISTRATION_EXPIRES_MINUTES, 30);

let schemaPromise = null;

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function maskEmail(email) {
    const clean = normalizeEmail(email);
    const [name, domain] = clean.split('@');
    if (!name || !domain) return '***';
    if (name.length <= 2) return `${name[0] || '*'}***@${domain}`;
    return `${name.slice(0, 2)}***@${domain}`;
}

function otpError(status, message, code) {
    const err = new Error(message);
    err.status = status;
    err.code = code;
    return err;
}

function emailDeliveryError(result) {
    switch (result?.code) {
        case 'EMAIL_NOT_CONFIGURED':
            return otpError(
                503,
                'Layanan email belum dikonfigurasi. Hubungi administrator sistem.',
                'OTP_EMAIL_NOT_CONFIGURED'
            );
        case 'EMAIL_AUTH_FAILED':
            return otpError(
                503,
                'Autentikasi layanan email gagal. Hubungi administrator sistem.',
                'OTP_EMAIL_AUTH_FAILED'
            );
        case 'EMAIL_SENDER_NOT_VERIFIED':
            return otpError(
                503,
                'Domain pengirim email belum diverifikasi. Hubungi administrator sistem.',
                'OTP_EMAIL_SENDER_NOT_VERIFIED'
            );
        case 'EMAIL_RATE_LIMITED':
            return otpError(
                429,
                'Pengiriman email sedang dibatasi. Tunggu beberapa saat lalu coba lagi.',
                'OTP_EMAIL_RATE_LIMITED'
            );
        case 'EMAIL_RECIPIENT_REJECTED':
            return otpError(
                400,
                'Alamat email ditolak oleh layanan email. Periksa kembali alamat yang digunakan.',
                'OTP_EMAIL_RECIPIENT_REJECTED'
            );
        case 'EMAIL_TRANSPORT_UNAVAILABLE':
            return otpError(
                503,
                'Layanan email sedang tidak dapat dijangkau. Silakan coba lagi beberapa saat.',
                'OTP_EMAIL_UNAVAILABLE'
            );
        default:
            return otpError(
                502,
                'Kode OTP belum berhasil dikirim. Silakan coba lagi.',
                'OTP_EMAIL_FAILED'
            );
    }
}

function assertPurpose(purpose) {
    if (!OTP_PURPOSES.has(purpose)) {
        throw otpError(400, 'Jenis OTP tidak valid', 'INVALID_OTP_PURPOSE');
    }
}

async function ensureOtpSchema() {
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
        const [userColumns] = await pool.query('SHOW COLUMNS FROM users');
        const userColumnMap = new Map(userColumns.map(col => [col.Field, col]));
        const addedVerifiedColumn = !userColumnMap.has('email_verified_at');

        if (addedVerifiedColumn) {
            await pool.query('ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL AFTER password');
            await pool.query(`
                UPDATE users
                SET email_verified_at = COALESCE(created_at, NOW())
                WHERE email_verified_at IS NULL
            `);
        }

        await pool.query(`
            CREATE TABLE IF NOT EXISTS otp_tokens (
                id INT NOT NULL AUTO_INCREMENT,
                user_id INT NULL,
                pending_registration_id INT NULL,
                email VARCHAR(150) NOT NULL,
                purpose VARCHAR(40) NOT NULL,
                otp_hash VARCHAR(255) NOT NULL,
                expires_at DATETIME NOT NULL,
                used_at DATETIME NULL,
                attempts INT NOT NULL DEFAULT 0,
                max_attempts INT NOT NULL DEFAULT 5,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_otp_lookup (email, purpose, used_at, created_at),
                KEY idx_otp_user (user_id, purpose, created_at),
                KEY idx_otp_pending (pending_registration_id, purpose, created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        const [columns] = await pool.query('SHOW COLUMNS FROM otp_tokens');
        const columnMap = new Map(columns.map(col => [col.Field, col]));
        if (columnMap.has('user_id') && columnMap.get('user_id').Null === 'NO') {
            await pool.query('ALTER TABLE otp_tokens MODIFY user_id INT NULL');
        }

        if (!columnMap.has('pending_registration_id')) {
            await pool.query('ALTER TABLE otp_tokens ADD COLUMN pending_registration_id INT NULL AFTER user_id');
        }

        if (!columnMap.has('max_attempts')) {
            await pool.query('ALTER TABLE otp_tokens ADD COLUMN max_attempts INT NOT NULL DEFAULT 5 AFTER attempts');
        }

        await pool.query(`
            CREATE TABLE IF NOT EXISTS pending_registrations (
                id INT NOT NULL AUTO_INCREMENT,
                nama_lengkap VARCHAR(150) NOT NULL,
                email VARCHAR(150) NOT NULL,
                no_hp VARCHAR(20) NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                expires_at DATETIME NOT NULL,
                verified_at DATETIME NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uniq_pending_email (email),
                UNIQUE KEY uniq_pending_no_hp (no_hp),
                KEY idx_pending_expires (expires_at),
                KEY idx_pending_verified (verified_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        const [indexes] = await pool.query('SHOW INDEX FROM otp_tokens');
        const indexNames = new Set(indexes.map(index => index.Key_name));
        if (!indexNames.has('idx_otp_lookup')) {
            await pool.query('CREATE INDEX idx_otp_lookup ON otp_tokens (email, purpose, used_at, created_at)');
        }
        if (!indexNames.has('idx_otp_user')) {
            await pool.query('CREATE INDEX idx_otp_user ON otp_tokens (user_id, purpose, created_at)');
        }
        if (!indexNames.has('idx_otp_pending')) {
            await pool.query('CREATE INDEX idx_otp_pending ON otp_tokens (pending_registration_id, purpose, created_at)');
        }
    })().catch(err => {
        schemaPromise = null;
        throw err;
    });

    return schemaPromise;
}

function generateOtp() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function buildOtpMessage({ purpose, otp }) {
    const actionLabel = purpose === 'password_reset'
        ? 'mengatur ulang kata sandi'
        : 'memverifikasi email akun pemohon';

    return `
        Gunakan kode OTP berikut untuk ${actionLabel}:<br><br>
        <strong style="display:inline-block;font-size:24px;letter-spacing:6px;color:#0F4069;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px">${otp}</strong><br><br>
        Kode ini berlaku selama ${otpExpiresMinutes} menit. Abaikan email ini jika Anda tidak meminta kode OTP.
    `;
}

async function sendOtp({ userId = null, pendingRegistrationId = null, email, purpose }) {
    assertPurpose(purpose);
    const normalizedEmail = normalizeEmail(email);
    if ((!userId && !pendingRegistrationId) || !normalizedEmail) {
        throw otpError(400, 'Data penerima OTP tidak lengkap', 'OTP_RECIPIENT_INVALID');
    }

    await ensureOtpSchema();

    const [recent] = await pool.query(
        `SELECT created_at
         FROM otp_tokens
         WHERE email = ? AND purpose = ? AND used_at IS NULL
           AND created_at > DATE_SUB(NOW(), INTERVAL ${otpCooldownSeconds} SECOND)
         ORDER BY created_at DESC
         LIMIT 1`,
        [normalizedEmail, purpose]
    );

    if (recent.length > 0) {
        throw otpError(
            429,
            `Kode OTP baru bisa dikirim ulang setelah ${otpCooldownSeconds} detik.`,
            'OTP_COOLDOWN'
        );
    }

    await pool.query(
        'UPDATE otp_tokens SET used_at = NOW() WHERE email = ? AND purpose = ? AND used_at IS NULL',
        [normalizedEmail, purpose]
    );

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const [result] = await pool.query(
        `INSERT INTO otp_tokens
            (user_id, pending_registration_id, email, purpose, otp_hash, expires_at, max_attempts)
         VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ${otpExpiresMinutes} MINUTE), ?)`,
        [userId, pendingRegistrationId, normalizedEmail, purpose, otpHash, otpMaxAttempts]
    );

    const emailResult = await kirimEmail({
        email_user: normalizedEmail,
        judul: purpose === 'password_reset' ? 'Kode OTP Reset Kata Sandi' : 'Kode OTP Verifikasi Email',
        pesan: buildOtpMessage({ purpose, otp })
    });

    if (!emailResult.sent) {
        await pool.query('UPDATE otp_tokens SET used_at = NOW() WHERE id = ?', [result.insertId]);
        throw emailDeliveryError(emailResult);
    }

    return {
        maskedEmail: maskEmail(normalizedEmail),
        expiresInMinutes: otpExpiresMinutes
    };
}

async function verifyOtp({ email, purpose, otp }) {
    assertPurpose(purpose);
    const normalizedEmail = normalizeEmail(email);
    const cleanOtp = String(otp || '').trim();

    if (!normalizedEmail || !/^\d{6}$/.test(cleanOtp)) {
        throw otpError(400, 'Kode OTP harus 6 digit angka.', 'OTP_INVALID_FORMAT');
    }

    await ensureOtpSchema();

    const [rows] = await pool.query(
        `SELECT id, user_id, pending_registration_id, otp_hash, attempts, max_attempts,
                expires_at <= NOW() AS is_expired
         FROM otp_tokens
         WHERE email = ? AND purpose = ? AND used_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`,
        [normalizedEmail, purpose]
    );

    if (rows.length === 0) {
        throw otpError(400, 'Kode OTP tidak ditemukan. Silakan minta kode baru.', 'OTP_NOT_FOUND');
    }

    const token = rows[0];
    if (Number(token.is_expired) === 1) {
        await pool.query('UPDATE otp_tokens SET used_at = NOW() WHERE id = ?', [token.id]);
        throw otpError(400, 'Kode OTP sudah kedaluwarsa. Silakan minta kode baru.', 'OTP_EXPIRED');
    }

    if (token.attempts >= token.max_attempts) {
        await pool.query('UPDATE otp_tokens SET used_at = NOW() WHERE id = ?', [token.id]);
        throw otpError(429, 'Batas percobaan OTP tercapai. Silakan minta kode baru.', 'OTP_MAX_ATTEMPTS');
    }

    const valid = await bcrypt.compare(cleanOtp, token.otp_hash);
    if (!valid) {
        await pool.query(
            `UPDATE otp_tokens
             SET attempts = attempts + 1,
                 used_at = IF(attempts + 1 >= max_attempts, NOW(), used_at)
             WHERE id = ?`,
            [token.id]
        );
        throw otpError(400, 'Kode OTP salah.', 'OTP_INVALID');
    }

    await pool.query(
        'UPDATE otp_tokens SET attempts = attempts + 1, used_at = NOW() WHERE id = ?',
        [token.id]
    );

    return {
        userId: token.user_id,
        pendingRegistrationId: token.pending_registration_id,
        email: normalizedEmail
    };
}

module.exports = {
    ensureOtpSchema,
    sendOtp,
    verifyOtp,
    normalizeEmail,
    maskEmail,
    pendingRegistrationExpiresMinutes
};
