/* Komponen ganti sandi yang dipakai bersama dasbor pemohon, petugas, dan admin.
   Ditulis sekali di sini, bukan disalin ke tiga halaman - persis pelajaran dari
   helper escapeHTML yang dulu terduplikasi dan membuat perbaikan tidak merata.

   Skrip klasik (bukan module): fungsi sengaja global agar dapat dipanggil
   penghubung aksi di common.js lewat atribut data-click. */

var _gantiSandiWajib = false;

/** Menyisipkan markup modal sekali saja saat pertama dibutuhkan. */
function _pastikanModalGantiSandi() {
    if (document.getElementById('modal-ganti-sandi')) return;

    var wadah = document.createElement('div');
    wadah.className = 'modal-overlay';
    wadah.id = 'modal-ganti-sandi';
    wadah.innerHTML =
        '<div class="modal">'
        + '  <div class="modal-header">'
        + '    <h3 id="ganti-sandi-judul">Ganti Kata Sandi</h3>'
        + '    <button class="modal-close" id="ganti-sandi-tutup" data-click="tutupGantiSandi" aria-label="Tutup">'
        + '      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>'
        + '    </button>'
        + '  </div>'
        + '  <div class="modal-body">'
        + '    <p id="ganti-sandi-petunjuk" style="margin-bottom:16px;color:#64748b;font-size:13px"></p>'
        + '    <div class="form-group">'
        + '      <label for="ganti-sandi-lama">Kata Sandi Saat Ini</label>'
        + '      <input type="password" id="ganti-sandi-lama" autocomplete="current-password" placeholder="Kata sandi yang berlaku sekarang">'
        + '    </div>'
        + '    <div class="form-group">'
        + '      <label for="ganti-sandi-baru">Kata Sandi Baru</label>'
        + '      <input type="password" id="ganti-sandi-baru" autocomplete="new-password" placeholder="Minimal 8 karakter">'
        + '    </div>'
        + '    <div class="form-group">'
        + '      <label for="ganti-sandi-ulang">Ulangi Kata Sandi Baru</label>'
        + '      <input type="password" id="ganti-sandi-ulang" autocomplete="new-password" placeholder="Ketik ulang kata sandi baru">'
        + '    </div>'
        + '    <div id="ganti-sandi-error" class="alert alert-error" style="display:none"></div>'
        + '    <div id="ganti-sandi-sukses" class="alert alert-success" style="display:none"></div>'
        + '  </div>'
        + '  <div class="modal-footer">'
        + '    <button class="btn btn-secondary" id="ganti-sandi-batal" data-click="tutupGantiSandi">Batal</button>'
        + '    <button class="btn btn-primary" id="btn-simpan-sandi" data-click="simpanGantiSandi">Simpan</button>'
        + '  </div>'
        + '</div>';
    document.body.appendChild(wadah);
}

/**
 * @param {boolean} wajib Mode paksa: dipakai saat petugas masih memegang sandi
 *   buatan admin. Modal tidak bisa ditutup, karena server juga menolak seluruh
 *   endpoint lain sampai sandinya diganti.
 */
function bukaGantiSandi(wajib) {
    _pastikanModalGantiSandi();
    _gantiSandiWajib = wajib === true;

    document.getElementById('ganti-sandi-judul').textContent = _gantiSandiWajib
        ? 'Wajib Ganti Kata Sandi'
        : 'Ganti Kata Sandi';
    document.getElementById('ganti-sandi-petunjuk').textContent = _gantiSandiWajib
        ? 'Kata sandi Anda saat ini dibuatkan admin, sehingga admin mengetahuinya. '
          + 'Ganti sekarang agar hanya Anda yang tahu kata sandi akun ini.'
        : 'Setelah kata sandi diganti, sesi Anda di perangkat lain akan otomatis keluar.';

    // Pada mode wajib, jalan keluarnya hanya mengganti sandi atau keluar akun.
    document.getElementById('ganti-sandi-tutup').style.display = _gantiSandiWajib ? 'none' : '';
    document.getElementById('ganti-sandi-batal').style.display = _gantiSandiWajib ? 'none' : '';

    ['ganti-sandi-lama', 'ganti-sandi-baru', 'ganti-sandi-ulang'].forEach(function (id) {
        document.getElementById(id).value = '';
    });
    document.getElementById('ganti-sandi-error').style.display = 'none';
    document.getElementById('ganti-sandi-sukses').style.display = 'none';
    document.getElementById('modal-ganti-sandi').classList.add('show');
}

function tutupGantiSandi() {
    if (_gantiSandiWajib) return;
    var modal = document.getElementById('modal-ganti-sandi');
    if (modal) modal.classList.remove('show');
}

function _pesanGantiSandi(idElemen, teks) {
    var el = document.getElementById(idElemen);
    el.textContent = teks;
    el.style.display = 'block';
}

async function simpanGantiSandi() {
    var lama = document.getElementById('ganti-sandi-lama').value;
    var baru = document.getElementById('ganti-sandi-baru').value;
    var ulang = document.getElementById('ganti-sandi-ulang').value;
    var tombol = document.getElementById('btn-simpan-sandi');

    document.getElementById('ganti-sandi-error').style.display = 'none';
    document.getElementById('ganti-sandi-sukses').style.display = 'none';

    if (!lama || !baru) {
        return _pesanGantiSandi('ganti-sandi-error', 'Kata sandi saat ini dan yang baru wajib diisi.');
    }
    if (baru.length < 8) {
        return _pesanGantiSandi('ganti-sandi-error', 'Kata sandi baru minimal 8 karakter.');
    }
    if (baru !== ulang) {
        return _pesanGantiSandi('ganti-sandi-error', 'Ulangan kata sandi tidak sama.');
    }
    if (baru === lama) {
        return _pesanGantiSandi('ganti-sandi-error', 'Kata sandi baru harus berbeda dari yang lama.');
    }

    if (!AppAsync.setButtonLoading(tombol, true, 'Menyimpan...')) return;
    try {
        var res = await AppAsync.fetchWithTimeout('/api/auth/ganti-sandi', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
            body: JSON.stringify({ sandi_lama: lama, sandi_baru: baru })
        });
        var data = await res.json().catch(function () { return {}; });

        if (!res.ok) {
            return _pesanGantiSandi('ganti-sandi-error', data.message || 'Kata sandi gagal diubah.');
        }

        localStorage.removeItem('harus_ganti_sandi');
        _gantiSandiWajib = false;
        _pesanGantiSandi('ganti-sandi-sukses', data.message || 'Kata sandi berhasil diubah.');

        // Muat ulang supaya halaman berjalan dengan sesi yang baru diterbitkan.
        setTimeout(function () { window.location.reload(); }, 1200);
    } catch (error) {
        _pesanGantiSandi('ganti-sandi-error', AppAsync.errorMessage(error, 'Kata sandi gagal diubah.'));
    } finally {
        AppAsync.setButtonLoading(tombol, false);
    }
}

/**
 * Membuka modal dalam mode wajib bila akun ini masih memakai sandi buatan admin.
 * Dipanggil saat halaman dimuat, dan juga oleh apiFetch ketika server membalas
 * WAJIB_GANTI_SANDI - penanda di localStorage hanya untuk kenyamanan, penegakan
 * sesungguhnya ada di server.
 */
function periksaWajibGantiSandi() {
    if (localStorage.getItem('harus_ganti_sandi') === '1') bukaGantiSandi(true);
}

document.addEventListener('DOMContentLoaded', periksaWajibGantiSandi);
