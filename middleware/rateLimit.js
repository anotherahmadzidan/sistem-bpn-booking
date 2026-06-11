const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
    windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    max: Number(process.env.AUTH_RATE_LIMIT_MAX || 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: 'Terlalu banyak percobaan. Silakan coba lagi beberapa menit lagi.'
    }
});

module.exports = { authLimiter };
