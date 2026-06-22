const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const jsFiles = [
    'server.js',
    'bootstrap.js',
    'dbPool.js',
    'adminPetugasOverrides.js',
    'config/db.js',
    'utils/http.js',
    'utils/kuota.js',
    'utils/notifikasi.js',
    'utils/petugasReminder.js',
    'utils/otp.js',
    'utils/phone.js',
    'controllers/authController.js',
    'controllers/bookingController.js',
    'controllers/petugasController.js',
    'controllers/adminController.js',
    'public/js/app-async.js',
    'public/js/phone-validation.js'
];
const htmlFiles = [
    'public/pages/login.html',
    'public/pages/login-petugas.html',
    'public/pages/user.html',
    'public/pages/petugas.html',
    'public/pages/admin.html'
];

const failures = [];

for (const relativePath of jsFiles) {
    try {
        const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
        new vm.Script(source, { filename: relativePath });
    } catch (error) {
        failures.push(`${relativePath}: ${error.message}`);
    }
}

for (const relativePath of htmlFiles) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    const scripts = source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi);
    let index = 0;
    for (const match of scripts) {
        index += 1;
        if (!match[1].trim()) continue;
        try {
            new vm.Script(match[1], { filename: `${relativePath}#script-${index}` });
        } catch (error) {
            failures.push(`${relativePath} script ${index}: ${error.message}`);
        }
    }
}

if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
} else {
    console.log(`Syntax OK: ${jsFiles.length} file JS dan ${htmlFiles.length} file HTML.`);
}
