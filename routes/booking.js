const express = require('express');
const router = express.Router();
const verify = require('../middleware/auth');
const {
    createBooking,
    getMyBookings,
    rescheduleBooking,
    approvePetugasSchedule,
    cancelBooking,
    cekKuota
} = require('../controllers/bookingController');

router.post('/', verify('user'), createBooking);
router.get('/my', verify('user'), getMyBookings);
router.post('/reschedule/:id', verify('user'), rescheduleBooking);
router.post('/approve-petugas-schedule/:id', verify('user'), approvePetugasSchedule);
router.post('/cancel/:id', verify('user'), cancelBooking);
router.get('/kuota', verify('user'), cekKuota);

module.exports = router;
