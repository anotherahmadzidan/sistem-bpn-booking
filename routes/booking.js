const express = require('express');
const router = express.Router();
const verify = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimit');
const {
    createBooking,
    getMyBookings,
    rescheduleBooking,
    approvePetugasSchedule,
    cancelBooking,
    cekKuota
} = require('../controllers/bookingController');

router.post('/', writeLimiter, verify('user'), createBooking);
router.get('/my', verify('user'), getMyBookings);
router.post('/reschedule/:id', writeLimiter, verify('user'), rescheduleBooking);
router.post('/approve-petugas-schedule/:id', writeLimiter, verify('user'), approvePetugasSchedule);
router.post('/cancel/:id', writeLimiter, verify('user'), cancelBooking);
router.get('/kuota', verify('user'), cekKuota);

module.exports = router;
