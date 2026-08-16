/* Logika halaman login-petugas. Dipindah dari public/pages/login-petugas.html supaya
   bisa di-lint, di-cache browser, dan di-review terpisah dari markup.
   Skrip klasik (bukan module) agar fungsi tetap global untuk onclick="...". */

function switchTab(tab) {
    document.getElementById('form-petugas').style.display = tab === 'petugas' ? 'block' : 'none';
    document.getElementById('form-admin').style.display = tab === 'admin' ? 'block' : 'none';

    if (tab === 'petugas') {
        document.getElementById('btn-tab-petugas').classList.add('active');
        document.getElementById('btn-tab-admin').classList.remove('active');
    } else {
        document.getElementById('btn-tab-admin').classList.add('active');
        document.getElementById('btn-tab-petugas').classList.remove('active');
    }
}

function togglePass(id) {
    const input = document.getElementById(id);
    if (input.type === 'password') input.type = 'text';
    else input.type = 'password';
}

async function loginPetugas(button) {
    const nip = document.getElementById('nip').value.trim();
    const password = document.getElementById('pet-password').value;
    const errEl = document.getElementById('pet-error');
    errEl.style.display = 'none';

    if (!nip || !password) {
        errEl.textContent = 'NIP dan kata sandi wajib diisi.';
        errEl.style.display = 'flex';
        return;
    }
    if (!AppAsync.setButtonLoading(button, true, 'Memproses...')) return;
    try {
        const res = await AppAsync.fetchWithTimeout('/api/auth/login-petugas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nip, password })
        });
        const data = await res.json();
        if (!res.ok) {
            errEl.textContent = data.message;
            errEl.style.display = 'flex';
            return;
        }
        localStorage.setItem('token', data.token);
        localStorage.setItem('nama', data.nama);
        localStorage.setItem('role', 'petugas');
        window.location.href = '/petugas';
    } catch (err) {
        errEl.textContent = AppAsync.errorMessage(err, 'Login petugas gagal.');
        errEl.style.display = 'flex';
    } finally {
        AppAsync.setButtonLoading(button, false);
    }
}

async function loginAdmin(button) {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('adm-password').value;
    const errEl = document.getElementById('adm-error');
    errEl.style.display = 'none';

    if (!username || !password) {
        errEl.textContent = 'Username dan kata sandi wajib diisi.';
        errEl.style.display = 'flex';
        return;
    }
    if (!AppAsync.setButtonLoading(button, true, 'Memproses...')) return;
    try {
        const res = await AppAsync.fetchWithTimeout('/api/auth/login-admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) {
            errEl.textContent = data.message;
            errEl.style.display = 'flex';
            return;
        }
        localStorage.setItem('token', data.token);
        localStorage.setItem('nama', data.nama);
        localStorage.setItem('role', data.role);
        window.location.href = '/admin';
    } catch (err) {
        errEl.textContent = AppAsync.errorMessage(err, 'Login admin gagal.');
        errEl.style.display = 'flex';
    } finally {
        AppAsync.setButtonLoading(button, false);
    }
}
