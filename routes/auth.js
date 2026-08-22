const express = require('express');
const router = express.Router();

const {
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
} = require('../controllers/authController');

const { getWilayah } = require('../controllers/adminController');
const verifyToken = require('../middleware/auth');
const {
    gantiSandi,
    lupaSandiPetugas,
    resetSandiPetugas
} = require('../controllers/sandiController');
const { authLimiter } = require('../middleware/rateLimit');

router.post('/register', authLimiter, registerUser);
router.post('/login', authLimiter, loginUser);
router.post('/verify-email', authLimiter, verifyEmailOtp);
router.post('/complete-registration', authLimiter, completeRegistration);
router.post('/resend-verification', authLimiter, resendVerificationOtp);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);

router.get('/petugas-aktif', getPetugasAktif); // untuk booking user

// Daftar wilayah dipakai form booking pemohon sebelum login, jadi memang
// publik. Sebelumnya endpoint ini menempel di router admin tanpa penjaga -
// terlihat seperti kelalaian, padahal disengaja. Dipindah ke sini agar
// router admin tidak lagi memuat endpoint tanpa autentikasi.
router.get('/wilayah', getWilayah);

router.get('/profile', verifyToken('user'), getProfile); // untuk profil user

router.get('/notifications', verifyToken(['user', 'petugas', 'admin']), getNotifications);
router.patch('/notifications/read', verifyToken(['user', 'petugas', 'admin']), markAllRead);

router.post('/login-petugas', authLimiter, loginPetugas);
router.post('/login-admin', authLimiter, loginAdmin);

// Menghapus cookie sesi di sisi server. Tanpa ini, "keluar" hanya
// membersihkan browser sementara tokennya tetap sah sampai kedaluwarsa.
router.post('/logout', logout);

// Ganti sandi berlaku untuk ketiga peran; tabel akun dipilih dari peran di
// dalam token, bukan dari kiriman klien.
router.post(
    '/ganti-sandi',
    authLimiter,
    verifyToken(['user', 'petugas', 'admin']),
    gantiSandi
);

// Lupa sandi khusus petugas: cukup NIP, OTP dikirim ke email tersimpan.
router.post('/lupa-sandi-petugas', authLimiter, lupaSandiPetugas);
router.post('/reset-sandi-petugas', authLimiter, resetSandiPetugas);

module.exports = router;
