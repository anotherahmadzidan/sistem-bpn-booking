const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ensureNotificationSchema } = require('../utils/notifikasi');
const { serverError } = require('../utils/http');
const {
    ensureOtpSchema,
    sendOtp,
    verifyOtp,
    normalizeEmail,
    maskEmail,
    pendingRegistrationExpiresMinutes
} = require('../utils/otp');
require('dotenv').config();

const generateToken = (payload) =>
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

function authError(res, err) {
    if (err.status) {
        return res.status(err.status).json({
            message: err.message,
            code: err.code
        });
    }
    return serverError(res, err);
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

async function cleanupPendingRegistrations() {
    await pool.query(`
        DELETE FROM pending_registrations
        WHERE verified_at IS NOT NULL OR expires_at <= NOW()
    `);
}

// REGISTER PEMOHON
const registerUser = async (req, res) => {
    const nama_lengkap = String(req.body.nama_lengkap || '').trim();
    const no_hp = String(req.body.no_hp || '').trim();
    const password = req.body.password;
    const email = normalizeEmail(req.body.email);
    if (!nama_lengkap || !email || !no_hp || !password)
        return res.status(400).json({ message: 'Semua field wajib diisi' });

    if (!isValidEmail(email))
        return res.status(400).json({ message: 'Format email tidak valid' });

    if (String(password).length < 6)
        return res.status(400).json({ message: 'Kata sandi minimal 6 karakter' });

    try {
        await ensureOtpSchema();
        await cleanupPendingRegistrations();

        const [exist] = await pool.query(
            'SELECT id FROM users WHERE email = ? OR no_hp = ?', [email, no_hp]
        );
        if (exist.length > 0)
            return res.status(409).json({ message: 'Email atau No. HP sudah terdaftar' });

        const hash = await bcrypt.hash(password, 10);

        await pool.query(
            'DELETE FROM pending_registrations WHERE email = ? OR no_hp = ?',
            [email, no_hp]
        );

        const [pending] = await pool.query(
            `INSERT INTO pending_registrations
                (nama_lengkap, email, no_hp, password_hash, expires_at)
             VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ${pendingRegistrationExpiresMinutes} MINUTE))`,
            [nama_lengkap, email, no_hp, hash]
        );

        try {
            await sendOtp({
                pendingRegistrationId: pending.insertId,
                email,
                purpose: 'verify_email'
            });
        } catch (otpErr) {
            await pool.query('DELETE FROM pending_registrations WHERE id = ?', [pending.insertId]);
            console.error('[OTP Register]', otpErr.code || 'OTP_EMAIL_FAILED', otpErr.message);
            return authError(res, otpErr);
        }

        res.status(201).json({
            message: 'Kode OTP verifikasi telah dikirim. Masukkan OTP untuk menyelesaikan pendaftaran akun.',
            requires_verification: true,
            otp_sent: true,
            email: maskEmail(email)
        });
    } catch (err) {
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

        const [rows] = await pool.query(
            'SELECT * FROM users WHERE email = ? OR no_hp = ?', [identifier, identifier]
        );
        if (rows.length === 0)
            return res.status(401).json({ message: 'Akun tidak ditemukan' });

        const user = rows[0];
        const valid = await bcrypt.compare(password, user.password);
        if (!valid)
            return res.status(401).json({ message: 'Password salah' });

        if (!user.email_verified_at) {
            return res.status(403).json({
                message: 'Email belum diverifikasi. Masukkan kode OTP yang dikirim ke email Anda.',
                code: 'EMAIL_NOT_VERIFIED',
                email: user.email,
                masked_email: maskEmail(user.email)
            });
        }

        const token = generateToken({ id: user.id, nama: user.nama_lengkap, role: 'user' });
        res.json({ token, nama: user.nama_lengkap, role: 'user' });
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
            return res.json({ message: 'Email berhasil diverifikasi. Silakan login.' });
        }

        const [pendingRows] = await pool.query(
            `SELECT *
             FROM pending_registrations
             WHERE id = ? AND email = ? AND verified_at IS NULL AND expires_at > NOW()
             LIMIT 1`,
            [verified.pendingRegistrationId, email]
        );

        if (pendingRows.length === 0) {
            return res.status(400).json({ message: 'Pendaftaran sementara tidak ditemukan. Silakan daftar ulang.' });
        }

        const pending = pendingRows[0];
        const [exist] = await pool.query(
            'SELECT id FROM users WHERE email = ? OR no_hp = ?',
            [pending.email, pending.no_hp]
        );
        if (exist.length > 0) {
            await pool.query('DELETE FROM pending_registrations WHERE id = ?', [pending.id]);
            return res.status(409).json({ message: 'Email atau No. HP sudah terdaftar' });
        }

        await pool.query(
            `INSERT INTO users
                (nama_lengkap, email, no_hp, password, email_verified_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [pending.nama_lengkap, pending.email, pending.no_hp, pending.password_hash]
        );

        await pool.query(
            'UPDATE pending_registrations SET verified_at = NOW() WHERE id = ?',
            [pending.id]
        );

        res.json({ message: 'Email berhasil diverifikasi. Akun berhasil dibuat, silakan login.' });
    } catch (err) {
        return authError(res, err);
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

        if (userRows.length > 0) {
            return res.json({ message: 'Email sudah terdaftar. Silakan login.' });
        }

        const [pendingRows] = await pool.query(
            `SELECT id
             FROM pending_registrations
             WHERE email = ? AND verified_at IS NULL AND expires_at > NOW()
             LIMIT 1`,
            [email]
        );

        if (pendingRows.length === 0) {
            return res.status(404).json({ message: 'Pendaftaran sementara tidak ditemukan. Silakan daftar ulang.' });
        }

        await sendOtp({
            pendingRegistrationId: pendingRows[0].id,
            email,
            purpose: 'verify_email'
        });
        res.json({ message: 'Kode OTP baru telah dikirim ke email.' });
    } catch (err) {
        return authError(res, err);
    }
};

const forgotPassword = async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ message: 'Email wajib diisi' });

    try {
        await ensureOtpSchema();
        const [rows] = await pool.query(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (rows.length === 0) {
            return res.json({ message: 'Jika email terdaftar, kode OTP reset sandi akan dikirim.' });
        }

        await sendOtp({ userId: rows[0].id, email, purpose: 'password_reset' });
        res.json({ message: 'Kode OTP reset sandi telah dikirim ke email.' });
    } catch (err) {
        return authError(res, err);
    }
};

const resetPassword = async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const { otp, password } = req.body;
    if (!email || !otp || !password)
        return res.status(400).json({ message: 'Email, OTP, dan kata sandi baru wajib diisi' });

    if (String(password).length < 6)
        return res.status(400).json({ message: 'Kata sandi minimal 6 karakter' });

    try {
        await ensureOtpSchema();
        const verified = await verifyOtp({ email, purpose: 'password_reset', otp });
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            `UPDATE users
             SET password = ?, email_verified_at = COALESCE(email_verified_at, NOW())
             WHERE id = ? AND email = ?`,
            [hash, verified.userId, email]
        );
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
        if (rows.length === 0)
            return res.status(401).json({ message: 'NIP tidak ditemukan atau akun nonaktif' });

        const petugas = rows[0];
        const valid = await bcrypt.compare(password, petugas.password);
        if (!valid)
            return res.status(401).json({ message: 'Password salah' });

        const token = generateToken({ id: petugas.id, nama: petugas.nama_lengkap, role: 'petugas' });
        res.json({ token, nama: petugas.nama_lengkap, role: 'petugas' });
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
        if (rows.length === 0)
            return res.status(401).json({ message: 'Username tidak ditemukan' });

        const admin = rows[0];
        const valid = await bcrypt.compare(password, admin.password);
        if (!valid)
            return res.status(401).json({ message: 'Password salah' });

        const token = generateToken({ id: admin.id, nama: admin.nama_lengkap, role: 'admin' });
        res.json({ token, nama: admin.nama_lengkap, role: 'admin' });
    } catch (err) {
        return serverError(res, err);
    }
};

// GET PETUGAS AKTIF (publik, untuk dropdown form booking)
const getPetugasAktif = async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, nip, nama_lengkap FROM petugas WHERE is_active = 1 ORDER BY nama_lengkap'
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

module.exports = {
    registerUser,
    loginUser,
    verifyEmailOtp,
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
