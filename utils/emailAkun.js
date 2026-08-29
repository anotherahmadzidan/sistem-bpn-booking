/**
 * Keunikan email LINTAS tabel akun.
 *
 * Setiap tabel akun (users, petugas, admin) sudah punya UNIQUE KEY pada
 * kolom email-nya sendiri. Yang tidak bisa dilakukan indeks adalah menjaga
 * agar email yang sama tidak muncul di DUA tabel berbeda: sebuah UNIQUE KEY
 * hanya berlaku dalam satu tabel.
 *
 * Akibatnya email yang sudah dipakai pemohon masih bisa dipasang ke akun
 * petugas. Dua akun berbeda lalu berbagi satu kotak surat - alamat itu
 * menerima OTP dan pemberitahuan pergantian sandi untuk kedua akun, dan
 * pemiliknya tidak punya cara membedakan yang mana. Karena itu pemeriksaannya
 * harus dilakukan di lapisan aplikasi, sama seperti nomor HP di utils/phone.js.
 *
 * Perbandingan memakai LOWER() agar data lama yang tersimpan dengan huruf
 * kapital berbeda tetap terdeteksi sebagai email yang sama.
 */

function emailError(message, code = 'EMAIL_ALREADY_REGISTERED', status = 409) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

/**
 * Melempar error bila email sudah dipakai akun lain di tabel mana pun.
 *
 * Parameter exclude* dipakai saat menyunting akun yang sudah ada, supaya
 * baris akun itu sendiri tidak dianggap sebagai bentrokan.
 */
async function assertEmailAvailable(
    connection,
    email,
    { excludeUserId = null, excludePetugasId = null, excludeAdminId = null } = {}
) {
    const target = normalizeEmail(email);

    const tables = [
        { table: 'users', exclude: excludeUserId, pesan: 'Email sudah digunakan akun pemohon.' },
        { table: 'petugas', exclude: excludePetugasId, pesan: 'Email sudah digunakan akun petugas lain.' },
        { table: 'admin', exclude: excludeAdminId, pesan: 'Email sudah digunakan akun admin.' }
    ];

    for (const { table, exclude, pesan } of tables) {
        const [rows] = await connection.query(
            `SELECT id
             FROM ${table}
             WHERE LOWER(email) = ?
               AND (? IS NULL OR id <> ?)
             LIMIT 1`,
            [target, exclude, exclude]
        );
        if (rows.length > 0) throw emailError(pesan);
    }
}

module.exports = { normalizeEmail, assertEmailAvailable };
