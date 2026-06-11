const jwt = require('jsonwebtoken');
require('dotenv').config();

const verifyToken = (role) => (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: 'Token tidak ditemukan' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const allowedRoles = Array.isArray(role) ? role : [role];
        if (role && !allowedRoles.includes(decoded.role)) {
            return res.status(403).json({ message: 'Akses ditolak' });
        }
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Token tidak valid' });
    }
};

module.exports = verifyToken;
