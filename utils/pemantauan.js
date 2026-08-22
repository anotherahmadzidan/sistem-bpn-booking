const fs = require('fs');
const path = require('path');

/**
 * Pemantauan error sederhana, tanpa layanan pihak ketiga.
 *
 * Sebelumnya seluruh kegagalan hanya dicetak ke konsol. Di hosting, keluaran
 * konsol biasanya hilang saat proses di-restart - artinya kalau ada yang rusak
 * tengah malam, tidak ada yang tahu sampai pengguna melapor, dan jejaknya sudah
 * hilang saat ditelusuri.
 *
 * Yang dilakukan di sini:
 *  - menulis error ke berkas harian di LOG_DIR (default: logs/)
 *  - menyimpan ringkasan di memori untuk dilihat lewat /api/health
 *  - menangkap error yang tidak tertangani agar proses tidak mati diam-diam
 *
 * Sengaja tanpa dependensi baru. Bila nanti dipasang layanan seperti Sentry,
 * cukup tambahkan pengirimannya di catatError().
 */

const LOG_DIR = process.env.LOG_DIR
    ? path.resolve(process.env.LOG_DIR)
    : path.join(__dirname, '..', 'logs');

const SIMPAN_TERAKHIR = 20;
const terakhir = [];
let totalError = 0;

function berkasHariIni() {
    const hari = new Date().toISOString().slice(0, 10);
    return path.join(LOG_DIR, `error-${hari}.log`);
}

function catatError(err, konteks = {}) {
    totalError += 1;

    const entri = {
        waktu: new Date().toISOString(),
        pesan: err && err.message ? err.message : String(err),
        kode: (err && err.code) || null,
        ...konteks
    };

    terakhir.unshift(entri);
    if (terakhir.length > SIMPAN_TERAKHIR) terakhir.pop();

    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        const baris = JSON.stringify({
            ...entri,
            stack: err && err.stack ? String(err.stack).split('\n').slice(0, 6).join(' | ') : null
        });
        fs.appendFileSync(berkasHariIni(), baris + '\n', 'utf8');
    } catch (tulisErr) {
        // Kegagalan menulis log tidak boleh menjatuhkan proses.
        console.error('[Pemantauan] Gagal menulis log:', tulisErr.message);
    }
}

/** Ringkasan untuk endpoint /api/health. */
function ringkasan() {
    return {
        total_error: totalError,
        error_terakhir: terakhir[0] ? terakhir[0].waktu : null
    };
}

/** Daftar error terakhir; dipakai endpoint diagnostik khusus admin. */
function errorTerakhir() {
    return terakhir.slice();
}

/**
 * Menangkap kegagalan yang lolos dari seluruh try/catch. Tanpa ini, sebuah
 * promise yang ditolak bisa menjatuhkan proses tanpa meninggalkan jejak.
 */
function pasangPenangkapGlobal() {
    process.on('unhandledRejection', (alasan) => {
        console.error('[Pemantauan] Promise ditolak tanpa penanganan:', alasan);
        catatError(alasan instanceof Error ? alasan : new Error(String(alasan)), {
            jenis: 'unhandledRejection'
        });
    });

    process.on('uncaughtException', (err) => {
        console.error('[Pemantauan] Error tidak tertangani:', err);
        catatError(err, { jenis: 'uncaughtException' });
        // Proses sengaja dibiarkan berhenti: melanjutkan setelah error yang
        // tidak tertangani berisiko meninggalkan status yang tidak konsisten.
        // Pengelola proses di server yang bertugas menyalakannya kembali.
        process.exit(1);
    });
}

module.exports = { LOG_DIR, catatError, ringkasan, errorTerakhir, pasangPenangkapGlobal };
