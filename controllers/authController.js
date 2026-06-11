const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ensureNotificationSchema } = require('../utils/notifikasi');
const { serverError } = require('../utils/http');
require('dotenv').config();

const generateToken = (payload) =>
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

// REGISTER PEMOHON
const registerUser = async (req, res) => {
    const { nama_lengkap, email, no_hp, password } = req.body;
    if (!nama_lengkap || !email || !no_hp || !password)
        return res.status(400).json({ message: 'Semua field wajib diisi' });

    try {
        const [exist] = await pool.query(
            'SELECT id FROM users WHERE email = ? OR no_hp = ?', [email, no_hp]
        );
        if (exist.length > 0)
            return res.status(409).json({ message: 'Email atau No. HP sudah terdaftar' });

        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (nama_lengkap, email, no_hp, password) VALUES (?, ?, ?, ?)',
            [nama_lengkap, email, no_hp, hash]
        );
        res.status(201).json({ message: 'Registrasi berhasil, silakan login' });
    } catch (err) {
        return serverError(res, err);
    }
};

// LOGIN PEMOHON
const loginUser = async (req, res) => {
    const { identifier, password } = req.body;
    if (!identifier || !password)
        return res.status(400).json({ message: 'Email/No. HP dan password wajib diisi' });

    try {
        const [rows] = await pool.query(
            'SELECT * FROM users WHERE email = ? OR no_hp = ?', [identifier, identifier]
        );
        if (rows.length === 0)
            return res.status(401).json({ message: 'Akun tidak ditemukan' });

        const user = rows[0];
        const valid = await bcrypt.compare(password, user.password);
        if (!valid)
            return res.status(401).json({ message: 'Password salah' });

        const token = generateToken({ id: user.id, nama: user.nama_lengkap, role: 'user' });
        res.json({ token, nama: user.nama_lengkap, role: 'user' });
    } catch (err) {
        return serverError(res, err);
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

module.exports = { registerUser, loginUser, loginPetugas, loginAdmin, getPetugasAktif, getProfile, getNotifications, markAllRead };
