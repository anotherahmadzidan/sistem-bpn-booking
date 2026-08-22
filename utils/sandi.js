const pool = require('../config/db');

/**
 * Skema pendukung fitur ganti & lupa sandi.
 *
 * password_changed_at adalah inti pembatalan sesi. JWT bersifat stateless -
 * tanpa penanda ini, mengganti sandi karena curiga akun dibajak TIDAK memutus
 * token yang sudah dipegang penyerang. Middleware membandingkannya dengan
 * klaim `iat` pada token; kolom ini ikut dibaca pada query yang memang sudah
 * berjalan di sana, jadi tidak menambah query baru.
 *
 * harus_ganti_sandi mengubah sandi buatan admin menjadi tiket sekali pakai:
 * petugas wajib menggantinya saat login pertama, sehingga setelah itu admin
 * tidak lagi mengetahui sandi yang berlaku.
 */

const TABEL_AKUN = {
    user: 'users',
    petugas: 'petugas',
    admin: 'admin'
};

let schemaPromise = null;

async function kolomAda(tabel, kolom) {
    const [rows] = await pool.query(`SHOW COLUMNS FROM \`${tabel}\` LIKE ?`, [kolom]);
    return rows.length > 0;
}

async function ensureSandiSchema() {
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
        for (const tabel of Object.values(TABEL_AKUN)) {
            if (!(await kolomAda(tabel, 'password_changed_at'))) {
                await pool.query(
                    `ALTER TABLE \`${tabel}\` ADD COLUMN password_changed_at DATETIME NULL`
                );
            }
        }

        if (!(await kolomAda('petugas', 'harus_ganti_sandi'))) {
            await pool.query(
                'ALTER TABLE petugas ADD COLUMN harus_ganti_sandi TINYINT(1) NOT NULL DEFAULT 0'
            );
            // Akun petugas yang sudah ada sandinya dibuatkan admin, jadi
            // semuanya wajib mengganti pada login berikutnya.
            await pool.query('UPDATE petugas SET harus_ganti_sandi = 1');
        }

        if (!(await kolomAda('otp_tokens', 'petugas_id'))) {
            await pool.query(
                'ALTER TABLE otp_tokens ADD COLUMN petugas_id INT NULL AFTER user_id'
            );
            await pool.query(
                'CREATE INDEX idx_otp_petugas ON otp_tokens (petugas_id, purpose, created_at)'
            );
        }
    })().catch((err) => {
        schemaPromise = null;
        throw err;
    });

    return schemaPromise;
}

module.exports = { TABEL_AKUN, ensureSandiSchema };
