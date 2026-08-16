/**
 * Konfigurasi ESLint.
 *
 * Tujuan utamanya bukan gaya penulisan, melainkan menangkap kelas kesalahan
 * yang benar-benar pernah terjadi di proyek ini: variabel yang tidak
 * dideklarasikan (pernah lolos karena berkas CommonJS berjalan di mode sloppy),
 * kode mati, dan promise yang tidak ditangani.
 */

const nodeGlobals = {
    require: 'readonly',
    module: 'writable',
    exports: 'writable',
    process: 'readonly',
    console: 'readonly',
    __dirname: 'readonly',
    __filename: 'readonly',
    Buffer: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    setImmediate: 'readonly',
    URL: 'readonly',
    AbortController: 'readonly',
    fetch: 'readonly'
};

const browserGlobals = {
    window: 'readonly',
    document: 'readonly',
    localStorage: 'readonly',
    sessionStorage: 'readonly',
    location: 'readonly',
    URLSearchParams: 'readonly',
    fetch: 'readonly',
    console: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    alert: 'readonly',
    confirm: 'readonly',
    FormData: 'readonly',
    XMLHttpRequest: 'readonly',
    AbortController: 'readonly',
    DOMException: 'readonly',
    Element: 'readonly',
    WeakMap: 'readonly',
    requestAnimationFrame: 'readonly',
    navigator: 'readonly',
    Intl: 'readonly',
    L: 'readonly',
    AppAsync: 'readonly',
    PhoneValidation: 'readonly',
    // Disediakan public/js/common.js, dimuat lebih dulu di setiap halaman.
    WITA_TIME_ZONE: 'readonly',
    escapeHTML: 'readonly',
    stripHTML: 'readonly',
    formatDate: 'readonly',
    formatDateTime: 'readonly',
    formatWaktu: 'readonly',
    safeMapsUrl: 'readonly',
    safeWhatsAppUrl: 'readonly'
};

const sharedRules = {
    'no-undef': 'error',
    'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
    'no-implicit-globals': 'error',
    'no-var': 'off',
    eqeqeq: ['warn', 'smart'],
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-return-await': 'warn',
    'require-atomic-updates': 'warn',
    'no-fallthrough': 'error',
    'no-constant-condition': ['error', { checkLoops: false }]
};

module.exports = [
    {
        ignores: ['node_modules/**', 'public/uploads/**', 'coverage/**']
    },
    {
        // Kode server (CommonJS).
        files: ['**/*.js'],
        ignores: ['public/**'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'commonjs',
            globals: nodeGlobals
        },
        rules: sharedRules
    },
    {
        // Kode browser. Skrip klasik, bukan module: fungsi memang sengaja
        // global agar atribut onclick="..." di HTML tetap berfungsi.
        files: ['public/js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'script',
            globals: browserGlobals
        },
        rules: {
            ...sharedRules,
            'no-implicit-globals': 'off',
            'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }]
        }
    }
];
