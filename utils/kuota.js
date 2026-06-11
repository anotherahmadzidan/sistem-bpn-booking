const DEFAULT_KUOTA = 10;

const ensureAndLockKuota = async (conn, { table, column, id, tanggal, supportsUnlimited }) => {
    await conn.query(
        `INSERT INTO ${table} (${column}, tanggal, kuota_max, terisi)
         VALUES (?, ?, ?, 0)
         ON DUPLICATE KEY UPDATE kuota_max = kuota_max`,
        [id, tanggal, DEFAULT_KUOTA]
    );

    const fields = supportsUnlimited
        ? 'kuota_max, terisi, is_unlimited'
        : 'kuota_max, terisi, 0 AS is_unlimited';

    const [rows] = await conn.query(
        `SELECT ${fields} FROM ${table}
         WHERE ${column} = ? AND tanggal = ? FOR UPDATE`,
        [id, tanggal]
    );

    return rows[0];
};

const reserveKuotaAktif = async (conn, booking, tanggal) => {
    const targets = [
        {
            label: 'kecamatan',
            table: 'kuota_kecamatan',
            column: 'kecamatan_id',
            id: booking.kecamatan_id,
            supportsUnlimited: true
        },
        {
            label: 'kelurahan',
            table: 'kuota_kelurahan',
            column: 'kelurahan_id',
            id: booking.kelurahan_id,
            supportsUnlimited: true
        },
        {
            label: 'petugas',
            table: 'kuota_petugas',
            column: 'petugas_id',
            id: booking.petugas_id,
            supportsUnlimited: false
        }
    ];

    const lockedRows = [];
    for (const target of targets) {
        const kuota = await ensureAndLockKuota(conn, { ...target, tanggal });
        if (!kuota.is_unlimited && kuota.terisi >= kuota.kuota_max) {
            return {
                ok: false,
                message: `Kuota ${target.label} pada tanggal ini sudah penuh`
            };
        }
        lockedRows.push(target);
    }

    for (const target of lockedRows) {
        await conn.query(
            `UPDATE ${target.table} SET terisi = terisi + 1
             WHERE ${target.column} = ? AND tanggal = ?`,
            [target.id, tanggal]
        );
    }

    return { ok: true };
};

const kurangiKuotaAktif = async (conn, booking) => {
    await conn.query(
        'UPDATE kuota_kecamatan SET terisi = GREATEST(terisi - 1, 0) WHERE kecamatan_id = ? AND tanggal = ?',
        [booking.kecamatan_id, booking.tanggal_diminta]
    );
    await conn.query(
        'UPDATE kuota_kelurahan SET terisi = GREATEST(terisi - 1, 0) WHERE kelurahan_id = ? AND tanggal = ?',
        [booking.kelurahan_id, booking.tanggal_diminta]
    );
    await conn.query(
        'UPDATE kuota_petugas SET terisi = GREATEST(terisi - 1, 0) WHERE petugas_id = ? AND tanggal = ?',
        [booking.petugas_id, booking.tanggal_diminta]
    );
};

module.exports = { reserveKuotaAktif, kurangiKuotaAktif };
