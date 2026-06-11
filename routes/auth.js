const express = require('express');
const router = express.Router();

const {
    registerUser,
    loginUser,
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

router.get('/petugas-aktif', getPetugasAktif); // untuk booking user

router.get('/profile', verifyToken('user'), getProfile); // untuk profil user

router.get('/notifications', verifyToken(['user', 'petugas', 'admin']), getNotifications);
router.patch('/notifications/read', verifyToken(['user', 'petugas', 'admin']), markAllRead);

router.post('/login-petugas', authLimiter, loginPetugas);
router.post('/login-admin', authLimiter, loginAdmin);

module.exports = router;
