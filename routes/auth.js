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

const verifyToken = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');

router.post('/register', authLimiter, registerUser);
router.post('/login', authLimiter, loginUser);
router.post('/verify-email', authLimiter, verifyEmailOtp);
router.post('/complete-registration', authLimiter, completeRegistration);
router.post('/resend-verification', authLimiter, resendVerificationOtp);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);

router.get('/petugas-aktif', getPetugasAktif); // untuk booking user

router.get('/profile', verifyToken('user'), getProfile); // untuk profil user

router.get('/notifications', verifyToken(['user', 'petugas', 'admin']), getNotifications);
router.patch('/notifications/read', verifyToken(['user', 'petugas', 'admin']), markAllRead);

router.post('/login-petugas', authLimiter, loginPetugas);
router.post('/login-admin', authLimiter, loginAdmin);

// Menghapus cookie sesi di sisi server. Tanpa ini, "keluar" hanya
// membersihkan browser sementara tokennya tetap sah sampai kedaluwarsa.
router.post('/logout', logout);

module.exports = router;
