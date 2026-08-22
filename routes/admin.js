const express = require('express');
const router = express.Router();
const verify = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimit');
const {
    getAllBookings,
    getAllPetugas,
    tambahPetugas,
    editPetugas,
    togglePetugas,
    getKuota,
    setKuota,
    hapusBerkas,
    getDetailBerkas
} = require('../controllers/adminController');
const { hapusPetugas } = require('./petugasDeletion');
const { errorTerakhir } = require('../utils/pemantauan');

router.get('/berkas/:id', verify('admin'), getDetailBerkas);
router.delete('/berkas/:id', writeLimiter, verify('admin'), hapusBerkas);
router.get('/bookings', verify('admin'), getAllBookings);
router.get('/petugas', verify('admin'), getAllPetugas);
router.post('/petugas', writeLimiter, verify('admin'), tambahPetugas);
router.put('/petugas/:id', writeLimiter, verify('admin'), editPetugas);
router.patch('/petugas/:id/toggle', writeLimiter, verify('admin'), togglePetugas);
router.delete('/petugas/:id', writeLimiter, verify('admin'), hapusPetugas);
router.get('/kuota', verify('admin'), getKuota);
router.post('/kuota', writeLimiter, verify('admin'), setKuota);

// Diagnostik: 20 error terakhir, untuk menelusuri gangguan tanpa perlu
// membuka berkas log di server.
router.get('/diagnostik/error', verify('admin'), (req, res) => {
    res.json({ error: errorTerakhir() });
});

module.exports = router;
