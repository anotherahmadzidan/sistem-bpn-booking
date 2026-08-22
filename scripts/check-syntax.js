const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Daftar berkas sengaja ditemukan otomatis, bukan ditulis manual: daftar manual
// sebelumnya tertinggal saat ada berkas baru, sehingga sebagian kode tidak
// pernah ikut diperiksa.
const root = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'uploads', 'coverage', 'tmp']);

function walk(dir, matcher, found = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, matcher, found);
        else if (matcher(entry.name)) found.push(full);
    }
    return found;
}

const rel = (file) => path.relative(root, file).split(path.sep).join('/');

const jsFiles = walk(root, (name) => name.endsWith('.js'))
    .filter((file) => rel(file) !== 'package-lock.json');
const htmlFiles = walk(root, (name) => name.endsWith('.html'));

const failures = [];

for (const file of jsFiles) {
    try {
        new vm.Script(fs.readFileSync(file, 'utf8'), { filename: rel(file) });
    } catch (error) {
        failures.push(`${rel(file)}: ${error.message}`);
    }
}

for (const file of htmlFiles) {
    const source = fs.readFileSync(file, 'utf8');
    const scripts = source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi);
    let index = 0;
    for (const match of scripts) {
        index += 1;
        if (!match[1].trim()) continue;
        try {
            new vm.Script(match[1], { filename: `${rel(file)}#script-${index}` });
        } catch (error) {
            failures.push(`${rel(file)} script ${index}: ${error.message}`);
        }
    }
}

if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
} else {
    console.log(`Syntax OK: ${jsFiles.length} berkas JS dan ${htmlFiles.length} berkas HTML.`);
}
