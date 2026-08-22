const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/db');
const { kirimEmail } = require('./notifikasi');

const OTP_PURPOSES = new Set(['verify_email', 'password_reset', 'reset_sandi_petugas']);

function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

const otpExpiresMinutes = positiveNumber(process.env.OTP_EXPIRES_MINUTES, 10);
const otpMaxAttempts = positiveNumber(process.env.OTP_MAX_ATTEMPTS, 5);
const otpCooldownSeconds = positiveNumber(process.env.OTP_RESEND_COOLDOWN_SECONDS, 60);
const pendingRegistrationRetentionDays = positiveNumber(
    process.env.PENDING_REGISTRATION_RETENTION_DAYS,
    30
);
const profileCompletionTrustHours = positiveNumber(
    process.env.PROFILE_COMPLETION_TRUST_HOURS,
    24
);

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

function otpError(status, message, code, details = {}) {
    const err = new Error(message);
    err.status = status;
    err.code = code;
    err.details = details;
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

        if (!userColumnMap.has('profile_completed_at')) {
            await pool.query(
                'ALTER TABLE users ADD COLUMN profile_completed_at DATETIME NULL AFTER email_verified_at'
            );
            await pool.query(`
                UPDATE users
                SET profile_completed_at = COALESCE(created_at, NOW())
                WHERE profile_completed_at IS NULL
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
                nama_lengkap VARCHAR(150) NULL,
                email VARCHAR(150) NOT NULL,
                no_hp VARCHAR(20) NULL,
                password_hash VARCHAR(255) NULL,
                expires_at DATETIME NOT NULL,
                verified_at DATETIME NULL,
                email_verified_at DATETIME NULL,
                status ENUM(
                    'pending_email_verification',
                    'pending_profile_completion'
                ) NOT NULL DEFAULT 'pending_email_verification',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uniq_pending_email (email),
                UNIQUE KEY uniq_pending_no_hp (no_hp),
                KEY idx_pending_expires (expires_at),
                KEY idx_pending_verified (verified_at),
                KEY idx_pending_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        const [pendingColumns] = await pool.query('SHOW COLUMNS FROM pending_registrations');
        const pendingColumnMap = new Map(pendingColumns.map(col => [col.Field, col]));
        if (pendingColumnMap.get('nama_lengkap')?.Null === 'NO') {
            await pool.query('ALTER TABLE pending_registrations MODIFY nama_lengkap VARCHAR(150) NULL');
        }
        if (pendingColumnMap.get('no_hp')?.Null === 'NO') {
            await pool.query('ALTER TABLE pending_registrations MODIFY no_hp VARCHAR(20) NULL');
        }
        if (pendingColumnMap.get('password_hash')?.Null === 'NO') {
            await pool.query('ALTER TABLE pending_registrations MODIFY password_hash VARCHAR(255) NULL');
        }
        if (!pendingColumnMap.has('email_verified_at')) {
            await pool.query(
                'ALTER TABLE pending_registrations ADD COLUMN email_verified_at DATETIME NULL AFTER verified_at'
            );
        }
        if (!pendingColumnMap.has('status')) {
            await pool.query(`
                ALTER TABLE pending_registrations
                ADD COLUMN status ENUM(
                    'pending_email_verification',
                    'pending_profile_completion'
                ) NOT NULL DEFAULT 'pending_email_verification'
                AFTER email_verified_at
            `);
        }

        await pool.query(`
            UPDATE pending_registrations
            SET email_verified_at = COALESCE(email_verified_at, verified_at),
                status = CASE
                    WHEN COALESCE(email_verified_at, verified_at) IS NOT NULL
                        THEN 'pending_profile_completion'
                    ELSE 'pending_email_verification'
                END,
                expires_at = GREATEST(
                    expires_at,
                    DATE_ADD(
                        COALESCE(email_verified_at, verified_at, created_at),
                        INTERVAL ${pendingRegistrationRetentionDays} DAY
                    )
                )
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

        const [pendingIndexes] = await pool.query('SHOW INDEX FROM pending_registrations');
        const pendingIndexNames = new Set(pendingIndexes.map(index => index.Key_name));
        if (!pendingIndexNames.has('idx_pending_status')) {
            await pool.query('CREATE INDEX idx_pending_status ON pending_registrations (status)');
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

async function sendOtp({
    userId = null,
    petugasId = null,
    pendingRegistrationId = null,
    email,
    purpose,
    enforceCooldown = true
}) {
    assertPurpose(purpose);
    const normalizedEmail = normalizeEmail(email);
    if ((!userId && !petugasId && !pendingRegistrationId) || !normalizedEmail) {
        throw otpError(400, 'Data penerima OTP tidak lengkap', 'OTP_RECIPIENT_INVALID');
    }

    await ensureOtpSchema();

    if (enforceCooldown) {
        const [recent] = await pool.query(
            `SELECT created_at,
                    GREATEST(
                        TIMESTAMPDIFF(
                            SECOND,
                            NOW(),
                            DATE_ADD(created_at, INTERVAL ${otpCooldownSeconds} SECOND)
                        ),
                        0
                    ) AS retry_after_seconds
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
                'OTP_COOLDOWN',
                {
                    retry_after_seconds: Math.max(1, Number(recent[0].retry_after_seconds || otpCooldownSeconds))
                }
            );
        }
    }

    await pool.query(
        'UPDATE otp_tokens SET used_at = NOW() WHERE email = ? AND purpose = ? AND used_at IS NULL',
        [normalizedEmail, purpose]
    );

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const [result] = await pool.query(
        `INSERT INTO otp_tokens
            (user_id, petugas_id, pending_registration_id, email, purpose, otp_hash, expires_at, max_attempts)
         VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ${otpExpiresMinutes} MINUTE), ?)`,
        [userId, petugasId, pendingRegistrationId, normalizedEmail, purpose, otpHash, otpMaxAttempts]
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
        expiresInMinutes: otpExpiresMinutes,
        expiresInSeconds: otpExpiresMinutes * 60,
        resendAvailableInSeconds: otpCooldownSeconds
    };
}

async function getOtpState({
    userId = null,
    petugasId = null,
    pendingRegistrationId = null,
    email,
    purpose
}) {
    assertPurpose(purpose);
    const normalizedEmail = normalizeEmail(email);
    if ((!userId && !petugasId && !pendingRegistrationId) || !normalizedEmail) {
        throw otpError(400, 'Data penerima OTP tidak lengkap', 'OTP_RECIPIENT_INVALID');
    }

    await ensureOtpSchema();

    const ownerColumn = pendingRegistrationId
        ? 'pending_registration_id'
        : (petugasId ? 'petugas_id' : 'user_id');
    const ownerId = pendingRegistrationId || petugasId || userId;
    const [rows] = await pool.query(
        `SELECT id,
                expires_at > NOW() AS is_active,
                GREATEST(TIMESTAMPDIFF(SECOND, NOW(), expires_at), 0) AS expires_in_seconds,
                GREATEST(
                    TIMESTAMPDIFF(
                        SECOND,
                        NOW(),
                        DATE_ADD(created_at, INTERVAL ${otpCooldownSeconds} SECOND)
                    ),
                    0
                ) AS resend_available_in_seconds
         FROM otp_tokens
         WHERE email = ? AND purpose = ? AND ${ownerColumn} = ? AND used_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`,
        [normalizedEmail, purpose, ownerId]
    );

    if (rows.length === 0) {
        return {
            exists: false,
            active: false,
            expiresInSeconds: 0,
            resendAvailableInSeconds: 0
        };
    }

    return {
        exists: true,
        active: Number(rows[0].is_active) === 1,
        expiresInSeconds: Number(rows[0].expires_in_seconds || 0),
        resendAvailableInSeconds: Number(rows[0].resend_available_in_seconds || 0)
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
        `SELECT id, user_id, petugas_id, pending_registration_id, otp_hash, attempts, max_attempts,
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
        petugasId: token.petugas_id,
        pendingRegistrationId: token.pending_registration_id,
        email: normalizedEmail
    };
}

module.exports = {
    ensureOtpSchema,
    sendOtp,
    getOtpState,
    verifyOtp,
    normalizeEmail,
    maskEmail,
    pendingRegistrationRetentionDays,
    profileCompletionTrustHours
};
