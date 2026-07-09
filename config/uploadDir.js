const path = require('path');
const fs = require('fs');

// Lokasi penyimpanan file upload (foto lokasi & risalah).
//
// PENTING (produksi/Hostinger): default `public/uploads` berada DI DALAM
// direktori aplikasi yang ikut disegarkan setiap kali deploy dari GitHub,
// sehingga file yang di-upload petugas bisa TERHAPUS saat redeploy.
// Set env UPLOAD_DIR ke folder persisten DI LUAR direktori deploy
// (mis. /home/uXXXX/uploads) agar foto tidak hilang.
const uploadDir = process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(__dirname, '..', 'public', 'uploads');

fs.mkdirSync(uploadDir, { recursive: true });

module.exports = uploadDir;
