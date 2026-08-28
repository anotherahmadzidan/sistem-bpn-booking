/* Logika halaman login-petugas. Dipindah dari public/pages/login-petugas.html supaya
   bisa di-lint, di-cache browser, dan di-review terpisah dari markup.
   Skrip klasik (bukan module): fungsi sengaja global agar dapat dipanggil
   penghubung aksi di common.js lewat atribut data-click/data-change/data-input. */

// Semua panel di halaman ini; hanya satu yang tampil pada satu waktu.
const PANEL = ['form-petugas', 'form-admin', 'form-lupa', 'form-otp'];

// Panel yang berada di bawah tab PETUGAS. Lupa sandi dan pengisian OTP adalah
// sub-keadaan dari tab itu, bukan tab tersendiri.
const PANEL_PETUGAS = ['form-petugas', 'form-lupa', 'form-otp'];

// Panel terakhir yang dibuka di sisi petugas. Tanpa ini, berpindah sejenak ke
// tab ADMIN lalu kembali akan membuang keadaan lupa sandi - termasuk saat
// pengguna sudah berada di layar pengisian OTP.
let panelPetugasTerakhir = 'form-petugas';

function tampilkanPanel(id) {
    PANEL.forEach(function (nama) {
        const el = document.getElementById(nama);
        if (el) el.style.display = nama === id ? 'block' : 'none';
    });
    if (PANEL_PETUGAS.indexOf(id) !== -1) panelPetugasTerakhir = id;
}

function switchTab(tab) {
    tampilkanPanel(tab === 'petugas' ? panelPetugasTerakhir : 'form-admin');

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
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
            body: JSON.stringify({ nip, password })
        });
        const data = await res.json();
        if (!res.ok) {
            errEl.textContent = data.message;
            errEl.style.display = 'flex';
            return;
        }
        localStorage.setItem('nama', data.nama);
        localStorage.setItem('role', 'petugas');
        // Penanda tampilan saja: server tetap menolak seluruh endpoint lain
        // sampai sandinya benar-benar diganti.
        if (data.harus_ganti_sandi) {
            localStorage.setItem('harus_ganti_sandi', '1');
        } else {
            localStorage.removeItem('harus_ganti_sandi');
        }
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
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) {
            errEl.textContent = data.message;
            errEl.style.display = 'flex';
            return;
        }
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

// ============================================================
// LUPA SANDI PETUGAS
//
// Langkah 1 hanya meminta NIP; email dicari server. Respons sengaja seragam
// untuk NIP terdaftar maupun tidak, sehingga layar ini tidak bisa dipakai
// memeriksa NIP mana yang punya akun. Petunjuk di layar OTP menggantikan
// informasi yang sengaja tidak diberikan itu.
// ============================================================

let nipLupaSandi = '';

function bukaLupaSandi() {
    nipLupaSandi = '';
    document.getElementById('lupa-nip').value = '';
    document.getElementById('lupa-error').style.display = 'none';
    tampilkanPanel('form-lupa');
}

function kembaliKeLoginPetugas() {
    tampilkanPanel('form-petugas');
}

function _tampilkanPesan(id, teks) {
    const el = document.getElementById(id);
    el.textContent = teks;
    el.style.display = 'block';
}

async function kirimOtpLupaSandi(tombol) {
    const nip = document.getElementById('lupa-nip').value.replace(/\s/g, '');
    document.getElementById('lupa-error').style.display = 'none';

    if (!/^\d{18}$/.test(nip)) {
        return _tampilkanPesan('lupa-error', 'NIP harus terdiri dari 18 digit angka.');
    }

    if (!AppAsync.setButtonLoading(tombol, true, 'Mengirim...')) return;
    try {
        const res = await AppAsync.fetchWithTimeout('/api/auth/lupa-sandi-petugas', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
            body: JSON.stringify({ nip })
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            return _tampilkanPesan('lupa-error', data.message || 'Permintaan gagal diproses.');
        }

        nipLupaSandi = nip;
        document.getElementById('lupa-info').textContent = data.message;
        ['otp-kode', 'otp-sandi', 'otp-sandi-ulang'].forEach((id) => {
            document.getElementById(id).value = '';
        });
        document.getElementById('otp-error').style.display = 'none';
        document.getElementById('otp-sukses').style.display = 'none';
        tampilkanPanel('form-otp');
    } catch (error) {
        _tampilkanPesan('lupa-error', AppAsync.errorMessage(error, 'Permintaan gagal dikirim.'));
    } finally {
        AppAsync.setButtonLoading(tombol, false);
    }
}

async function simpanSandiLewatOtp(tombol) {
    const otp = document.getElementById('otp-kode').value.trim();
    const sandi = document.getElementById('otp-sandi').value;
    const ulang = document.getElementById('otp-sandi-ulang').value;

    document.getElementById('otp-error').style.display = 'none';
    document.getElementById('otp-sukses').style.display = 'none';

    if (!/^\d{6}$/.test(otp)) {
        return _tampilkanPesan('otp-error', 'Kode OTP harus 6 digit angka.');
    }
    if (sandi.length < 8) {
        return _tampilkanPesan('otp-error', 'Kata sandi baru minimal 8 karakter.');
    }
    if (sandi !== ulang) {
        return _tampilkanPesan('otp-error', 'Ulangan kata sandi tidak sama.');
    }

    if (!AppAsync.setButtonLoading(tombol, true, 'Menyimpan...')) return;
    try {
        const res = await AppAsync.fetchWithTimeout('/api/auth/reset-sandi-petugas', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
            body: JSON.stringify({ nip: nipLupaSandi, otp, sandi_baru: sandi })
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            return _tampilkanPesan('otp-error', data.message || 'Kata sandi gagal diubah.');
        }

        _tampilkanPesan('otp-sukses', data.message || 'Kata sandi berhasil diubah. Silakan masuk.');
        setTimeout(kembaliKeLoginPetugas, 2000);
    } catch (error) {
        _tampilkanPesan('otp-error', AppAsync.errorMessage(error, 'Kata sandi gagal diubah.'));
    } finally {
        AppAsync.setButtonLoading(tombol, false);
    }
}
