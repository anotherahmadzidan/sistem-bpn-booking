const isProduction = () => process.env.NODE_ENV === 'production';

const classifyServerError = (err) => {
    const code = String(err?.code || '').toUpperCase();
    const message = String(err?.message || '').toLowerCase();

    if (
        code === 'PROTOCOL_SEQUENCE_TIMEOUT'
        || code === 'ETIMEDOUT'
        || message.includes('query inactivity timeout')
        || message.includes('query timeout')
    ) {
        return {
            status: 504,
            code: 'DATABASE_TIMEOUT',
            message: 'Database membutuhkan waktu terlalu lama. Silakan coba lagi.'
        };
    }

    if (
        [
            'ECONNRESET',
            'ECONNREFUSED',
            'EAI_AGAIN',
            'ENOTFOUND',
            'PROTOCOL_CONNECTION_LOST',
            'ER_CON_COUNT_ERROR',
            'ER_USER_LIMIT_REACHED'
        ].includes(code)
        || message.includes('max_user_connections')
        || message.includes('too many connections')
    ) {
        return {
            status: 503,
            code: 'DATABASE_UNAVAILABLE',
            message: 'Database sedang sibuk atau tidak dapat dijangkau. Silakan coba lagi.'
        };
    }

    return {
        status: Number(err?.status) || 500,
        code: err?.code || 'SERVER_ERROR',
        message: 'Server gagal memproses permintaan.'
    };
};

const serverError = (res, err, message = 'Server error') => {
    console.error('[Server Error]', err);
    if (res.headersSent) return;

    const classified = classifyServerError(err);
    const responseMessage = message === 'Server error' ? classified.message : message;
    return res.status(classified.status).json({
        message: responseMessage,
        code: classified.code,
        ...(isProduction() ? {} : { error: err.message })
    });
};

module.exports = { serverError, classifyServerError };
