const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Logika halaman login kini berada di berkas terpisah (dulu inline di
// public/pages/login.html) agar bisa di-lint dan di-cache browser.
const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'login.js'),
    'utf8'
);

const ids = [
    'form-login',
    'form-register',
    'form-verify',
    'form-complete',
    'form-forgot',
    'form-reset',
    'login-error',
    'login-success',
    'register-error',
    'register-success',
    'verify-error',
    'verify-success',
    'complete-error',
    'complete-success',
    'forgot-error',
    'forgot-success',
    'reset-error',
    'reset-success',
    'verify-email',
    'verify-otp',
    'verify-resend-btn',
    'verify-resend-status',
    'complete-email'
];

const elements = Object.fromEntries(ids.map(id => [
    id,
    {
        id,
        style: { display: id === 'form-login' ? 'block' : 'none' },
        value: '',
        textContent: '',
        disabled: false,
        dataset: {}
    }
]));

const sessionValues = new Map();
const localValues = new Map();
const context = vm.createContext({
    console,
    Date,
    Math,
    Number,
    String,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    localStorage: {
        getItem: () => null,
        setItem: (key, value) => localValues.set(key, String(value))
    },
    sessionStorage: {
        getItem: key => sessionValues.get(key) || null,
        setItem: (key, value) => sessionValues.set(key, String(value)),
        removeItem: key => sessionValues.delete(key)
    },
    window: {
        location: { href: '' }
    },
    document: {
        getElementById(id) {
            if (!elements[id]) {
                elements[id] = {
                    id,
                    style: { display: 'none' },
                    value: '',
                    textContent: '',
                    disabled: false,
                    dataset: {}
                };
            }
            return elements[id];
        },
        addEventListener: () => {},
        querySelector: () => null
    },
    AppAsync: {
        setButtonLoading: () => true,
        fetchWithTimeout: async () => {
            throw new Error('Fetch tidak boleh dipanggil pada pengujian UI ini.');
        },
        errorMessage: error => error.message
    },
    PhoneValidation: {
        bind: () => {},
        validateInput: () => ({
            valid: true,
            normalized: '6281234567890',
            message: 'Nomor valid.'
        })
    }
});

vm.runInContext(source, context, { filename: 'public/pages/login.html' });
vm.runInContext(
    `followRegistrationStatus({
        status: 'pending_email_verification',
        email: 'pending@example.com',
        message: 'OTP masih aktif',
        resend_available_in_seconds: 37
    });`,
    context
);

assert.strictEqual(elements['form-verify'].style.display, 'block');
assert.strictEqual(elements['form-register'].style.display, 'none');
assert.strictEqual(elements['verify-email'].value, 'pending@example.com');
assert.strictEqual(elements['verify-resend-btn'].disabled, true);
assert.match(elements['verify-resend-status'].textContent, /00:37/);

vm.runInContext(
    `followRegistrationStatus({
        status: 'pending_profile_completion',
        email: 'pending@example.com',
        registration_token: 'completion-token'
    });`,
    context
);
assert.strictEqual(elements['form-complete'].style.display, 'block');
assert.strictEqual(elements['form-verify'].style.display, 'none');
assert.strictEqual(elements['complete-email'].value, 'pending@example.com');
assert.strictEqual(
    sessionValues.get('registration_completion_token'),
    'completion-token'
);

vm.runInContext(
    `followRegistrationStatus({
        status: 'active',
        token: 'user-token',
        nama: 'Pemohon Test',
        role: 'user'
    });`,
    context
);
assert.strictEqual(localValues.get('token'), 'user-token');
assert.strictEqual(localValues.get('role'), 'user');
assert.strictEqual(context.window.location.href, '/user');

vm.runInContext('startResendCountdown(0);', context);
assert.strictEqual(elements['verify-resend-btn'].disabled, false);
assert.match(elements['verify-resend-status'].textContent, /mengirim ulang OTP/i);

console.log('Login registration UI states: OK');
