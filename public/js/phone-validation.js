(function () {
    'use strict';

    const MIN_DIGITS = 10;
    const MAX_DIGITS = 15;
    const ALLOWED_PATTERN = /^[0-9+\s-]+$/;

    function normalize(value) {
        const raw = String(value || '').trim();
        if (!raw) {
            return {
                valid: false,
                normalized: '',
                code: 'PHONE_REQUIRED',
                message: 'Nomor HP wajib diisi.'
            };
        }
        if (!ALLOWED_PATTERN.test(raw)) {
            return {
                valid: false,
                normalized: '',
                code: 'PHONE_INVALID_CHARACTERS',
                message: 'Gunakan angka, spasi, tanda plus, atau tanda hubung saja.'
            };
        }

        const compact = raw.replace(/[\s-]/g, '');
        if (
            (compact.includes('+') && !compact.startsWith('+'))
            || (compact.match(/\+/g) || []).length > 1
        ) {
            return {
                valid: false,
                normalized: '',
                code: 'PHONE_INVALID_FORMAT',
                message: 'Tanda plus hanya boleh berada di awal nomor.'
            };
        }

        let digits = compact.startsWith('+') ? compact.slice(1) : compact;
        if (!/^\d+$/.test(digits)) {
            return {
                valid: false,
                normalized: '',
                code: 'PHONE_INVALID_FORMAT',
                message: 'Format nomor HP tidak valid.'
            };
        }
        if (digits.startsWith('08')) digits = `62${digits.slice(1)}`;
        if (!digits.startsWith('628')) {
            return {
                valid: false,
                normalized: '',
                code: 'PHONE_INVALID_PREFIX',
                message: 'Awali nomor dengan 08, +628, atau 628.'
            };
        }
        if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) {
            return {
                valid: false,
                normalized: '',
                code: 'PHONE_INVALID_LENGTH',
                message: `Nomor HP harus ${MIN_DIGITS}-${MAX_DIGITS} digit setelah dinormalisasi.`
            };
        }
        return {
            valid: true,
            normalized: digits,
            code: 'PHONE_VALID',
            message: `Nomor akan disimpan sebagai ${digits}.`
        };
    }

    function sanitize(value) {
        let clean = String(value || '').replace(/[^0-9+\s-]/g, '');
        const plusIndex = clean.indexOf('+');
        if (plusIndex > 0) clean = clean.replace(/\+/g, '');
        if (plusIndex === 0) {
            clean = `+${clean.slice(1).replace(/\+/g, '')}`;
        }
        return clean.slice(0, 24);
    }

    function showResult(input, feedback, result, { showEmpty = false } = {}) {
        const empty = !input.value.trim();
        input.classList.toggle('phone-input-valid', result.valid);
        input.classList.toggle('phone-input-invalid', !result.valid && (!empty || showEmpty));
        input.setAttribute('aria-invalid', String(!result.valid && (!empty || showEmpty)));

        if (!feedback) return result;
        feedback.classList.toggle('is-valid', result.valid);
        feedback.classList.toggle('is-error', !result.valid && (!empty || showEmpty));
        feedback.textContent = empty && !showEmpty
            ? 'Contoh: 081234567890'
            : result.message;
        return result;
    }

    function validateInput(inputOrId, feedbackOrId, options = {}) {
        const input = typeof inputOrId === 'string'
            ? document.getElementById(inputOrId)
            : inputOrId;
        const feedback = typeof feedbackOrId === 'string'
            ? document.getElementById(feedbackOrId)
            : feedbackOrId;
        if (!input) {
            return {
                valid: false,
                normalized: '',
                code: 'PHONE_INPUT_NOT_FOUND',
                message: 'Kolom nomor HP tidak ditemukan.'
            };
        }
        return showResult(input, feedback, normalize(input.value), options);
    }

    function bind(inputOrId, feedbackOrId) {
        const input = typeof inputOrId === 'string'
            ? document.getElementById(inputOrId)
            : inputOrId;
        const feedback = typeof feedbackOrId === 'string'
            ? document.getElementById(feedbackOrId)
            : feedbackOrId;
        if (!input || input.dataset.phoneValidationBound === 'true') return;

        input.dataset.phoneValidationBound = 'true';
        input.setAttribute('inputmode', 'tel');
        input.setAttribute('autocomplete', 'tel');
        input.setAttribute('maxlength', '24');
        input.addEventListener('input', () => {
            const sanitized = sanitize(input.value);
            if (input.value !== sanitized) {
                input.value = sanitized;
                showResult(input, feedback, {
                    valid: false,
                    normalized: '',
                    code: 'PHONE_INVALID_CHARACTERS',
                    message: 'Huruf dan simbol selain spasi, +, atau - tidak diperbolehkan.'
                }, { showEmpty: true });
                return;
            }
            validateInput(input, feedback);
        });
        input.addEventListener('blur', () => {
            validateInput(input, feedback, { showEmpty: true });
        });
        validateInput(input, feedback);
    }

    window.PhoneValidation = Object.freeze({
        normalize,
        sanitize,
        bind,
        validateInput
    });
})();
