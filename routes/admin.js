const express = require('express');
const router = express.Router();
const verify = require('../middleware/auth');
const {
    getAllBookings,
    getAllPetugas,
    tambahPetugas,
    editPetugas,
    togglePetugas,
    getKuota,
    setKuota,
    getWilayah,
    hapusPetugas,
    hapusBerkas
} = require('../controllers/adminController');
const { getDetailBerkas } = require('../controllers/adminController');

router.get('/berkas/:id', verify('admin'), getDetailBerkas);
router.delete('/berkas/:id', verify('admin'), hapusBerkas);
router.get('/bookings', verify('admin'), getAllBookings);
router.get('/petugas', verify('admin'), getAllPetugas);
router.post('/petugas', verify('admin'), tambahPetugas);
router.put('/petugas/:id', verify('admin'), editPetugas);
router.patch('/petugas/:id/toggle', verify('admin'), togglePetugas);
router.delete('/petugas/:id', verify('admin'), hapusPetugas);
router.get('/kuota', verify('admin'), getKuota);
router.post('/kuota', verify('admin'), setKuota);
router.get('/wilayah', getWilayah);

module.exports = router;
