const pool = require('../config/db');
const { kirimEmail } = require('./notifikasi');

const WITA_TIME_ZONE = 'Asia/Makassar';

const positiveNumber = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
};

const escapeHTML = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const isEnabled = () => {
    const configured = String(process.env.PETUGAS_REMINDER_ENABLED || '').trim().toLowerCase();
    if (configured) return ['1', 'true', 'yes'].includes(configured);
    return process.env.NODE_ENV === 'production';
};

const datePartsInWita = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: WITA_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));

    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
        hour: Number(values.hour)
    };
};

const dateKey = ({ year, month, day }) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const addDays = (parts, amount) => {
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount, 12));
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate()
    };
};

const getReminderWindow = (date = new Date()) => {
    const today = datePartsInWita(date);
    return {
        hour: today.hour,
        today: dateKey(today),
        tomorrow: dateKey(addDays(today, 1))
    };
};

const reminderTypeForDate = (scheduledDate, window) => {
    if (scheduledDate === window.today) return 'hari_h';
    if (scheduledDate === window.tomorrow) return 'h_minus_1';
    return null;
};

const formatIndonesianDate = (value) => {
    const [year, month, day] = String(value).split('-').map(Number);
    if (!year || !month || !day) return String(value);

    return new Intl.DateTimeFormat('id-ID', {
        timeZone: WITA_TIME_ZONE,
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric'
    }).format(new Date(Date.UTC(year, month - 1, day, 4)));
};

let schemaPromise = null;

async function ensurePetugasReminderSchema() {
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS email_reminders (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                booking_id INT NOT NULL,
                recipient_role VARCHAR(20) NOT NULL,
                recipient_id INT NOT NULL,
                reminder_type VARCHAR(30) NOT NULL,
                scheduled_date DATE NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                attempts INT NOT NULL DEFAULT 0,
                last_error VARCHAR(500) NULL,
                sent_at DATETIME NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_email_reminder (
                    booking_id,
                    recipient_role,
                    reminder_type,
                    scheduled_date
                ),
                KEY idx_email_reminder_status (status, updated_at),
                KEY idx_email_reminder_recipient (recipient_role, recipient_id)
            )
        `);
    })().catch(err => {
        schemaPromise = null;
        throw err;
    });

    return schemaPromise;
}

async function getDuePetugasReminders(window) {
    const [rows] = await pool.query(
        `SELECT
            b.id AS booking_id,
            b.nomor_berkas,
            DATE_FORMAT(b.tanggal_fix, '%Y-%m-%d') AS scheduled_date,
            b.alamat_lokasi,
            p.id AS petugas_id,
            p.nama_lengkap AS petugas_nama,
            p.email AS petugas_email,
            u.nama_lengkap AS pemohon_nama,
            k.nama_kecamatan,
            l.nama_kelurahan
         FROM bookings b
         INNER JOIN petugas p ON p.id = b.petugas_id
         LEFT JOIN users u ON u.id = b.user_id
         LEFT JOIN kecamatan k ON k.id = b.kecamatan_id
         LEFT JOIN kelurahan l ON l.id = b.kelurahan_id
         WHERE b.status = 'jadwal_fix'
           AND b.tanggal_fix IS NOT NULL
           AND DATE(b.tanggal_fix) IN (?, ?)
           AND p.is_active = 1
           AND p.email IS NOT NULL
           AND TRIM(p.email) <> ''
         ORDER BY b.tanggal_fix ASC, b.id ASC`,
        [window.today, window.tomorrow]
    );

    return rows;
}

async function claimReminder(booking, reminderType, maxAttempts, retryMinutes) {
    await pool.query(
        `INSERT IGNORE INTO email_reminders
            (booking_id, recipient_role, recipient_id, reminder_type, scheduled_date)
         VALUES (?, 'petugas', ?, ?, ?)`,
        [
            booking.booking_id,
            booking.petugas_id,
            reminderType,
            booking.scheduled_date
        ]
    );

    const [result] = await pool.query(
        `UPDATE email_reminders
         SET status = 'sending',
             attempts = attempts + 1,
             last_error = NULL
         WHERE booking_id = ?
           AND recipient_role = 'petugas'
           AND reminder_type = ?
           AND scheduled_date = ?
           AND (
                status = 'pending'
                OR (
                    status = 'failed'
                    AND attempts < ?
                    AND updated_at <= DATE_SUB(NOW(), INTERVAL ? MINUTE)
                )
                OR (
                    status = 'sending'
                    AND attempts < ?
                    AND updated_at <= DATE_SUB(NOW(), INTERVAL ? MINUTE)
                )
           )`,
        [
            booking.booking_id,
            reminderType,
            booking.scheduled_date,
            maxAttempts,
            retryMinutes,
            maxAttempts,
            retryMinutes
        ]
    );

    return result.affectedRows === 1;
}

async function markReminderSent(booking, reminderType) {
    await pool.query(
        `UPDATE email_reminders
         SET status = 'sent', sent_at = NOW(), last_error = NULL
         WHERE booking_id = ?
           AND recipient_role = 'petugas'
           AND reminder_type = ?
           AND scheduled_date = ?`,
        [booking.booking_id, reminderType, booking.scheduled_date]
    );
}

async function markReminderFailed(booking, reminderType, error) {
    await pool.query(
        `UPDATE email_reminders
         SET status = 'failed', last_error = ?
         WHERE booking_id = ?
           AND recipient_role = 'petugas'
           AND reminder_type = ?
           AND scheduled_date = ?`,
        [
            String(error || 'Email gagal dikirim').slice(0, 500),
            booking.booking_id,
            reminderType,
            booking.scheduled_date
        ]
    );
}

const buildReminderEmail = (booking, reminderType) => {
    const dateLabel = formatIndonesianDate(booking.scheduled_date);
    const timeLabel = reminderType === 'hari_h' ? 'hari ini' : 'besok';
    const location = [
        booking.nama_kecamatan,
        booking.nama_kelurahan
    ].filter(Boolean).map(escapeHTML).join(', ');

    return {
        judul: reminderType === 'hari_h'
            ? 'Pengingat Pemeriksaan Hari Ini'
            : 'Pengingat Pemeriksaan Besok',
        pesan: [
            `Yth. <strong>${escapeHTML(booking.petugas_nama || 'Petugas BPN')}</strong>,`,
            `Anda memiliki jadwal pemeriksaan <strong>${timeLabel}</strong>,`,
            `untuk berkas <strong>${escapeHTML(booking.nomor_berkas)}</strong>`,
            `atas nama <strong>${escapeHTML(booking.pemohon_nama || 'pemohon')}</strong>`,
            `pada <strong>${dateLabel}</strong>.`,
            location ? `Wilayah: <strong>${location}</strong>.` : '',
            booking.alamat_lokasi
                ? `Alamat lokasi: <strong>${escapeHTML(booking.alamat_lokasi)}</strong>.`
                : '',
            'Silakan buka portal petugas untuk melihat detail tugas.'
        ].filter(Boolean).join(' ')
    };
};

async function processPetugasReminders(now = new Date()) {
    if (!isEnabled()) {
        return { enabled: false, checked: 0, sent: 0, failed: 0, skipped: 0 };
    }

    await ensurePetugasReminderSchema();

    const configuredStartHour = Number(process.env.PETUGAS_REMINDER_START_HOUR_WITA);
    const startHour = Number.isFinite(configuredStartHour)
        ? Math.min(23, Math.max(0, configuredStartHour))
        : 7;
    const window = getReminderWindow(now);
    if (window.hour < startHour) {
        return { enabled: true, beforeStartHour: true, checked: 0, sent: 0, failed: 0, skipped: 0 };
    }

    const maxAttempts = positiveNumber(process.env.PETUGAS_REMINDER_MAX_ATTEMPTS, 3);
    const retryMinutes = positiveNumber(process.env.PETUGAS_REMINDER_RETRY_MINUTES, 15);
    const bookings = await getDuePetugasReminders(window);
    const summary = { enabled: true, checked: bookings.length, sent: 0, failed: 0, skipped: 0 };

    for (const booking of bookings) {
        const reminderType = reminderTypeForDate(booking.scheduled_date, window);
        if (!reminderType) {
            summary.skipped += 1;
            continue;
        }

        const claimed = await claimReminder(booking, reminderType, maxAttempts, retryMinutes);
        if (!claimed) {
            summary.skipped += 1;
            continue;
        }

        const content = buildReminderEmail(booking, reminderType);
        const result = await kirimEmail({
            email_user: booking.petugas_email,
            judul: content.judul,
            pesan: content.pesan,
            nomor_berkas: booking.nomor_berkas,
            idempotency_key: [
                'petugas-reminder',
                booking.booking_id,
                reminderType,
                booking.scheduled_date
            ].join('-')
        });

        if (result.sent) {
            await markReminderSent(booking, reminderType);
            summary.sent += 1;
        } else {
            await markReminderFailed(
                booking,
                reminderType,
                result.error || result.skipped || result.code
            );
            summary.failed += 1;
        }
    }

    return summary;
}

function startPetugasReminderScheduler() {
    if (!isEnabled()) {
        console.log('[Reminder Petugas] Nonaktif. Aktifkan dengan PETUGAS_REMINDER_ENABLED=true.');
        return null;
    }

    const intervalMinutes = positiveNumber(process.env.PETUGAS_REMINDER_INTERVAL_MINUTES, 15);
    const initialDelayMs = positiveNumber(process.env.PETUGAS_REMINDER_INITIAL_DELAY_MS, 15000);
    const intervalMs = Math.max(60 * 1000, intervalMinutes * 60 * 1000);
    let running = false;

    const run = async () => {
        if (running) return;
        running = true;
        try {
            const summary = await processPetugasReminders();
            if (summary.sent > 0 || summary.failed > 0) {
                console.log(
                    `[Reminder Petugas] diperiksa=${summary.checked}, `
                    + `terkirim=${summary.sent}, gagal=${summary.failed}, dilewati=${summary.skipped}`
                );
            }
        } catch (err) {
            console.error('[Reminder Petugas] Gagal memproses reminder:', err.message);
        } finally {
            running = false;
        }
    };

    const startupTimer = setTimeout(run, initialDelayMs);
    const intervalTimer = setInterval(run, intervalMs);
    startupTimer.unref?.();
    intervalTimer.unref?.();

    const configuredStartHour = Number(process.env.PETUGAS_REMINDER_START_HOUR_WITA);
    const startHour = Number.isFinite(configuredStartHour)
        ? Math.min(23, Math.max(0, configuredStartHour))
        : 7;

    console.log(
        `[Reminder Petugas] Aktif setiap ${intervalMinutes} menit, `
        + `mulai pukul ${String(startHour).padStart(2, '0')}.00 WITA.`
    );

    return { startupTimer, intervalTimer, run };
}

module.exports = {
    WITA_TIME_ZONE,
    ensurePetugasReminderSchema,
    getReminderWindow,
    reminderTypeForDate,
    buildReminderEmail,
    processPetugasReminders,
    startPetugasReminderScheduler
};
