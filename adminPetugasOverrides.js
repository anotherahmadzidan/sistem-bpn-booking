const bcrypt = require('bcryptjs');
const pool = require('./dbPool');
const { serverError } = require('./utils/http');
const {
    requireIndonesianPhone,
    assertPhoneAvailable,
    acquirePhoneLock,
    releasePhoneLock,
    ensurePhoneSchema
} = require('./utils/phone');

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeNip = (value) => String(value || '').replace(/\s/g, '');
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value);
const isValidNip = (value) => /^\d{18}$/.test(value);

const validateIdentity = (req, res) => {
    const nip = normalizeNip(req.body.nip);
    const email = normalizeEmail(req.body.email);

    if (!isValidNip(nip)) {
        res.status(400).json({
            message: 'NIP harus terdiri dari tepat 18 digit angka.',
            code: 'INVALID_NIP'
        });
        return null;
    }
    if (!isValidEmail(email)) {
        res.status(400).json({
            message: 'Format email petugas tidak valid.',
            code: 'INVALID_EMAIL'
        });
        return null;
    }

    req.body.nip = nip;
    req.body.email = email;
    return { nip, email };
};

const wrapTambahPetugas = (original) => async (req, res) => {
    if (!validateIdentity(req, res)) return;
    return original(req, res);
};

const editPetugas = async (req, res) => {
    const { id } = req.params;
    const identity = validateIdentity(req, res);
    if (!identity) return;

    const nama_lengkap = String(req.body.nama_lengkap || '').trim();
    const password = String(req.body.password || '');
    if (!nama_lengkap || !req.body.no_hp) {
        return res.status(400).json({
            message: 'NIP, nama, email, dan nomor HP wajib diisi.'
        });
    }

    let no_hp;
    try {
        no_hp = requireIndonesianPhone(req.body.no_hp);
    } catch (err) {
        return res.status(err.status || 400).json({ message: err.message, code: err.code });
    }

    let connection;
    let phoneLockName = null;
    try {
        await ensurePhoneSchema();
        connection = await pool.getConnection();
        phoneLockName = await acquirePhoneLock(connection, no_hp);
        await connection.beginTransaction();

        const [petugasRows] = await connection.query(
            'SELECT id FROM petugas WHERE id = ? LIMIT 1',
            [id]
        );
        if (petugasRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Petugas tidak ditemukan.' });
        }

        const [identityOwner] = await connection.query(
            `SELECT id, nip, email
             FROM petugas
             WHERE (nip = ? OR LOWER(email) = ?)
               AND id <> ?
             LIMIT 1`,
            [identity.nip, identity.email, id]
        );
        if (identityOwner.length > 0) {
            await connection.rollback();
            const conflict = identityOwner[0].nip === identity.nip ? 'NIP' : 'Email';
            return res.status(409).json({
                message: `${conflict} sudah digunakan petugas lain.`
            });
        }

        await assertPhoneAvailable(connection, no_hp, { excludePetugasId: id });

        if (password) {
            const hash = await bcrypt.hash(password, 10);
            await connection.query(
                `UPDATE petugas
                 SET nip = ?, nama_lengkap = ?, email = ?, no_hp = ?,
                     password = ?, updated_at = NOW()
                 WHERE id = ?`,
                [identity.nip, nama_lengkap, identity.email, no_hp, hash, id]
            );
        } else {
            await connection.query(
                `UPDATE petugas
                 SET nip = ?, nama_lengkap = ?, email = ?, no_hp = ?,
                     updated_at = NOW()
                 WHERE id = ?`,
                [identity.nip, nama_lengkap, identity.email, no_hp, id]
            );
        }

        await connection.commit();
        return res.json({
            message: 'Data petugas berhasil diupdate',
            petugas: {
                id: Number(id),
                nip: identity.nip,
                nama_lengkap,
                email: identity.email,
                no_hp
            }
        });
    } catch (err) {
        if (connection) {
            try {
                await connection.rollback();
            } catch {}
        }
        if (err.status) {
            return res.status(err.status).json({ message: err.message, code: err.code });
        }
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                message: 'NIP, email, atau nomor HP sudah digunakan akun lain.',
                code: 'ACCOUNT_DATA_ALREADY_REGISTERED'
            });
        }
        return serverError(res, err);
    } finally {
        await releasePhoneLock(connection, phoneLockName);
        connection?.release();
    }
};

module.exports = {
    install(controller) {
        controller.tambahPetugas = wrapTambahPetugas(controller.tambahPetugas);
        controller.editPetugas = editPetugas;
        return controller;
    },
    normalizeEmail,
    normalizeNip,
    isValidEmail,
    isValidNip
};
