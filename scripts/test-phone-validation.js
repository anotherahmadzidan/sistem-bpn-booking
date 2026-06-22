const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
    normalizeIndonesianPhone,
    requireIndonesianPhone,
    assertPhoneAvailable
} = require('../utils/phone');

const accepted = new Map([
    ['081234567890', '6281234567890'],
    ['0812 3456 7890', '6281234567890'],
    ['+6281234567890', '6281234567890'],
    ['6281234567890', '6281234567890'],
    ['+62-812-3456-7890', '6281234567890']
]);

for (const [input, expected] of accepted) {
    const result = normalizeIndonesianPhone(input);
    assert.strictEqual(result.valid, true, input);
    assert.strictEqual(result.normalized, expected, input);
    assert.strictEqual(requireIndonesianPhone(input), expected, input);
}

for (const input of [
    '',
    '07123456789',
    '09123456789',
    '12345',
    'abcdefghij',
    '62+81234567890',
    '+62812+34567890',
    '628123'
]) {
    const result = normalizeIndonesianPhone(input);
    assert.strictEqual(result.valid, false, input);
    assert.throws(() => requireIndonesianPhone(input), error =>
        error.status === 400 && error.code.startsWith('PHONE_')
    );
}

const browserSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'phone-validation.js'),
    'utf8'
);
const context = vm.createContext({ window: {} });
vm.runInContext(browserSource, context);

for (const [input, expected] of accepted) {
    const result = context.window.PhoneValidation.normalize(input);
    assert.strictEqual(result.valid, true, `browser: ${input}`);
    assert.strictEqual(result.normalized, expected, `browser: ${input}`);
}

const listeners = {};
const classes = new Set();
const attributes = new Map();
const input = {
    value: '',
    dataset: {},
    classList: {
        toggle(name, active) {
            if (active) classes.add(name);
            else classes.delete(name);
        }
    },
    setAttribute(name, value) {
        attributes.set(name, value);
    },
    addEventListener(name, handler) {
        listeners[name] = handler;
    }
};
const feedback = {
    textContent: '',
    classList: {
        toggle(name, active) {
            if (active) classes.add(`feedback:${name}`);
            else classes.delete(`feedback:${name}`);
        }
    }
};

context.window.PhoneValidation.bind(input, feedback);
input.value = '0812abc 3456-7890';
listeners.input();
assert.strictEqual(input.value, '0812 3456-7890');
assert.ok(classes.has('phone-input-invalid'));
assert.match(feedback.textContent, /tidak diperbolehkan/);

input.value = '0812 3456-7890';
listeners.input();
assert.match(feedback.textContent, /6281234567890/);
assert.ok(classes.has('phone-input-valid'));
assert.strictEqual(attributes.get('inputmode'), 'tel');

input.value = '07123456789';
listeners.input();
assert.ok(classes.has('phone-input-invalid'));
assert.match(feedback.textContent, /08, \+628, atau 628/);

(async () => {
    await assert.rejects(
        () => assertPhoneAvailable({
            async query(sql) {
                if (String(sql).includes('FROM users')) return [[{ id: 1 }]];
                return [[]];
            }
        }, '6281234567890'),
        error => error.code === 'PHONE_ALREADY_REGISTERED' && error.status === 409
    );

    await assert.rejects(
        () => assertPhoneAvailable({
            async query(sql) {
                if (String(sql).includes('FROM users')) return [[]];
                return [[{ id: 2 }]];
            }
        }, '6281234567890'),
        error => error.code === 'PHONE_ALREADY_REGISTERED' && error.status === 409
    );

    console.log('Indonesian phone validation: OK');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
