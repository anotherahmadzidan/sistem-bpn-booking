const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();
const { ensureNotificationSchema, verifyEmailTransport } = require('./utils/notifikasi');
const pool = require('./config/db');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

if (process.env.TRUST_PROXY === '1') {
    app.set('trust proxy', 1);
}

// Middleware
app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Origin tidak diizinkan CORS'));
    },
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        return res.json({
            status: 'ok',
            database: 'ok',
            environment: process.env.NODE_ENV || 'development',
            uptime: Math.round(process.uptime()),
            time: new Date().toISOString()
        });
    } catch (err) {
        console.error('[Health Check]', err.message);
        return res.status(503).json({
            status: 'degraded',
            database: 'error',
            environment: process.env.NODE_ENV || 'development',
            time: new Date().toISOString()
        });
    }
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/booking', require('./routes/booking'));
app.use('/api/petugas', require('./routes/petugas'));
app.use('/api/admin', require('./routes/admin'));

// Serve pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/login.html')));
app.get('/user', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/user.html')));
app.get('/petugas', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/petugas.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/admin.html')));
app.get('/login-petugas', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/login-petugas.html')));

app.use((err, req, res, next) => {
    if (err.message === 'Origin tidak diizinkan CORS') {
        return res.status(403).json({ message: 'Origin tidak diizinkan' });
    }

    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ message: 'Ukuran file terlalu besar' });
    }

    if (err.message && err.message.startsWith('Format file')) {
        return res.status(400).json({ message: err.message });
    }

    console.error('[Server Error]', err);
    return res.status(err.status || 500).json({
        message: 'Server error',
        ...(isProduction ? {} : { error: err.message })
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
        console.warn('[Security] JWT_SECRET sebaiknya minimal 32 karakter untuk testing/production.');
    }
    if (isProduction && allowedOrigins.length === 0) {
        console.warn('[Security] CORS_ORIGINS belum diatur. Set domain resmi sebelum production.');
    }
    ensureNotificationSchema().catch(err => {
        console.error('Gagal menyiapkan schema notifikasi:', err.message);
    });
    verifyEmailTransport().catch(err => {
        console.error('Gagal memeriksa SMTP email:', err.message);
    });
});

