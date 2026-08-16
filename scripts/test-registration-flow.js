const assert = require('assert');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'registration-flow-test-secret-minimum-32';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
process.env.PROFILE_COMPLETION_TRUST_HOURS = '24';
process.env.PENDING_REGISTRATION_RETENTION_DAYS = '30';

let scenario = 'pending_otp_active';
let sentEmailCount = 0;
let insertedUserCount = 0;
let pendingDeletedCount = 0;
let pendingResetCount = 0;
let pendingMarkedVerifiedCount = 0;
let insertedPhone = null;

const pendingRegistration = {
    id: 71,
    email: 'pending@example.com',
    status: 'pending_email_verification',
    verified_at: null,
    email_verified_at: null,
    verification_age_seconds: null
};

function compactSql(statement) {
    return String(statement?.sql || statement).replace(/\s+/g, ' ').trim();
}

const fakeConnection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(statement, values = []) {
        const sql = compactSql(statement);

        if (sql.startsWith('SELECT GET_LOCK')) {
            return [[{ acquired: 1 }]];
        }
        if (sql.startsWith('SELECT RELEASE_LOCK')) {
            return [[{ released: 1 }]];
        }
        if (sql.includes('FROM pending_registrations') && sql.includes('FOR UPDATE')) {
            return [[{
                id: pendingRegistration.id,
                email: pendingRegistration.email
            }]];
        }
        if (sql.includes('FROM users') && sql.includes('WHERE email = ?')) {
            return [[]];
        }
        if (sql.includes('FROM users') && sql.includes('WHERE no_hp = ?')) {
            return [[]];
        }
        if (sql.includes('FROM petugas') && sql.includes('WHERE no_hp = ?')) {
            return [[]];
        }
        if (sql.startsWith('INSERT INTO users')) {
            insertedUserCount += 1;
            insertedPhone = values[2];
            return [{ insertId: 808, affectedRows: 1 }];
        }
        if (sql.startsWith('DELETE FROM pending_registrations WHERE id = ?')) {
            pendingDeletedCount += 1;
            return [{ affectedRows: 1 }];
        }

        throw new Error(`Query transaksi test belum ditangani: ${sql}`);
    }
};

function pendingForScenario() {
    if (scenario === 'pending_otp_active' || scenario === 'pending_otp_expired') {
        return {
            ...pendingRegistration,
            status: 'pending_email_verification'
        };
    }
    if (scenario === 'profile_recent') {
        return {
            ...pendingRegistration,
            status: 'pending_profile_completion',
            verified_at: new Date(),
            email_verified_at: new Date(),
            verification_age_seconds: 5 * 60 * 60
        };
    }
    if (scenario === 'profile_stale') {
        return {
            ...pendingRegistration,
            status: 'pending_profile_completion',
            verified_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
            email_verified_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
            verification_age_seconds: 5 * 24 * 60 * 60
        };
    }
    return null;
}

const fakePool = {
    async getConnection() {
        return fakeConnection;
    },
    async query(statement) {
        const sql = compactSql(statement);

        if (sql.startsWith('SHOW COLUMNS FROM users')) {
            return [[
                { Field: 'id', Null: 'NO' },
                { Field: 'email_verified_at', Null: 'YES' },
                { Field: 'profile_completed_at', Null: 'YES' }
            ]];
        }
        if (sql.startsWith('SHOW COLUMNS FROM otp_tokens')) {
            return [[
                { Field: 'user_id', Null: 'YES' },
                { Field: 'pending_registration_id', Null: 'YES' },
                { Field: 'max_attempts', Null: 'NO' }
            ]];
        }
        if (sql.startsWith('SHOW COLUMNS FROM pending_registrations')) {
            return [[
                { Field: 'nama_lengkap', Null: 'YES' },
                { Field: 'no_hp', Null: 'YES' },
                { Field: 'password_hash', Null: 'YES' },
                { Field: 'verified_at', Null: 'YES' },
                { Field: 'email_verified_at', Null: 'YES' },
                { Field: 'status', Null: 'NO' }
            ]];
        }
        if (sql.startsWith('SHOW INDEX FROM otp_tokens')) {
            return [[
                { Key_name: 'idx_otp_lookup' },
                { Key_name: 'idx_otp_user' },
                { Key_name: 'idx_otp_pending' }
            ]];
        }
        if (sql.startsWith('SHOW INDEX FROM pending_registrations')) {
            return [[{ Key_name: 'idx_pending_status' }]];
        }
        if (sql.startsWith('SHOW INDEX FROM users')) {
            return [[{
                Key_name: 'no_hp',
                Column_name: 'no_hp',
                Non_unique: 0
            }]];
        }
        if (sql.startsWith('SHOW INDEX FROM petugas')) {
            return [[{
                Key_name: 'uniq_petugas_no_hp',
                Column_name: 'no_hp',
                Non_unique: 0
            }]];
        }
        // Migrasi nomor HP hanya membaca baris yang belum berbentuk normal.
        if (/SELECT id, (?:no_hp|no_telepon) AS phone\s+FROM (?:users|petugas|bookings)/.test(sql)) {
            return [[]];
        }
        if (
            sql.startsWith('CREATE TABLE')
            || sql.startsWith('ALTER TABLE')
            || sql.startsWith('CREATE INDEX')
            || sql.startsWith('UPDATE otp_tokens otp INNER JOIN pending_registrations')
            || sql.startsWith('UPDATE pending_registrations SET email_verified_at')
            || sql.startsWith('DELETE FROM pending_registrations WHERE expires_at')
        ) {
            return [{ affectedRows: 0 }];
        }
        if (sql.includes('FROM users') && sql.includes('WHERE email = ?') && sql.includes('LIMIT 1')) {
            if (scenario === 'active_user') {
                return [[{
                    id: 9,
                    email: 'active@example.com',
                    email_verified_at: new Date(),
                    profile_completed_at: new Date()
                }]];
            }
            return [[]];
        }
        if (sql.includes('FROM pending_registrations') && sql.includes('WHERE email = ?')) {
            const pending = pendingForScenario();
            return [pending ? [pending] : []];
        }
        if (sql.includes('SELECT id, user_id, pending_registration_id, otp_hash')) {
            if (scenario === 'verify_otp') {
                return [[{
                    id: 601,
                    user_id: null,
                    pending_registration_id: pendingRegistration.id,
                    otp_hash: bcrypt.hashSync('123456', 4),
                    attempts: 0,
                    max_attempts: 5,
                    is_expired: 0
                }]];
            }
            return [[]];
        }
        if (
            sql.includes('FROM pending_registrations')
            && sql.includes('WHERE id = ? AND email = ?')
        ) {
            return [[pendingRegistration]];
        }
        if (sql.includes('FROM otp_tokens') && sql.includes('AS is_active')) {
            if (scenario === 'pending_otp_active') {
                return [[{
                    id: 99,
                    is_active: 1,
                    expires_in_seconds: 420,
                    resend_available_in_seconds: 37
                }]];
            }
            if (scenario === 'pending_otp_expired') {
                return [[{
                    id: 99,
                    is_active: 0,
                    expires_in_seconds: 0,
                    resend_available_in_seconds: 0
                }]];
            }
            return [[]];
        }
        if (sql.startsWith("UPDATE pending_registrations SET status = 'pending_email_verification'")) {
            pendingResetCount += 1;
            return [{ affectedRows: 1 }];
        }
        if (sql.startsWith("UPDATE pending_registrations SET status = 'pending_profile_completion'")) {
            pendingMarkedVerifiedCount += 1;
            return [{ affectedRows: 1 }];
        }
        if (sql.startsWith('UPDATE otp_tokens SET used_at = NOW() WHERE email')) {
            return [{ affectedRows: 1 }];
        }
        if (sql.startsWith('INSERT INTO otp_tokens')) {
            return [{ insertId: 501, affectedRows: 1 }];
        }
        if (sql.startsWith('UPDATE otp_tokens SET used_at = NOW() WHERE id')) {
            return [{ affectedRows: 1 }];
        }
        if (sql.startsWith('UPDATE otp_tokens SET attempts = attempts + 1')) {
            return [{ affectedRows: 1 }];
        }

        throw new Error(`Query test belum ditangani: ${sql}`);
    }
};

const dbPath = require.resolve('../config/db');
const notificationPath = require.resolve('../utils/notifikasi');
require.cache[dbPath] = { exports: fakePool };
require.cache[notificationPath] = {
    exports: {
        ensureNotificationSchema: async () => {},
        kirimEmail: async () => {
            sentEmailCount += 1;
            return { sent: true };
        }
    }
};

const {
    registerUser,
    verifyEmailOtp,
    completeRegistration
} = require('../controllers/authController');

function createResponse() {
    return {
        statusCode: 200,
        body: null,
        cookies: new Map(),
        clearedCookies: new Set(),
        status(code) {
            this.statusCode = code;
            return this;
        },
        cookie(name, value) {
            this.cookies.set(name, value);
            return this;
        },
        clearCookie(name) {
            this.clearedCookies.add(name);
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
}

function registrationResumeCookie() {
    const token = jwt.sign(
        {
            pending_registration_id: pendingRegistration.id,
            email: pendingRegistration.email,
            purpose: 'registration_resume'
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
    );
    return `bpn_registration_resume=${encodeURIComponent(token)}`;
}

async function runRegistration(currentScenario, email, cookie = '') {
    scenario = currentScenario;
    const res = createResponse();
    await registerUser({ body: { email }, headers: { cookie } }, res);
    return res;
}

(async () => {
    let response = await runRegistration('pending_otp_active', pendingRegistration.email);
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.status, 'pending_email_verification');
    assert.strictEqual(response.body.otp_sent, false);
    assert.strictEqual(response.body.resend_available_in_seconds, 37);
    assert.strictEqual(sentEmailCount, 0);
    assert.strictEqual(insertedUserCount, 0);

    response = await runRegistration('pending_otp_expired', pendingRegistration.email);
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.status, 'pending_email_verification');
    assert.strictEqual(response.body.code, 'OTP_EXPIRED_REISSUED');
    assert.strictEqual(response.body.otp_sent, true);
    assert.strictEqual(sentEmailCount, 1);
    assert.strictEqual(insertedUserCount, 0);

    const sendsBeforeRecentResume = sentEmailCount;
    response = await runRegistration(
        'profile_recent',
        pendingRegistration.email,
        registrationResumeCookie()
    );
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.status, 'pending_profile_completion');
    assert.strictEqual(response.body.requires_profile_completion, true);
    assert.ok(response.body.registration_token);
    assert.ok(response.body.profile_completion_valid_for_seconds > 0);
    assert.strictEqual(sentEmailCount, sendsBeforeRecentResume);
    assert.strictEqual(insertedUserCount, 0);

    response = await runRegistration('profile_recent', pendingRegistration.email);
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.status, 'pending_email_verification');
    assert.strictEqual(response.body.code, 'PROFILE_DEVICE_REVERIFICATION_REQUIRED');
    assert.strictEqual(response.body.otp_sent, true);
    assert.strictEqual(sentEmailCount, sendsBeforeRecentResume + 1);

    response = await runRegistration(
        'profile_stale',
        pendingRegistration.email,
        registrationResumeCookie()
    );
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.status, 'pending_email_verification');
    assert.strictEqual(response.body.code, 'PROFILE_REVERIFICATION_REQUIRED');
    assert.strictEqual(response.body.otp_sent, true);
    assert.strictEqual(sentEmailCount, sendsBeforeRecentResume + 2);
    assert.ok(pendingResetCount >= 3);
    assert.strictEqual(insertedUserCount, 0);

    scenario = 'verify_otp';
    const verifyResponse = createResponse();
    await verifyEmailOtp({
        body: {
            email: pendingRegistration.email,
            otp: '123456'
        }
    }, verifyResponse);
    assert.strictEqual(verifyResponse.statusCode, 200);
    assert.strictEqual(verifyResponse.body.status, 'pending_profile_completion');
    assert.strictEqual(verifyResponse.body.requires_profile_completion, true);
    assert.ok(verifyResponse.body.registration_token);
    assert.ok(verifyResponse.cookies.has('bpn_registration_resume'));
    assert.strictEqual(pendingMarkedVerifiedCount, 1);
    assert.strictEqual(insertedUserCount, 0);

    scenario = 'complete';
    const invalidPhoneResponse = createResponse();
    await completeRegistration({
        body: {
            registration_token: verifyResponse.body.registration_token,
            nama_lengkap: 'Pemohon Test',
            no_hp: '07123456789',
            password: 'rahasia123'
        }
    }, invalidPhoneResponse);
    assert.strictEqual(invalidPhoneResponse.statusCode, 400);
    assert.strictEqual(invalidPhoneResponse.body.code, 'PHONE_INVALID_PREFIX');
    assert.strictEqual(insertedUserCount, 0);

    const completeResponse = createResponse();
    await completeRegistration({
        body: {
            registration_token: verifyResponse.body.registration_token,
            nama_lengkap: 'Pemohon Test',
            no_hp: '0812 0000 0071',
            password: 'rahasia123'
        }
    }, completeResponse);
    assert.strictEqual(completeResponse.statusCode, 201);
    assert.strictEqual(completeResponse.body.status, 'active');
    assert.ok(completeResponse.body.token);
    assert.strictEqual(completeResponse.body.role, 'user');
    assert.strictEqual(insertedUserCount, 1);
    assert.strictEqual(insertedPhone, '6281200000071');
    assert.strictEqual(pendingDeletedCount, 1);
    assert.ok(completeResponse.clearedCookies.has('bpn_registration_resume'));

    response = await runRegistration('active_user', 'active@example.com');
    assert.strictEqual(response.statusCode, 409);
    assert.strictEqual(response.body.status, 'active');
    assert.strictEqual(response.body.message, 'Email sudah terdaftar. Silakan masuk.');
    assert.strictEqual(insertedUserCount, 1);

    console.log('Registration status lifecycle: OK');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
