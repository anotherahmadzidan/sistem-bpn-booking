const pool = require('../config/db');

const QUOTA_TYPES = {
    kecamatan: {
        label: 'kecamatan',
        table: 'kuota_kecamatan',
        column: 'kecamatan_id',
        nameTable: 'kecamatan',
        nameColumn: 'nama_kecamatan',
        supportsUnlimited: true,
        uniqueKey: 'uniq_kuota_kecamatan_tanggal'
    },
    kelurahan: {
        label: 'kelurahan',
        table: 'kuota_kelurahan',
        column: 'kelurahan_id',
        nameTable: 'kelurahan',
        nameColumn: 'nama_kelurahan',
        supportsUnlimited: true,
        uniqueKey: 'uniq_kuota_kelurahan_tanggal'
    },
    petugas: {
        label: 'petugas',
        table: 'kuota_petugas',
        column: 'petugas_id',
        nameTable: 'petugas',
        nameColumn: 'nama_lengkap',
        supportsUnlimited: false,
        uniqueKey: 'uniq_kuota_petugas_tanggal'
    }
};

let quotaSchemaPromise = null;

const isDateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

const dateRange = (start, end) => {
    const dates = [];
    const cursor = new Date(`${start}T00:00:00Z`);
    const last = new Date(`${end}T00:00:00Z`);

    while (cursor <= last) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return dates;
};

const newSetOrder = () => Date.now();

const normalizeQuotaMax = (value, isUnlimited = false) => {
    if (isUnlimited) return 0;

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('Kuota maksimal wajib lebih dari 0');
    }
    return parsed;
};

const getQuotaType = (tipe) => {
    const config = QUOTA_TYPES[tipe];
    if (!config) {
        throw new Error('Tipe kuota tidak valid');
    }
    return config;
};

async function indexExists(table, keyName) {
    const [rows] = await pool.query(
        `SHOW INDEX FROM ${table} WHERE Key_name = ?`,
        [keyName]
    );
    return rows.length > 0;
}

async function columnExists(table, column) {
    const [rows] = await pool.query(
        `SHOW COLUMNS FROM ${table} LIKE ?`,
        [column]
    );
    return rows.length > 0;
}

async function dedupeQuotaTable({ table, column }) {
    await pool.query(`
        UPDATE ${table} q
        JOIN (
            SELECT * FROM (
                SELECT ${column} AS target_id, tanggal, MAX(id) AS keep_id, MAX(terisi) AS max_terisi
                FROM ${table}
                GROUP BY ${column}, tanggal
                HAVING COUNT(*) > 1
            ) d0
        ) d ON q.id = d.keep_id
        SET q.terisi = GREATEST(q.terisi, d.max_terisi)
    `);

    await pool.query(`
        DELETE q FROM ${table} q
        JOIN (
            SELECT * FROM (
                SELECT ${column} AS target_id, tanggal, MAX(id) AS keep_id
                FROM ${table}
                GROUP BY ${column}, tanggal
                HAVING COUNT(*) > 1
            ) d0
        ) d ON q.${column} = d.target_id AND q.tanggal = d.tanggal
        WHERE q.id <> d.keep_id
    `);
}

async function ensureSetOrderColumn(table) {
    if (!(await columnExists(table, 'set_order'))) {
        await pool.query(
            `ALTER TABLE ${table} ADD COLUMN set_order BIGINT NOT NULL DEFAULT 0`
        );
    }

    const hasUpdatedAt = await columnExists(table, 'updated_at');
    const hasCreatedAt = await columnExists(table, 'created_at');
    if (!hasUpdatedAt && !hasCreatedAt) {
        await pool.query(
            `UPDATE ${table}
             SET set_order = 1
             WHERE set_order = 0`
        );
        return;
    }

    const fallbackExpression = hasUpdatedAt && hasCreatedAt
        ? 'COALESCE(updated_at, created_at, NOW())'
        : hasUpdatedAt
            ? 'COALESCE(updated_at, NOW())'
            : 'COALESCE(created_at, NOW())';

    await pool.query(
        `UPDATE ${table}
         SET set_order = UNIX_TIMESTAMP(${fallbackExpression}) * 1000
         WHERE set_order = 0`
    );
}

async function ensureQuotaSchema() {
    if (quotaSchemaPromise) return quotaSchemaPromise;

    quotaSchemaPromise = (async () => {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS kuota_default (
                id INT NOT NULL AUTO_INCREMENT,
                tipe ENUM('kecamatan','kelurahan','petugas') NOT NULL,
                target_id INT NOT NULL,
                kuota_max INT NOT NULL DEFAULT 10,
                is_unlimited TINYINT(1) NOT NULL DEFAULT 0,
                set_order BIGINT NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uniq_kuota_default_target (tipe, target_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await ensureSetOrderColumn('kuota_default');

        for (const config of Object.values(QUOTA_TYPES)) {
            await dedupeQuotaTable(config);
            if (!(await columnExists(config.table, 'source'))) {
                await pool.query(
                    `ALTER TABLE ${config.table} ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'tanggal'`
                );
            }
            await ensureSetOrderColumn(config.table);
            if (!(await indexExists(config.table, config.uniqueKey))) {
                await pool.query(
                    `ALTER TABLE ${config.table} ADD UNIQUE KEY ${config.uniqueKey} (${config.column}, tanggal)`
                );
            }
        }
    })().catch(err => {
        quotaSchemaPromise = null;
        throw err;
    });

    return quotaSchemaPromise;
}

async function getDefaultQuota(tipe, id) {
    const [rows] = await pool.query(
        `SELECT kuota_max, is_unlimited, set_order
         FROM kuota_default
         WHERE tipe = ? AND target_id = ?`,
        [tipe, id]
    );
    return rows[0] || null;
}

function pickEffectiveQuota({ dateQuota, defaultQuota, supportsUnlimited }) {
    if (!dateQuota && !defaultQuota) {
        return {
            kuota_max: 0,
            terisi: 0,
            is_unlimited: 1,
            set_order: 0,
            configured: true
        };
    }

    const dateOrder = Number(dateQuota?.set_order || 0);
    const defaultOrder = Number(defaultQuota?.set_order || 0);
    const defaultWins = defaultQuota && (!dateQuota || defaultOrder >= dateOrder);
    const active = defaultWins ? defaultQuota : dateQuota;

    return {
        kuota_max: active.kuota_max,
        terisi: Number(dateQuota?.terisi || 0),
        is_unlimited: supportsUnlimited && active.is_unlimited ? 1 : 0,
        set_order: active.set_order,
        configured: true
    };
}

async function getEffectiveKuota({ tipe, id, tanggal }) {
    await ensureQuotaSchema();
    const config = getQuotaType(tipe);
    const fields = config.supportsUnlimited
        ? 'kuota_max, terisi, is_unlimited, set_order'
        : 'kuota_max, terisi, 0 AS is_unlimited, set_order';

    const [rows] = await pool.query(
        `SELECT ${fields}
         FROM ${config.table}
         WHERE ${config.column} = ? AND tanggal = ?`,
        [id, tanggal]
    );

    const dateQuota = rows[0] || null;
    const defaultQuota = await getDefaultQuota(tipe, id);
    const kuota = pickEffectiveQuota({
        dateQuota,
        defaultQuota,
        supportsUnlimited: config.supportsUnlimited
    });

    if (!kuota) {
        return {
            tersedia: true,
            sisa: null,
            configured: true
        };
    }

    if (kuota.is_unlimited) {
        return { tersedia: true, sisa: null, configured: true };
    }

    const sisa = kuota.kuota_max - kuota.terisi;
    return { tersedia: sisa > 0, sisa, configured: true };
}

const ensureAndLockKuota = async (conn, { tipe, table, column, id, tanggal, supportsUnlimited }) => {
    const fields = supportsUnlimited
        ? 'kuota_max, terisi, is_unlimited, set_order'
        : 'kuota_max, terisi, 0 AS is_unlimited, set_order';

    let [rows] = await conn.query(
        `SELECT ${fields} FROM ${table}
         WHERE ${column} = ? AND tanggal = ? FOR UPDATE`,
        [id, tanggal]
    );

    const dateQuota = rows[0] || null;

    const [defaults] = await conn.query(
        `SELECT kuota_max, is_unlimited, set_order
         FROM kuota_default
         WHERE tipe = ? AND target_id = ? FOR UPDATE`,
        [tipe, id]
    );
    const defaultQuota = defaults[0];
    const effective = pickEffectiveQuota({
        dateQuota,
        defaultQuota,
        supportsUnlimited
    });
    if (!effective) return null;

    const defaultWins = defaultQuota
        && (!dateQuota || Number(defaultQuota.set_order || 0) >= Number(dateQuota.set_order || 0));

    if (!defaultWins) return effective;

    const isUnlimited = supportsUnlimited && defaultQuota.is_unlimited ? 1 : 0;
    const columnList = supportsUnlimited
        ? `${column}, tanggal, kuota_max, terisi, is_unlimited, source, set_order`
        : `${column}, tanggal, kuota_max, terisi, source, set_order`;
    const placeholders = supportsUnlimited ? '?, ?, ?, 0, ?, ?, ?' : '?, ?, ?, 0, ?, ?';
    const values = supportsUnlimited
        ? [id, tanggal, defaultQuota.kuota_max, isUnlimited, 'setiap_hari', defaultQuota.set_order]
        : [id, tanggal, defaultQuota.kuota_max, 'setiap_hari', defaultQuota.set_order];

    await conn.query(
        `INSERT INTO ${table} (${columnList})
         VALUES (${placeholders})
         ON DUPLICATE KEY UPDATE
            kuota_max = VALUES(kuota_max),
            ${supportsUnlimited ? 'is_unlimited = VALUES(is_unlimited),' : ''}
            source = VALUES(source),
            set_order = VALUES(set_order)`,
        values
    );

    [rows] = await conn.query(
        `SELECT ${fields} FROM ${table}
         WHERE ${column} = ? AND tanggal = ? FOR UPDATE`,
        [id, tanggal]
    );

    return rows[0] || null;
};

const reserveKuotaAktif = async (conn, booking, tanggal) => {
    await ensureQuotaSchema();

    const targets = [
        { tipe: 'kecamatan', ...QUOTA_TYPES.kecamatan, id: booking.kecamatan_id },
        { tipe: 'kelurahan', ...QUOTA_TYPES.kelurahan, id: booking.kelurahan_id },
        { tipe: 'petugas', ...QUOTA_TYPES.petugas, id: booking.petugas_id }
    ];

    const lockedRows = [];
    for (const target of targets) {
        const kuota = await ensureAndLockKuota(conn, { ...target, tanggal });
        if (!kuota) {
            return {
                ok: false,
                message: `Kuota ${target.label} tidak tersedia`
            };
        }
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
    await ensureQuotaSchema();
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

async function setKuotaHarian({ tipe, id, kuota_max, is_unlimited }) {
    await ensureQuotaSchema();
    const config = getQuotaType(tipe);
    const unlimited = config.supportsUnlimited && is_unlimited ? 1 : 0;
    const max = normalizeQuotaMax(kuota_max, Boolean(unlimited));
    const setOrder = newSetOrder();

    await pool.query(
        `INSERT INTO kuota_default (tipe, target_id, kuota_max, is_unlimited, set_order)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            kuota_max = VALUES(kuota_max),
            is_unlimited = VALUES(is_unlimited),
            set_order = VALUES(set_order),
            updated_at = NOW()`,
        [tipe, id, max, unlimited, setOrder]
    );

    if (config.supportsUnlimited) {
        await pool.query(
            `UPDATE ${config.table}
             SET kuota_max = ?, is_unlimited = ?, set_order = ?
             WHERE ${config.column} = ? AND source = 'setiap_hari'`,
            [max, unlimited, setOrder, id]
        );
        return;
    }

    await pool.query(
        `UPDATE ${config.table}
         SET kuota_max = ?, set_order = ?
         WHERE ${config.column} = ? AND source = 'setiap_hari'`,
        [max, setOrder, id]
    );
}

async function setKuotaTanggal({ tipe, id, tanggal, kuota_max, is_unlimited, set_order, conn = pool }) {
    const config = getQuotaType(tipe);
    const unlimited = config.supportsUnlimited && is_unlimited ? 1 : 0;
    const max = normalizeQuotaMax(kuota_max, Boolean(unlimited));
    const setOrder = set_order || newSetOrder();

    if (config.supportsUnlimited) {
        await conn.query(
            `INSERT INTO ${config.table} (${config.column}, tanggal, kuota_max, terisi, is_unlimited, source, set_order)
             VALUES (?, ?, ?, 0, ?, 'tanggal', ?)
             ON DUPLICATE KEY UPDATE
                kuota_max = VALUES(kuota_max),
                is_unlimited = VALUES(is_unlimited),
                source = 'tanggal',
                set_order = VALUES(set_order)`,
            [id, tanggal, max, unlimited, setOrder]
        );
        return;
    }

    await conn.query(
        `INSERT INTO ${config.table} (${config.column}, tanggal, kuota_max, terisi, source, set_order)
         VALUES (?, ?, ?, 0, 'tanggal', ?)
         ON DUPLICATE KEY UPDATE
            kuota_max = VALUES(kuota_max),
            source = 'tanggal',
            set_order = VALUES(set_order)`,
        [id, tanggal, max, setOrder]
    );
}

async function setKuotaRentang({ tipe, id, tanggal_mulai, tanggal_selesai, kuota_max, is_unlimited }) {
    await ensureQuotaSchema();
    if (!isDateOnly(tanggal_mulai) || !isDateOnly(tanggal_selesai)) {
        throw new Error('Format tanggal tidak valid');
    }
    if (tanggal_selesai < tanggal_mulai) {
        throw new Error('Tanggal selesai tidak boleh sebelum tanggal mulai');
    }

    const dates = dateRange(tanggal_mulai, tanggal_selesai);
    if (dates.length > 366) {
        throw new Error('Rentang tanggal maksimal 366 hari');
    }
    const setOrder = newSetOrder();

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        for (const tanggal of dates) {
            await setKuotaTanggal({ tipe, id, tanggal, kuota_max, is_unlimited, set_order: setOrder, conn });
        }
        await conn.commit();
        return dates.length;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = {
    QUOTA_TYPES,
    ensureQuotaSchema,
    getEffectiveKuota,
    reserveKuotaAktif,
    kurangiKuotaAktif,
    setKuotaHarian,
    setKuotaRentang,
    isDateOnly
};
