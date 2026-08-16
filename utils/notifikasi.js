const pool = require('../config/db');
const nodemailer = require('nodemailer');
require('dotenv').config();

function maskEmail(email) {
    if (!email) return '-';
    const [name, domain] = String(email).split('@');
    if (!domain) return '***';
    return `${name.slice(0, 2)}***@${domain}`;
}

function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function escapeHTML(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Kegagalan notifikasi tidak boleh menggagalkan aksi yang transaksinya sudah
// commit. Sebelumnya error di sini membuat respons 500 padahal data sudah
// tersimpan, sehingga pemohon mengira gagal lalu mengirim ulang.
//
// Pemanggilnya WAJIB sudah melepas koneksi transaksi sebelum masuk ke sini,
// karena isi task memakai pool.query lagi.
async function kirimNotifikasiAman(task) {
    try {
        await task();
    } catch (err) {
        console.error('[Notifikasi] Gagal mengirim notifikasi:', err.message);
    }
}

function buildEmailConfig() {
    const requestedProvider = String(process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
    const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
    const user = (process.env.EMAIL_USER || process.env.SMTP_USER || '').trim();
    const rawPass = process.env.EMAIL_PASS || process.env.SMTP_PASS || '';
    const service = (process.env.EMAIL_SERVICE || 'gmail').trim();
    const host = (process.env.SMTP_HOST || process.env.EMAIL_HOST || '').trim();
    const port = Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 0);
    const timeoutMs = positiveNumber(process.env.EMAIL_TIMEOUT_MS, 8000);
    const isGmail = service.toLowerCase() === 'gmail' || host.toLowerCase().includes('gmail');
    const pass = isGmail ? rawPass.replace(/\s/g, '') : rawPass.trim();
    const useResend = requestedProvider === 'resend' || (!requestedProvider && Boolean(resendApiKey));

    if (useResend) {
        if (!resendApiKey) {
            return {
                enabled: false,
                provider: 'resend',
                reason: 'RESEND_API_KEY belum diisi'
            };
        }

        return {
            enabled: true,
            provider: 'resend',
            apiKey: resendApiKey,
            from: process.env.EMAIL_FROM || 'BPN Luwu Timur <onboarding@resend.dev>',
            timeoutMs
        };
    }

    if (!user || !pass) {
        return {
            enabled: false,
            provider: 'smtp',
            reason: 'EMAIL_USER/EMAIL_PASS belum lengkap'
        };
    }

    const transport = host
        ? {
            host,
            port: port || 587,
            secure: String(process.env.SMTP_SECURE || process.env.EMAIL_SECURE || '').toLowerCase() === 'true',
            auth: { user, pass },
            connectionTimeout: timeoutMs,
            greetingTimeout: timeoutMs,
            socketTimeout: timeoutMs
        }
        : {
            service,
            auth: { user, pass },
            connectionTimeout: timeoutMs,
            greetingTimeout: timeoutMs,
            socketTimeout: timeoutMs
        };

    return {
        enabled: true,
        provider: 'smtp',
        user,
        from: process.env.EMAIL_FROM || `"BPN Luwu Timur" <${user}>`,
        timeoutMs,
        transport
    };
}

const emailConfig = buildEmailConfig();
const transporter = emailConfig.enabled && emailConfig.provider === 'smtp'
    ? nodemailer.createTransport(emailConfig.transport)
    : null;
let emailDisabledLogged = false;
const emailQueueConcurrency = positiveNumber(process.env.EMAIL_QUEUE_CONCURRENCY || process.env.EMAIL_CONCURRENCY, 2);
const emailQueue = [];
let activeEmailJobs = 0;

let schemaPromise = null;

async function ensureNotificationSchema() {
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id INT NOT NULL AUTO_INCREMENT,
                user_id INT NULL,
                recipient_role VARCHAR(20) NOT NULL DEFAULT 'user',
                recipient_id INT NULL,
                booking_id INT NULL,
                judul VARCHAR(150) NOT NULL,
                pesan TEXT NOT NULL,
                is_read TINYINT(1) NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_notification_recipient (recipient_role, recipient_id, is_read),
                KEY idx_notification_booking (booking_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        const [columns] = await pool.query('SHOW COLUMNS FROM notifications');
        const columnMap = new Map(columns.map(col => [col.Field, col]));

        if (columnMap.has('user_id') && columnMap.get('user_id').Null === 'NO') {
            await pool.query('ALTER TABLE notifications MODIFY user_id INT NULL');
        }

        if (!columnMap.has('recipient_role')) {
            await pool.query("ALTER TABLE notifications ADD COLUMN recipient_role VARCHAR(20) NOT NULL DEFAULT 'user' AFTER user_id");
        }

        if (!columnMap.has('recipient_id')) {
            await pool.query('ALTER TABLE notifications ADD COLUMN recipient_id INT NULL AFTER recipient_role');
        }

        if (!columnMap.has('is_read')) {
            await pool.query('ALTER TABLE notifications ADD COLUMN is_read TINYINT(1) NOT NULL DEFAULT 0');
        }

        if (!columnMap.has('created_at')) {
            await pool.query('ALTER TABLE notifications ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
        }

        await pool.query(`
            UPDATE notifications
            SET recipient_role = 'user'
            WHERE recipient_role IS NULL OR recipient_role = ''
        `);

        await pool.query(`
            UPDATE notifications
            SET recipient_id = user_id
            WHERE recipient_id IS NULL AND user_id IS NOT NULL
        `);

        const [indexes] = await pool.query('SHOW INDEX FROM notifications');
        const indexNames = new Set(indexes.map(index => index.Key_name));
        if (!indexNames.has('idx_notification_recipient')) {
            await pool.query(
                'CREATE INDEX idx_notification_recipient ON notifications (recipient_role, recipient_id, is_read)'
            );
        }
    })().catch(err => {
        schemaPromise = null;
        throw err;
    });

    return schemaPromise;
}

function cleanMailerMessage(err) {
    if (!err) return 'Unknown mailer error';

    const secretValues = [
        process.env.EMAIL_PASS,
        process.env.SMTP_PASS
    ].filter(Boolean);

    let message = err.message || String(err);
    for (const secret of secretValues) {
        message = message.split(secret).join('***');
    }

    const meta = [
        err.code,
        err.responseCode ? `response ${err.responseCode}` : null,
        err.command ? `command ${err.command}` : null
    ].filter(Boolean).join(' | ');

    return meta ? `${meta}: ${message}` : message;
}

function classifyEmailError(err, fallbackCode = 'EMAIL_SEND_FAILED') {
    const status = Number(err?.status || err?.statusCode || err?.responseCode || 0);
    const sourceCode = String(err?.code || '').toUpperCase();
    const message = String(err?.message || err?.response || err || '').toLowerCase();

    if (
        status === 403
        && (
            message.includes('verify a domain')
            || message.includes('verified domain')
            || message.includes('testing emails')
            || message.includes('resend.dev')
        )
    ) {
        return 'EMAIL_SENDER_NOT_VERIFIED';
    }

    if (sourceCode === 'EAUTH' || status === 401 || status === 403) {
        return 'EMAIL_AUTH_FAILED';
    }

    if (status === 429 || message.includes('rate limit') || message.includes('too many')) {
        return 'EMAIL_RATE_LIMITED';
    }

    if (
        sourceCode === 'EENVELOPE'
        || [550, 551, 552, 553, 554].includes(status)
        || message.includes('recipient')
        || message.includes('mailbox')
        || message.includes('address')
    ) {
        return 'EMAIL_RECIPIENT_REJECTED';
    }

    if (
        ['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNRESET', 'ENETUNREACH'].includes(sourceCode)
        || message.includes('timeout')
        || message.includes('connection')
    ) {
        return 'EMAIL_TRANSPORT_UNAVAILABLE';
    }

    return fallbackCode;
}

// `pesan` sengaja dibiarkan berisi HTML (pemanggil sudah meng-escape bagian
// yang berasal dari input pengguna). `judul` dan `nomor_berkas` selalu di-escape
// karena keduanya bisa memuat data mentah dari pemohon.
function buildEmailHtml({ judul, pesan, nomor_berkas }) {
    judul = escapeHTML(judul);
    nomor_berkas = nomor_berkas ? escapeHTML(nomor_berkas) : nomor_berkas;
    return `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
        <div style="background:#0F4069;padding:24px 32px">
          <h2 style="color:#FFC107;margin:0;font-size:18px">BPN Luwu Timur</h2>
          <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:13px">Sistem Booking Pemeriksaan Tanah</p>
        </div>
        <div style="padding:28px 32px">
          <h3 style="color:#0F4069;margin:0 0 12px;font-size:16px">${judul}</h3>
          <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 20px">${pesan}</p>
          ${nomor_berkas ? `
          <div style="background:#f8fafc;border-left:4px solid #FFC107;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:20px">
            <span style="font-size:12px;color:#64748b">Nomor Berkas</span>
            <div style="font-size:15px;font-weight:700;color:#0F4069">${nomor_berkas}</div>
          </div>` : ''}
          <p style="font-size:12px;color:#94a3b8;margin:0">
            Email ini dikirim otomatis oleh sistem. Jangan membalas email ini.
          </p>
        </div>
        <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0">
          <p style="font-size:11px;color:#94a3b8;margin:0;text-align:center">
            Copyright 2026 Badan Pertanahan Nasional Kabupaten Luwu Timur
          </p>
        </div>
      </div>
    `;
}

async function sendWithResend({ email_user, judul, html, idempotency_key }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
        () => controller.abort(new Error('Resend request timeout')),
        emailConfig.timeoutMs
    );
    let response;
    try {
        response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${emailConfig.apiKey}`,
                'Content-Type': 'application/json',
                ...(idempotency_key ? { 'Idempotency-Key': idempotency_key } : {})
            },
            body: JSON.stringify({
                from: emailConfig.from,
                to: [email_user],
                subject: `[BPN Luwu Timur] ${judul}`,
                html
            }),
            signal: controller.signal
        });
    } catch (err) {
        if (controller.signal.aborted) {
            const timeoutError = new Error('Layanan email melewati batas waktu');
            timeoutError.code = 'EMAIL_TIMEOUT';
            throw timeoutError;
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const err = new Error(payload.message || `Resend API merespons HTTP ${response.status}`);
        err.status = response.status;
        err.code = payload.name || `RESEND_HTTP_${response.status}`;
        throw err;
    }

    return {
        messageId: payload.id || null
    };
}

async function verifyEmailTransport() {
    if (!emailConfig.enabled) {
        const reason = emailConfig.reason || 'konfigurasi SMTP belum lengkap';
        console.warn(`[Email] Nonaktif: ${reason}`);
        return { ok: false, reason };
    }

    if (emailConfig.provider === 'resend') {
        console.log(`[Email] Resend HTTPS API siap dipakai dengan pengirim ${emailConfig.from}`);
        return { ok: true, provider: 'resend' };
    }

    try {
        await transporter.verify();
        console.log(`[Email] SMTP siap dipakai: ${maskEmail(emailConfig.user)}`);
        return { ok: true, provider: 'smtp' };
    } catch (err) {
        const detail = cleanMailerMessage(err);
        console.error(`[Email] SMTP gagal diverifikasi untuk ${maskEmail(emailConfig.user)}: ${detail}`);
        return {
            ok: false,
            reason: detail,
            code: classifyEmailError(err, 'EMAIL_TRANSPORT_UNAVAILABLE')
        };
    }
}

async function kirimEmail({ email_user, judul, pesan, nomor_berkas, idempotency_key }) {
    if (!email_user) return { sent: false, skipped: 'recipient_empty' };

    if (!emailConfig.enabled) {
        if (!emailDisabledLogged) {
            console.warn(`[Email] Email tidak dikirim: ${emailConfig.reason || 'konfigurasi SMTP belum lengkap'}`);
            emailDisabledLogged = true;
        }
        return {
            sent: false,
            skipped: 'email_not_configured',
            code: 'EMAIL_NOT_CONFIGURED',
            error: emailConfig.reason
        };
    }

    try {
        const html = buildEmailHtml({ judul, pesan, nomor_berkas });
        const info = emailConfig.provider === 'resend'
            ? await sendWithResend({ email_user, judul, html, idempotency_key })
            : await transporter.sendMail({
                from: emailConfig.from,
                to: email_user,
                subject: `[BPN Luwu Timur] ${judul}`,
                html
            });

        if (String(process.env.EMAIL_DEBUG || '').toLowerCase() === 'true') {
            console.log(
                `[Email] Terkirim via ${emailConfig.provider} ke ${maskEmail(email_user)} `
                + `(${info.messageId || 'no-message-id'})`
            );
        }

        return {
            sent: true,
            provider: emailConfig.provider,
            messageId: info.messageId
        };
    } catch (err) {
        const detail = cleanMailerMessage(err);
        const code = classifyEmailError(err);
        console.error(`[Email] Gagal kirim via ${emailConfig.provider} ke ${maskEmail(email_user)}: ${detail}`);
        return {
            sent: false,
            provider: emailConfig.provider,
            code,
            error: detail
        };
    }
}

function enqueueEmail(payload) {
    if (!payload.email_user) {
        return { queued: false, skipped: 'recipient_empty' };
    }

    emailQueue.push({
        ...payload,
        queuedAt: Date.now()
    });
    setImmediate(processEmailQueue);
    return { queued: true };
}

function processEmailQueue() {
    while (activeEmailJobs < emailQueueConcurrency && emailQueue.length > 0) {
        const job = emailQueue.shift();
        activeEmailJobs += 1;

        kirimEmail(job)
            .then(result => {
                if (String(process.env.EMAIL_DEBUG || '').toLowerCase() === 'true') {
                    const elapsed = Date.now() - job.queuedAt;
                    const status = result.sent ? 'terkirim' : `tidak terkirim (${result.skipped || result.error || 'unknown'})`;
                    console.log(`[Email Queue] ${status} ke ${maskEmail(job.email_user)} setelah ${elapsed}ms`);
                }
            })
            .catch(err => {
                console.error(`[Email Queue] Error ke ${maskEmail(job.email_user)}: ${cleanMailerMessage(err)}`);
            })
            .finally(() => {
                activeEmailJobs -= 1;
                setImmediate(processEmailQueue);
            });
    }
}

async function kirimNotifikasi({
    user_id,
    recipient_role = 'user',
    recipient_id,
    booking_id,
    judul,
    pesan,
    email_user,
    nomor_berkas
}) {
    try {
        await ensureNotificationSchema();

        const targetId = recipient_id || user_id;
        if (!targetId) {
            throw new Error('recipient_id atau user_id wajib diisi');
        }

        const targetRole = recipient_role || 'user';
        const legacyUserId = targetRole === 'user' ? targetId : null;

        await pool.query(
            `INSERT INTO notifications
                (user_id, recipient_role, recipient_id, booking_id, judul, pesan)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [legacyUserId, targetRole, targetId, booking_id || null, judul, pesan]
        );

        enqueueEmail({ email_user, judul, pesan, nomor_berkas });
    } catch (err) {
        // Jangan sampai gagal kirim notifikasi menghentikan proses utama.
        console.error('Notifikasi error:', err.message);
    }
}

async function kirimNotifikasiAdmin(payload) {
    try {
        await ensureNotificationSchema();

        const [admins] = await pool.query('SELECT id, email FROM admin');
        const jobs = admins.map(admin => kirimNotifikasi({
            ...payload,
            recipient_role: 'admin',
            recipient_id: admin.id,
            user_id: null,
            email_user: admin.email
        }));

        const results = await Promise.allSettled(jobs);
        results.forEach(result => {
            if (result.status === 'rejected') {
                console.error('Notifikasi admin error:', result.reason?.message || result.reason);
            }
        });
    } catch (err) {
        console.error('Notifikasi admin error:', err.message);
    }
}

module.exports = {
    ensureNotificationSchema,
    verifyEmailTransport,
    kirimEmail,
    kirimNotifikasi,
    kirimNotifikasiAdmin,
    kirimNotifikasiAman
};
