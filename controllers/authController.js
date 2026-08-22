const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ensureNotificationSchema } = require('../utils/notifikasi');
const { serverError } = require('../utils/http');
const {
    parseCookies,
    setSessionCookies,
    clearSessionCookies
} = require('../utils/sesi');
const {
    normalizeIndonesianPhone,
    requireIndonesianPhone,
    assertPhoneAvailable,
    acquirePhoneLock,
    releasePhoneLock,
    ensurePhoneSchema
} = require('../utils/phone');
const {
    ensureOtpSchema,
    sendOtp,
    getOtpState,
    verifyOtp,
    normalizeEmail,
    maskEmail,
    pendingRegistrationRetentionDays,
    profileCompletionTrustHours
} = require('../utils/otp');
require('dotenv').config();

// jsonwebtoken melempar error bila `expiresIn` bernilai undefined (bukan
// diabaikan), jadi env yang belum diisi akan membuat SEMUA login balas 500.
// Fallback wajib ada agar satu variabel env yang terlewat tidak melumpuhkan login.
const generateToken = (payload) =>
    jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '1d'
    });

const generateRegistrationToken = (pendingRegistrationId, email) =>
    jwt.sign(
        {
            pending_registration_id: pendingRegistrationId,
            email,
            purpose: 'complete_registration'
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.REGISTRATION_COMPLETION_EXPIRES_IN || '30m' }
    );

const registrationResumeCookieName = 'bpn_registration_resume';

// Membalas login: token dipasang sebagai cookie httpOnly, TIDAK dikirim di
// badan respons. Frontend tidak perlu - dan tidak boleh - menyentuh token.
function balasSesiBaru(res, { token, nama, role, status = 200, extra = {} }) {
    setSessionCookies(res, token);
    return res.status(status).json({ nama, role, ...extra });
}

const MIN_PASSWORD_LENGTH = 8;
const KREDENSIAL_SALAH = 'Email/No. HP atau kata sandi salah.';
const KREDENSIAL_ADMIN_SALAH = 'Username atau kata sandi salah.';
// Hash bcrypt dari string acak, hanya dipakai sebagai pembanding tiruan supaya
// login akun yang tidak ada memakan waktu setara dengan akun yang ada.
const DUMMY_PASSWORD_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const generateRegistrationResumeToken = (pendingRegistrationId, email) =>
    jwt.sign(
        {
            pending_registration_id: pendingRegistrationId,
            email,
            purpose: 'registration_resume'
        },
        process.env.JWT_SECRET,
        { expiresIn: `${profileCompletionTrustHours}h` }
    );

function hasValidRegistrationResume(req, pendingRegistration) {
    const token = parseCookies(req)[registrationResumeCookieName];
    if (!token) return false;
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        return payload.purpose === 'registration_resume'
            && Number(payload.pending_registration_id) === Number(pendingRegistration.id)
            && normalizeEmail(payload.email) === normalizeEmail(pendingRegistration.email);
    } catch {
        return false;
    }
}

function setRegistrationResumeCookie(res, pendingRegistration) {
    res.cookie(
        registrationResumeCookieName,
        generateRegistrationResumeToken(pendingRegistration.id, pendingRegistration.email),
        {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: profileCompletionTrustHours * 60 * 60 * 1000,
            path: '/'
        }
    );
}

function clearRegistrationResumeCookie(res) {
    res.clearCookie(registrationResumeCookieName, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
    });
}

function authError(res, err) {
    if (err.status) {
        return res.status(err.status).json({
            message: err.message,
            code: err.code,
            ...(err.details || {})
        });
    }
    return serverError(res, err);
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

async function cleanupPendingRegistrations() {
    await pool.query(`
        UPDATE otp_tokens otp
        INNER JOIN pending_registrations pending
            ON pending.id = otp.pending_registration_id
        SET otp.used_at = COALESCE(otp.used_at, NOW())
        WHERE pending.expires_at <= NOW()
          AND otp.used_at IS NULL
    `);
    await pool.query(`
        DELETE FROM pending_registrations
        WHERE expires_at <= NOW()
    `);
}

function verificationPayload({
    status,
    code,
    message,
    email,
    otpSent,
    otpState = null,
    delivery = null
}) {
    return {
        status,
        code,
        message,
        requires_verification: true,
        otp_sent: Boolean(otpSent),
        email,
        masked_email: delivery?.maskedEmail || maskEmail(email),
        otp_expires_in_seconds: Number(
            delivery?.expiresInSeconds
            ?? otpState?.expiresInSeconds
            ?? 0
        ),
        resend_available_in_seconds: Number(
            delivery?.resendAvailableInSeconds
            ?? otpState?.resendAvailableInSeconds
            ?? 0
        )
    };
}

function emailAlreadyRegistered(res) {
    clearRegistrationResumeCookie(res);
    return res.status(409).json({
        status: 'active',
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'Email sudah terdaftar. Silakan masuk.'
    });
}

function profileCompletionPayload(pendingRegistration) {
    const verificationAge = Math.max(
        0,
        Number(pendingRegistration.verification_age_seconds || 0)
    );
    const trustSeconds = profileCompletionTrustHours * 60 * 60;
    return {
        status: 'pending_profile_completion',
        code: 'PROFILE_COMPLETION_REQUIRED',
        message: 'Email berhasil diverifikasi. Lengkapi data diri untuk membuat akun.',
        requires_verification: false,
        requires_profile_completion: true,
        email: pendingRegistration.email,
        masked_email: maskEmail(pendingRegistration.email),
        profile_completion_valid_for_seconds: Math.max(0, trustSeconds - verificationAge),
        registration_token: generateRegistrationToken(
            pendingRegistration.id,
            pendingRegistration.email
        )
    };
}

function profileCompletionIsTrusted(pendingRegistration) {
    const age = Number(pendingRegistration.verification_age_seconds);
    return Number.isFinite(age)
        && age >= 0
        && age < profileCompletionTrustHours * 60 * 60;
}

async function issuePendingRegistrationOtp(pendingRegistration, email, responseState) {
    await pool.query(
        `UPDATE pending_registrations
         SET status = 'pending_email_verification',
             verified_at = NULL,
             email_verified_at = NULL,
             expires_at = DATE_ADD(NOW(), INTERVAL ${pendingRegistrationRetentionDays} DAY)
         WHERE id = ?`,
        [pendingRegistration.id]
    );

    const delivery = await sendOtp({
        pendingRegistrationId: pendingRegistration.id,
        email,
        purpose: 'verify_email',
        enforceCooldown: false
    });

    return verificationPayload({
        status: 'pending_email_verification',
        code: responseState.code,
        message: responseState.message,
        email,
        otpSent: true,
        delivery
    });
}

// REGISTER PEMOHON
const registerUser = async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!email)
        return res.status(400).json({ message: 'Email wajib diisi' });

    if (!isValidEmail(email))
        return res.status(400).json({ message: 'Format email tidak valid' });

    try {
        await ensureOtpSchema();
        await cleanupPendingRegistrations();

        const [userRows] = await pool.query(
            `SELECT id, email, email_verified_at, profile_completed_at
             FROM users
             WHERE email = ?
             LIMIT 1`,
            [email]
        );

        const existingUser = userRows[0];
        if (existingUser?.email_verified_at && existingUser?.profile_completed_at) {
            return emailAlreadyRegistered(res);
        }

        if (existingUser) {
            const otpState = await getOtpState({
                userId: existingUser.id,
                email,
                purpose: 'verify_email'
            });

            if (otpState.active) {
                return res.json(verificationPayload({
                    status: 'pending_email_verification',
                    code: 'PENDING_VERIFICATION',
                    message: 'Kode OTP yang sebelumnya dikirim masih aktif. Masukkan kode tersebut untuk melanjutkan verifikasi.',
                    email,
                    otpSent: false,
                    otpState
                }));
            }

            const delivery = await sendOtp({
                userId: existingUser.id,
                email,
                purpose: 'verify_email',
                enforceCooldown: false
            });

            return res.json(verificationPayload({
                status: 'pending_email_verification',
                code: 'OTP_EXPIRED_REISSUED',
                message: 'Kode OTP sebelumnya sudah tidak aktif. Kode OTP baru telah dikirim ke email Anda.',
                email,
                otpSent: true,
                delivery
            }));
        }

        const [pendingRows] = await pool.query(
            `SELECT *,
                    TIMESTAMPDIFF(
                        SECOND,
                        COALESCE(email_verified_at, verified_at),
                        NOW()
                    ) AS verification_age_seconds
             FROM pending_registrations
             WHERE email = ? AND expires_at > NOW()
             LIMIT 1`,
            [email]
        );
        const pendingRegistration = pendingRows[0];

        if (pendingRegistration) {
            if (pendingRegistration.status === 'pending_profile_completion') {
                if (
                    profileCompletionIsTrusted(pendingRegistration)
                    && hasValidRegistrationResume(req, pendingRegistration)
                ) {
                    return res.json(profileCompletionPayload(pendingRegistration));
                }

                clearRegistrationResumeCookie(res);
                const payload = await issuePendingRegistrationOtp(
                    pendingRegistration,
                    email,
                    {
                        code: profileCompletionIsTrusted(pendingRegistration)
                            ? 'PROFILE_DEVICE_REVERIFICATION_REQUIRED'
                            : 'PROFILE_REVERIFICATION_REQUIRED',
                        message: profileCompletionIsTrusted(pendingRegistration)
                            ? 'Browser ini belum memiliki sesi verifikasi. Kode OTP baru telah dikirim untuk menjaga keamanan akun.'
                            : `Verifikasi terakhir sudah lebih dari ${profileCompletionTrustHours} jam. Kode OTP baru telah dikirim.`
                    }
                );
                return res.json(payload);
            }

            const otpState = await getOtpState({
                pendingRegistrationId: pendingRegistration.id,
                email,
                purpose: 'verify_email'
            });

            if (otpState.active) {
                return res.json(verificationPayload({
                    status: 'pending_email_verification',
                    code: 'PENDING_VERIFICATION',
                    message: 'Kode OTP yang sebelumnya dikirim masih aktif. Masukkan kode tersebut untuk melanjutkan verifikasi.',
                    email,
                    otpSent: false,
                    otpState
                }));
            }
        }

        if (pendingRegistration) {
            const payload = await issuePendingRegistrationOtp(
                pendingRegistration,
                email,
                {
                    code: 'OTP_EXPIRED_REISSUED',
                    message: 'Kode OTP sebelumnya sudah tidak aktif. Kode OTP baru telah dikirim ke email Anda.'
                }
            );
            return res.json(payload);
        }

        const [pending] = await pool.query(
            `INSERT INTO pending_registrations
                (email, status, expires_at)
             VALUES (
                ?,
                'pending_email_verification',
                DATE_ADD(NOW(), INTERVAL ${pendingRegistrationRetentionDays} DAY)
             )`,
            [email]
        );

        try {
            const delivery = await sendOtp({
                pendingRegistrationId: pending.insertId,
                email,
                purpose: 'verify_email'
            });

            return res.status(201).json(verificationPayload({
                status: 'pending_email_verification',
                code: 'OTP_SENT',
                message: 'Kode OTP verifikasi telah dikirim. Masukkan OTP untuk menyelesaikan pendaftaran akun.',
                email,
                otpSent: true,
                delivery
            }));
        } catch (otpErr) {
            await pool.query('DELETE FROM pending_registrations WHERE id = ?', [pending.insertId]);
            console.error('[OTP Register]', otpErr.code || 'OTP_EMAIL_FAILED', otpErr.message);
            return authError(res, otpErr);
        }
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY' && !req.registrationConflictRetried) {
            req.registrationConflictRetried = true;
            return registerUser(req, res);
        }
        return authError(res, err);
    }
};

// LOGIN PEMOHON
const loginUser = async (req, res) => {
    const { identifier, password } = req.body;
    if (!identifier || !password)
        return res.status(400).json({ message: 'Email/No. HP dan password wajib diisi' });

    try {
        await ensureOtpSchema();
        await ensurePhoneSchema();

        const cleanIdentifier = String(identifier).trim();
        const phoneIdentifier = normalizeIndonesianPhone(cleanIdentifier);
        const lookupIdentifier = cleanIdentifier.includes('@') || !phoneIdentifier.valid
            ? cleanIdentifier
            : phoneIdentifier.normalized;

        const [rows] = await pool.query(
            'SELECT * FROM users WHERE email = ? OR no_hp = ?',
            [lookupIdentifier, lookupIdentifier]
        );
        // Pesan yang sama untuk "akun tidak ada" dan "password salah" supaya
        // tidak bisa dipakai memetakan email/nomor HP mana yang terdaftar.
        // bcrypt.compare tetap dijalankan atas hash pengganti agar waktu respons
        // kedua kasus itu tidak berbeda jauh.
        const user = rows[0];
        const valid = user
            ? await bcrypt.compare(password, user.password)
            : await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
        if (!user || !valid)
            return res.status(401).json({ message: KREDENSIAL_SALAH });

        if (!user.email_verified_at) {
            const otpState = await getOtpState({
                userId: user.id,
                email: user.email,
                purpose: 'verify_email'
            });
            return res.status(403).json({
                message: 'Email belum diverifikasi. Masukkan kode OTP yang dikirim ke email Anda.',
                code: 'EMAIL_NOT_VERIFIED',
                email: user.email,
                masked_email: maskEmail(user.email),
                otp_expires_in_seconds: otpState.expiresInSeconds,
                resend_available_in_seconds: otpState.resendAvailableInSeconds
            });
        }

        return balasSesiBaru(res, {
            token: generateToken({ id: user.id, nama: user.nama_lengkap, role: 'user' }),
            nama: user.nama_lengkap,
            role: 'user'
        });
    } catch (err) {
        return authError(res, err);
    }
};

const verifyEmailOtp = async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const { otp } = req.body;
    if (!email || !otp)
        return res.status(400).json({ message: 'Email dan kode OTP wajib diisi' });

    try {
        await ensureOtpSchema();
        const verified = await verifyOtp({ email, purpose: 'verify_email', otp });

        if (verified.userId && !verified.pendingRegistrationId) {
            const [result] = await pool.query(
                'UPDATE users SET email_verified_at = NOW() WHERE id = ? AND email = ?',
                [verified.userId, email]
            );
            if (result.affectedRows === 0) {
                return res.status(400).json({ message: 'Pendaftaran tidak ditemukan. Silakan daftar ulang.' });
            }
            const [userRows] = await pool.query(
                'SELECT id, nama_lengkap FROM users WHERE id = ? AND email = ? LIMIT 1',
                [verified.userId, email]
            );
            const user = userRows[0];
            if (!user) {
                return res.status(400).json({ message: 'Akun tidak ditemukan. Silakan daftar ulang.' });
            }
            return balasSesiBaru(res, {
                token: generateToken({ id: user.id, nama: user.nama_lengkap, role: 'user' }),
                nama: user.nama_lengkap,
                role: 'user',
                extra: {
                    status: 'active',
                    code: 'ACCOUNT_COMPLETED',
                    message: 'Email berhasil diverifikasi.'
                }
            });
        }

        const [pendingRows] = await pool.query(
            `SELECT *
             FROM pending_registrations
             WHERE id = ? AND email = ? AND expires_at > NOW()
             LIMIT 1`,
            [verified.pendingRegistrationId, email]
        );

        if (pendingRows.length === 0) {
            return res.status(400).json({ message: 'Pendaftaran sementara tidak ditemukan. Silakan daftar ulang.' });
        }

        await pool.query(
            `UPDATE pending_registrations
             SET status = 'pending_profile_completion',
                 verified_at = NOW(),
                 email_verified_at = NOW(),
                 expires_at = DATE_ADD(NOW(), INTERVAL ${pendingRegistrationRetentionDays} DAY)
             WHERE id = ?`,
            [pendingRows[0].id]
        );

        const verifiedPending = {
            ...pendingRows[0],
            status: 'pending_profile_completion',
            verified_at: new Date(),
            email_verified_at: new Date(),
            verification_age_seconds: 0
        };
        setRegistrationResumeCookie(res, verifiedPending);
        res.json(profileCompletionPayload({
            ...verifiedPending
        }));
    } catch (err) {
        return authError(res, err);
    }
};

const completeRegistration = async (req, res) => {
    const registrationToken = String(req.body.registration_token || '');
    const nama_lengkap = String(req.body.nama_lengkap || '').trim();
    const password = String(req.body.password || '');

    if (!registrationToken || !nama_lengkap || !req.body.no_hp || !password) {
        return res.status(400).json({ message: 'Semua data diri wajib diisi' });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ message: `Kata sandi minimal ${MIN_PASSWORD_LENGTH} karakter` });
    }

    let no_hp;
    try {
        no_hp = requireIndonesianPhone(req.body.no_hp);
    } catch (err) {
        return authError(res, err);
    }

    let registration;
    try {
        registration = jwt.verify(registrationToken, process.env.JWT_SECRET);
    } catch (err) {
        const expired = err.name === 'TokenExpiredError';
        return res.status(401).json({
            code: expired ? 'REGISTRATION_TOKEN_EXPIRED' : 'REGISTRATION_TOKEN_INVALID',
            message: expired
                ? 'Sesi pengisian data telah berakhir. Masukkan kembali email Anda untuk melanjutkan.'
                : 'Sesi pendaftaran tidak valid. Silakan mulai kembali.'
        });
    }

    if (
        registration.purpose !== 'complete_registration'
        || !registration.pending_registration_id
        || !registration.email
    ) {
        return res.status(401).json({
            code: 'REGISTRATION_TOKEN_INVALID',
            message: 'Sesi pendaftaran tidak valid. Silakan mulai kembali.'
        });
    }

    let connection;
    let phoneLockName = null;
    try {
        await ensureOtpSchema();
        await ensurePhoneSchema();
        const passwordHash = await bcrypt.hash(password, 10);
        connection = await pool.getConnection();
        phoneLockName = await acquirePhoneLock(connection, no_hp);
        await connection.beginTransaction();

        const [pendingRows] = await connection.query(
            `SELECT id, email
             FROM pending_registrations
             WHERE id = ?
               AND email = ?
               AND status = 'pending_profile_completion'
               AND COALESCE(email_verified_at, verified_at) >=
                   DATE_SUB(NOW(), INTERVAL ${profileCompletionTrustHours} HOUR)
               AND expires_at > NOW()
             LIMIT 1
             FOR UPDATE`,
            [registration.pending_registration_id, normalizeEmail(registration.email)]
        );

        if (pendingRows.length === 0) {
            await connection.rollback();
            return res.status(401).json({
                code: 'REGISTRATION_SESSION_EXPIRED',
                message: 'Sesi pendaftaran telah berakhir. Masukkan kembali email Anda untuk melanjutkan.'
            });
        }

        const pending = pendingRows[0];
        const [existingUsers] = await connection.query(
            `SELECT id, email
             FROM users
             WHERE email = ?`,
            [pending.email]
        );

        if (existingUsers.some(user => normalizeEmail(user.email) === pending.email)) {
            await connection.rollback();
            return emailAlreadyRegistered(res);
        }
        await assertPhoneAvailable(connection, no_hp);

        const [insertResult] = await connection.query(
            `INSERT INTO users
                (
                    nama_lengkap,
                    email,
                    no_hp,
                    password,
                    email_verified_at,
                    profile_completed_at
                )
             VALUES (?, ?, ?, ?, NOW(), NOW())`,
            [nama_lengkap, pending.email, no_hp, passwordHash]
        );
        await connection.query(
            'DELETE FROM pending_registrations WHERE id = ?',
            [pending.id]
        );
        await connection.commit();
        clearRegistrationResumeCookie(res);

        return balasSesiBaru(res, {
            token: generateToken({
                id: insertResult.insertId,
                nama: nama_lengkap,
                role: 'user'
            }),
            nama: nama_lengkap,
            role: 'user',
            status: 201,
            extra: {
                status: 'active',
                code: 'ACCOUNT_COMPLETED',
                message: 'Akun berhasil dibuat.'
            }
        });
    } catch (err) {
        if (connection) {
            try {
                await connection.rollback();
            } catch {}
        }
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                code: 'ACCOUNT_DATA_ALREADY_REGISTERED',
                message: 'Email atau No. HP sudah terdaftar.'
            });
        }
        return authError(res, err);
    } finally {
        await releasePhoneLock(connection, phoneLockName);
        connection?.release();
    }
};

const resendVerificationOtp = async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ message: 'Email wajib diisi' });

    try {
        await ensureOtpSchema();
        await cleanupPendingRegistrations();

        const [userRows] = await pool.query(
            'SELECT id, email_verified_at FROM users WHERE email = ?',
            [email]
        );

        if (userRows.length > 0 && userRows[0].email_verified_at) {
            return emailAlreadyRegistered(res);
        }

        const userId = userRows[0]?.id || null;
        let pendingRegistrationId = null;

        if (!userId) {
            const [pendingRows] = await pool.query(
                `SELECT id, status,
                        TIMESTAMPDIFF(
                            SECOND,
                            COALESCE(email_verified_at, verified_at),
                            NOW()
                        ) AS verification_age_seconds
                 FROM pending_registrations
                 WHERE email = ? AND expires_at > NOW()
                 LIMIT 1`,
                [email]
            );

            if (pendingRows.length === 0) {
                return res.status(404).json({
                    code: 'PENDING_REGISTRATION_NOT_FOUND',
                    message: 'Pendaftaran sementara tidak ditemukan. Silakan daftar ulang.'
                });
            }
            if (
                pendingRows[0].status === 'pending_profile_completion'
                && profileCompletionIsTrusted(pendingRows[0])
                && hasValidRegistrationResume(req, {
                    ...pendingRows[0],
                    email
                })
            ) {
                return res.json(profileCompletionPayload({
                    ...pendingRows[0],
                    email
                }));
            }
            if (pendingRows[0].status === 'pending_profile_completion') {
                clearRegistrationResumeCookie(res);
                const payload = await issuePendingRegistrationOtp(
                    pendingRows[0],
                    email,
                    {
                        code: profileCompletionIsTrusted(pendingRows[0])
                            ? 'PROFILE_DEVICE_REVERIFICATION_REQUIRED'
                            : 'PROFILE_REVERIFICATION_REQUIRED',
                        message: profileCompletionIsTrusted(pendingRows[0])
                            ? 'Browser ini belum memiliki sesi verifikasi. Kode OTP baru telah dikirim untuk menjaga keamanan akun.'
                            : `Verifikasi terakhir sudah lebih dari ${profileCompletionTrustHours} jam. Kode OTP baru telah dikirim.`
                    }
                );
                return res.json(payload);
            }
            pendingRegistrationId = pendingRows[0].id;
        }

        const delivery = await sendOtp({
            userId,
            pendingRegistrationId,
            email,
            purpose: 'verify_email'
        });
        res.json(verificationPayload({
            status: 'pending_email_verification',
            code: 'OTP_RESENT',
            message: 'Kode OTP baru telah dikirim ke email.',
            email,
            otpSent: true,
            delivery
        }));
    } catch (err) {
        return authError(res, err);
    }
};

const forgotPassword = async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ message: 'Email wajib diisi' });

    // Pesan generik yang sama untuk email terdaftar maupun tidak,
    // agar tidak membocorkan apakah sebuah email terdaftar (anti-enumeration).
    const genericMessage = 'Jika email terdaftar, kode OTP reset sandi telah dikirim ke email tersebut.';
    try {
        await ensureOtpSchema();
        const [rows] = await pool.query(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (rows.length > 0) {
            try {
                await sendOtp({ userId: rows[0].id, email, purpose: 'password_reset' });
            } catch (sendErr) {
                // Jangan bocorkan keberadaan email lewat error (mis. cooldown OTP).
                console.error('[Forgot Password]', sendErr.code || 'OTP_SEND_FAILED', sendErr.message);
            }
        }
        return res.json({ message: genericMessage });
    } catch (err) {
        return authError(res, err);
    }
};

const resetPassword = async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const { otp, password } = req.body;
    if (!email || !otp || !password)
        return res.status(400).json({ message: 'Email, OTP, dan kata sandi baru wajib diisi' });

    if (String(password).length < MIN_PASSWORD_LENGTH)
        return res.status(400).json({ message: `Kata sandi minimal ${MIN_PASSWORD_LENGTH} karakter` });

    try {
        await ensureOtpSchema();
        const verified = await verifyOtp({ email, purpose: 'password_reset', otp });
        const hash = await bcrypt.hash(password, 10);
        const [result] = await pool.query(
            `UPDATE users
             SET password = ?, email_verified_at = COALESCE(email_verified_at, NOW())
             WHERE id = ? AND email = ?`,
            [hash, verified.userId, email]
        );
        // Tanpa pemeriksaan ini, akun yang sudah terhapus di tengah alur OTP
        // tetap dijawab "berhasil" padahal tidak ada yang berubah.
        if (result.affectedRows === 0) {
            return res.status(404).json({
                code: 'ACCOUNT_NOT_FOUND',
                message: 'Akun tidak ditemukan. Silakan daftar ulang.'
            });
        }
        res.json({ message: 'Kata sandi berhasil diubah. Silakan login.' });
    } catch (err) {
        return authError(res, err);
    }
};

// LOGIN PETUGAS
const loginPetugas = async (req, res) => {
    const { nip, password } = req.body;
    if (!nip || !password)
        return res.status(400).json({ message: 'NIP dan password wajib diisi' });

    try {
        const [rows] = await pool.query(
            'SELECT * FROM petugas WHERE nip = ? AND is_active = 1', [nip]
        );
        const petugas = rows[0];
        const valid = petugas
            ? await bcrypt.compare(password, petugas.password)
            : await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
        if (!petugas || !valid)
            return res.status(401).json({ message: 'NIP atau password salah, atau akun nonaktif.' });

        return balasSesiBaru(res, {
            token: generateToken({ id: petugas.id, nama: petugas.nama_lengkap, role: 'petugas' }),
            nama: petugas.nama_lengkap,
            role: 'petugas',
            // Sandi awal dibuatkan admin. Selama penanda ini menyala, petugas
            // hanya boleh mengakses endpoint ganti sandi (lihat middleware).
            extra: { harus_ganti_sandi: Number(petugas.harus_ganti_sandi || 0) === 1 }
        });
    } catch (err) {
        return serverError(res, err);
    }
};

// LOGIN ADMIN
const loginAdmin = async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password)
        return res.status(400).json({ message: 'Username dan password wajib diisi' });

    try {
        const [rows] = await pool.query(
            'SELECT * FROM admin WHERE username = ?', [username]
        );
        const admin = rows[0];
        const valid = admin
            ? await bcrypt.compare(password, admin.password)
            : await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
        if (!admin || !valid)
            return res.status(401).json({ message: KREDENSIAL_ADMIN_SALAH });

        return balasSesiBaru(res, {
            token: generateToken({ id: admin.id, nama: admin.nama_lengkap, role: 'admin' }),
            nama: admin.nama_lengkap,
            role: 'admin'
        });
    } catch (err) {
        return serverError(res, err);
    }
};

// GET PETUGAS AKTIF (publik, untuk dropdown form booking)
//
// NIP sengaja TIDAK dikembalikan: endpoint ini dapat diakses tanpa login,
// sedangkan NIP adalah identitas ASN. Form booking hanya perlu id + nama.
const getPetugasAktif = async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, nama_lengkap FROM petugas WHERE is_active = 1 ORDER BY nama_lengkap'
        );
        res.json(rows);
    } catch (err) {
        return serverError(res, err);
    }
};

// GET PROFILE PEMOHON
const getProfile = async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, nama_lengkap, email, no_hp, created_at FROM users WHERE id = ?',
            [req.user.id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'User tidak ditemukan' });
        res.json(rows[0]);
    } catch (err) {
        return serverError(res, err);
    }
};

const getNotifications = async (req, res) => {
    try {
        await ensureNotificationSchema();
        const [rows] = await pool.query(
            `SELECT * FROM notifications
             WHERE recipient_role = ? AND recipient_id = ?
             ORDER BY created_at DESC LIMIT 20`,
            [req.user.role, req.user.id]
        );
        const [unread] = await pool.query(
            `SELECT COUNT(*) as total FROM notifications
             WHERE recipient_role = ? AND recipient_id = ? AND is_read = 0`,
            [req.user.role, req.user.id]
        );
        res.json({ notifications: rows, unread: unread[0].total });
    } catch (err) {
        return serverError(res, err);
    }
};

const markAllRead = async (req, res) => {
    try {
        await ensureNotificationSchema();
        await pool.query(
            `UPDATE notifications SET is_read = 1
             WHERE recipient_role = ? AND recipient_id = ?`,
            [req.user.role, req.user.id]
        );
        res.json({ message: 'Semua notifikasi ditandai sudah dibaca' });
    } catch (err) {
        return serverError(res, err);
    }
};

// Sebelumnya logout hanya menghapus localStorage di browser; tokennya sendiri
// tetap sah sampai kedaluwarsa. Dengan cookie httpOnly, penghapusan harus
// dilakukan server.
const logout = async (req, res) => {
    clearSessionCookies(res);
    clearRegistrationResumeCookie(res);
    return res.json({ message: 'Anda telah keluar.' });
};

module.exports = {
    logout,
    registerUser,
    loginUser,
    verifyEmailOtp,
    completeRegistration,
    resendVerificationOtp,
    forgotPassword,
    resetPassword,
    loginPetugas,
    loginAdmin,
    getPetugasAktif,
    getProfile,
    getNotifications,
    markAllRead
};
