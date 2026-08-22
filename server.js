const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();
const { ensureNotificationSchema, verifyEmailTransport } = require('./utils/notifikasi');
const { ensureQuotaSchema } = require('./utils/kuota');
const { ensureOtpSchema } = require('./utils/otp');
const { ensurePhoneSchema } = require('./utils/phone');
const { ensureSandiSchema } = require('./utils/sandi');
const {
    ensurePetugasReminderSchema,
    startPetugasReminderScheduler
} = require('./utils/petugasReminder');
const pool = require('./config/db');
const { serverError } = require('./utils/http');

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
//
// CATATAN CSP
//
// Kedua jalur eksekusi skrip kini tertutup:
//
// - script-src tanpa 'unsafe-inline': seluruh JavaScript halaman berada di
//   berkas terpisah, sehingga blok <script> yang disuntikkan dan URL
//   javascript: diblokir browser.
// - script-src-attr 'none': halaman tidak lagi memakai atribut onclick=,
//   melainkan atribut data-* yang dihubungkan public/js/common.js. Atribut
//   event yang berhasil disuntikkan (mis. onerror=) tidak akan dieksekusi.
//
// Dengan begitu CSP menjadi pertahanan lapis kedua yang sesungguhnya, bukan
// sekadar pembatas tujuan pengiriman data. Lapis pertama tetap escapeHTML()
// di sisi render, dijaga scripts/test-xss-escaping.js.
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", 'https://unpkg.com'],
            scriptSrcAttr: ["'none'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
            imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://unpkg.com'],
            connectSrc: ["'self'", 'https://nominatim.openstreetmap.org'],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            upgradeInsecureRequests: isProduction ? [] : null
        }
    },
    crossOriginEmbedderPolicy: false
}));
app.use(cors({
    origin: (origin, callback) => {
        // Same-origin / non-browser (tanpa header Origin) selalu diizinkan.
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        // Daftar kosong: izinkan semua origin HANYA di non-production (kemudahan dev).
        // Di production, daftar kosong berarti hanya same-origin yang lolos.
        if (allowedOrigins.length === 0 && !isProduction) return callback(null, true);
        return callback(new Error('Origin tidak diizinkan CORS'));
    },
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
// Sajikan folder upload dari lokasi persisten (env UPLOAD_DIR). Default-nya
// tetap public/uploads sehingga aman di lokal, tapi di produksi bisa diarahkan
// ke folder di luar direktori deploy agar foto tidak hilang saat redeploy.
app.use('/uploads', express.static(require('./config/uploadDir')));

const configuredSlowRequestMs = Number(process.env.SLOW_REQUEST_MS);
const slowRequestMs = Number.isFinite(configuredSlowRequestMs) && configuredSlowRequestMs > 0
    ? configuredSlowRequestMs
    : 5000;
app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
        const elapsed = Date.now() - startedAt;
        if (req.path.startsWith('/api/') && elapsed >= slowRequestMs) {
            console.warn(`[Slow API] ${req.method} ${req.originalUrl} ${res.statusCode} - ${elapsed}ms`);
        }
    });
    next();
});

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

// Jaring pengaman untuk seluruh /api. Limiter yang lebih ketat tetap dipasang
// per router (authLimiter, writeLimiter).
app.use('/api', require('./middleware/rateLimit').apiLimiter);

// Sesi kini memakai cookie, yang dikirim browser secara otomatis. Pemeriksaan
// token CSRF wajib ada agar situs lain tidak bisa memicu aksi atas nama
// pengguna yang sedang login.
app.use('/api', require('./middleware/csrf').verifyCsrf);

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

    return serverError(res, err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    const serviceUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    console.log(`Server berjalan di ${serviceUrl}`);
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
        console.warn('[Security] JWT_SECRET sebaiknya minimal 32 karakter untuk testing/production.');
    }
    if (isProduction && allowedOrigins.length === 0) {
        console.warn('[Security] CORS_ORIGINS belum diatur. Set domain resmi sebelum production.');
    }
    if (isProduction && process.env.TRUST_PROXY !== '1') {
        console.warn(
            '[Security] TRUST_PROXY belum diaktifkan. Di belakang reverse proxy, rate limit '
            + 'akan membaca IP proxy untuk semua pengguna sehingga satu orang bisa mengunci '
            + 'seluruh pengguna lain. Set TRUST_PROXY=1 bila aplikasi berada di balik proxy.'
        );
    }
    if (!process.env.JWT_EXPIRES_IN) {
        console.warn('[Security] JWT_EXPIRES_IN belum diatur, memakai default 1d.');
    }
    ensureNotificationSchema().catch(err => {
        console.error('Gagal menyiapkan schema notifikasi:', err.message);
    });
    ensureQuotaSchema().catch(err => {
        console.error('Gagal menyiapkan schema kuota:', err.message);
    });
    ensureOtpSchema().catch(err => {
        console.error('Gagal menyiapkan schema OTP:', err.message);
    });
    ensureSandiSchema().catch(err => {
        console.error('Gagal menyiapkan schema sandi:', err.message);
    });
    ensurePhoneSchema().then(report => {
        if (report.invalid.length > 0) {
            console.warn(
                `[Phone Migration] ${report.invalid.length} nomor lama tidak valid dan perlu dikoreksi manual.`
            );
        }
    }).catch(err => {
        console.error('Gagal menyiapkan schema nomor HP:', err.message);
    });
    ensurePetugasReminderSchema()
        .catch(err => {
            console.error('Gagal menyiapkan reminder petugas:', err.message);
        })
        .finally(() => startPetugasReminderScheduler());
    verifyEmailTransport().catch(err => {
        console.error('Gagal memeriksa SMTP email:', err.message);
    });
});

