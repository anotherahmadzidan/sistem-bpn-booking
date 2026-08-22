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

    // Data terlalu panjang untuk kolomnya adalah kesalahan input, bukan
    // kesalahan server. Tanpa ini pengguna hanya melihat 500 tanpa penjelasan.
    if (code === 'ER_DATA_TOO_LONG' || code === 'WARN_DATA_TRUNCATED') {
        return {
            status: 400,
            code: 'INPUT_TOO_LONG',
            message: 'Ada isian yang terlalu panjang. Persingkat lalu coba lagi.'
        };
    }

    return {
        status: Number(err?.status) || 500,
        // Di production kode error internal database (mis. ER_BAD_FIELD_ERROR)
        // tidak dibocorkan ke klien karena membuka detail struktur tabel.
        code: isProduction() ? 'SERVER_ERROR' : (err?.code || 'SERVER_ERROR'),
        message: 'Server gagal memproses permintaan.'
    };
};

const serverError = (res, err, message = 'Server error') => {
    console.error('[Server Error]', err);
    // Dicatat ke berkas juga: keluaran konsol di hosting hilang saat restart,
    // sehingga kegagalan tengah malam tidak meninggalkan jejak apa pun.
    try {
        require('./pemantauan').catatError(err, { jenis: 'server' });
    } catch {}
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
