const isProduction = () => process.env.NODE_ENV === 'production';

const serverError = (res, err, message = 'Server error') => {
    console.error('[Server Error]', err);
    return res.status(500).json({
        message,
        ...(isProduction() ? {} : { error: err.message })
    });
};

module.exports = { serverError };
