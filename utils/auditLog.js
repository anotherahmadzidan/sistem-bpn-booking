const pool = require('../config/db');

/**
 * Catatan audit untuk tindakan penting.
 *
 * Hasil pemeriksaan tanah bisa berujung ke sengketa, sehingga sistem harus bisa
 * menjawab "siapa melakukan apa, kapan". Sebelumnya tidak ada catatan sama
 * sekali: status berkas berubah tanpa jejak pelakunya.
 *
 * Catatan ini baru bermakna setelah petugas memegang sandinya sendiri (lihat
 * utils/sandi.js). Selama sandi petugas diketahui admin, baris "petugas #7
 * menolak berkas" tidak membuktikan apa pun.
 *
 * Sifatnya HANYA-TAMBAH: tidak ada endpoint yang mengubah atau menghapus baris
 * di sini, dan kegagalan pencatatan tidak pernah menggagalkan aksi utamanya.
 */

let schemaPromise = null;

async function ensureAuditSchema() {
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS audit_log (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                aksi VARCHAR(50) NOT NULL,
                pelaku_peran VARCHAR(20) NULL,
                pelaku_id INT NULL,
                pelaku_nama VARCHAR(150) NULL,
                sasaran_jenis VARCHAR(30) NULL,
                sasaran_id INT NULL,
                keterangan VARCHAR(500) NULL,
                ip VARCHAR(45) NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_audit_waktu (created_at),
                KEY idx_audit_sasaran (sasaran_jenis, sasaran_id),
                KEY idx_audit_pelaku (pelaku_peran, pelaku_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    })().catch((err) => {
        schemaPromise = null;
        throw err;
    });

    return schemaPromise;
}

/**
 * Mencatat satu tindakan. Tidak pernah melempar error: sebuah aksi yang sudah
 * berhasil tidak boleh dibatalkan hanya karena pencatatannya gagal.
 *
 * @param {object} req  Dipakai mengambil pelaku (req.user) dan alamat IP.
 */
async function catatAudit(req, { aksi, sasaranJenis = null, sasaranId = null, keterangan = null }) {
    try {
        await ensureAuditSchema();
        const pelaku = (req && req.user) || {};
        await pool.query(
            `INSERT INTO audit_log
                (aksi, pelaku_peran, pelaku_id, pelaku_nama, sasaran_jenis, sasaran_id, keterangan, ip)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                String(aksi).slice(0, 50),
                pelaku.role || null,
                pelaku.id || null,
                pelaku.nama ? String(pelaku.nama).slice(0, 150) : null,
                sasaranJenis,
                sasaranId ? Number(sasaranId) : null,
                keterangan ? String(keterangan).slice(0, 500) : null,
                req && req.ip ? String(req.ip).slice(0, 45) : null
            ]
        );
    } catch (err) {
        console.error('[Audit] Gagal mencatat:', err.message);
    }
}

module.exports = { ensureAuditSchema, catatAudit };
