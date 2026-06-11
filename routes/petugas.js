const express = require('express');
const router = express.Router();
const verify = require('../middleware/auth');
const { getTugas, konfirmasiJadwal, tolakJadwal, inputHasil, tolakBerkas } = require('../controllers/petugasController');

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const allowedImageExts = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, unique + path.extname(file.originalname).toLowerCase());
    }
});
const upload = multer({
    storage,
    limits: {
        fileSize: Number(process.env.UPLOAD_MAX_BYTES || 3 * 1024 * 1024),
        files: 2
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedImageTypes.has(file.mimetype) && allowedImageExts.has(ext)) {
            return cb(null, true);
        }
        return cb(new Error('Format file tidak didukung. Upload hanya JPG, PNG, atau WEBP.'));
    }
});

router.get('/tugas', verify('petugas'), getTugas);
router.post('/konfirmasi/:id', verify('petugas'), konfirmasiJadwal);
router.post('/tolak/:id', verify('petugas'), tolakJadwal);
router.post('/tolak-berkas/:id', verify('petugas'), tolakBerkas);
router.post('/hasil/:id', verify('petugas'),
    upload.fields([{ name: 'foto_lokasi', maxCount: 1 }, { name: 'foto_risalah', maxCount: 1 }]),
    inputHasil
);

module.exports = router;
