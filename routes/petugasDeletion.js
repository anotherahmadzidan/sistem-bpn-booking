const pool = require('../config/db');
const { serverError } = require('../utils/http');
const { invalidateAccountStatus } = require('../middleware/auth');

const hapusPetugas = async (req, res) => {
    const { id } = req.params;

    try {
        // Riwayat booking tetap membutuhkan relasi petugas untuk audit dan pelaporan.
        const [bookingCounts] = await pool.query(
            `SELECT
                COUNT(*) AS total,
                COALESCE(SUM(
                    status NOT IN ('selesai', 'ditolak', 'dibatalkan')
                ), 0) AS aktif
             FROM bookings
             WHERE petugas_id = ?`,
            [id]
        );

        const totalBookings = Number(bookingCounts[0]?.total || 0);
        const activeBookings = Number(bookingCounts[0]?.aktif || 0);

        if (totalBookings > 0) {
            const detail = activeBookings > 0
                ? `${activeBookings} berkas aktif dan ${totalBookings - activeBookings} berkas riwayat`
                : `${totalBookings} berkas riwayat`;

            return res.status(409).json({
                code: 'PETUGAS_HAS_BOOKINGS',
                message: `Petugas tidak dapat dihapus karena masih terkait dengan ${detail}. Nonaktifkan akun petugas untuk mempertahankan riwayat berkas.`
            });
        }

        const [result] = await pool.query('DELETE FROM petugas WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({
                code: 'PETUGAS_NOT_FOUND',
                message: 'Petugas tidak ditemukan.'
            });
        }

        // Token petugas yang sudah dihapus harus langsung berhenti berlaku.
        invalidateAccountStatus('petugas', id);
        return res.json({ message: 'Petugas berhasil dihapus' });
    } catch (err) {
        if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1451) {
            return res.status(409).json({
                code: 'PETUGAS_HAS_RELATED_DATA',
                message: 'Petugas tidak dapat dihapus karena masih memiliki data terkait. Nonaktifkan akun petugas agar riwayat sistem tetap tersimpan.'
            });
        }

        return serverError(res, err);
    }
};

module.exports = { hapusPetugas };
