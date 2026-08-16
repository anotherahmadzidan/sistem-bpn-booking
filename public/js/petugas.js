/* Logika halaman petugas. Dipindah dari public/pages/petugas.html supaya
   bisa di-lint, di-cache browser, dan di-review terpisah dari markup.
   Skrip klasik (bukan module) agar fungsi tetap global untuk onclick="...". */

const nama = localStorage.getItem('nama');
const role = localStorage.getItem('role');

// Penjaga tampilan saja - otorisasi sesungguhnya ada di cookie sesi yang
// diperiksa server. Nilai di localStorage tidak lagi memuat token.
if (role !== 'petugas') {
    localStorage.clear();
    window.location.href = '/login-petugas';
}

document.getElementById('sidebar-nama').textContent = nama;
document.getElementById('welcome-nama').textContent = nama || 'Petugas';
document.getElementById('petugas-header-date').textContent = new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
});

let allTugas = [];
let selectedBookingId = null;
let currentFilter = 'semua';
let currentSearchQuery = '';
let notifOpen = false;
let tugasLoaded = false;
let tugasLoadPromise = null;
const today = new Date().toISOString().split('T')[0];

function setPetugasButtonLoading(button, isLoading, label = 'Memproses...') {
    return AppAsync.setButtonLoading(button, isLoading, label);
}

function setPetugasSidebarOpen(isOpen) {
    document.body.classList.toggle('petugas-sidebar-open', isOpen);
    const toggle = document.getElementById('petugas-sidebar-toggle');
    if (toggle) {
        toggle.setAttribute('aria-expanded', String(isOpen));
        toggle.setAttribute('aria-label', isOpen ? 'Tutup menu petugas' : 'Buka menu petugas');
    }
}

function togglePetugasSidebar() {
    if (AppAsync.isBusy()) return;
    setPetugasSidebarOpen(!document.body.classList.contains('petugas-sidebar-open'));
}

function closePetugasSidebar() {
    setPetugasSidebarOpen(false);
}

function showPage(page) {
    document.getElementById('page-tugas').style.display = page === 'tugas' ? 'block' : 'none';
    document.getElementById('page-hasil').style.display = page === 'hasil' ? 'block' : 'none';
    document.getElementById('nav-tugas').classList.toggle('active', page === 'tugas');
    document.getElementById('nav-hasil').classList.toggle('active', page === 'hasil');
    if (window.matchMedia('(max-width: 640px)').matches) closePetugasSidebar();
    if (page === 'tugas') loadTugas();
    if (page === 'hasil') loadBerkasDropdown();
}

async function apiFetch(url, options = {}) {
    const res = await AppAsync.fetchWithTimeout(url, {
        ...options,
        credentials: 'same-origin',
        headers: { ...headerSesi(options.method), ...(options.headers || {}) }
    });
    if (res.status === 401) {
        localStorage.clear();
        window.location.href = '/login-petugas';
        throw new AppAsync.AppRequestError('Sesi Anda telah berakhir.', {
            code: 'UNAUTHORIZED',
            status: 401
        });
    }
    return res;
}

async function loadNotifikasi() {
    try {
        const res = await apiFetch('/api/auth/notifications');
        if (!res.ok) throw await AppAsync.responseError(res, 'Notifikasi gagal dimuat.');
        const data = await res.json();
        const badge = document.getElementById('petugas-notif-count');
        const list = document.getElementById('petugas-notif-list');

        if (data.unread > 0) {
            badge.textContent = data.unread > 99 ? '99+' : data.unread;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }

        if (!data.notifications || data.notifications.length === 0) {
            list.innerHTML = '<div class="role-notif-empty">Belum ada notifikasi</div>';
            return;
        }

        list.innerHTML = data.notifications.map(n => `
            <div class="role-notif-item ${n.is_read ? '' : 'unread'}">
                <div class="role-notif-title">${escapeHTML(n.judul)}</div>
                <div class="role-notif-message">${escapeHTML(stripHTML(n.pesan))}</div>
                <div class="role-notif-time">${formatWaktu(n.created_at)}</div>
            </div>
        `).join('');
    } catch (err) {
        if (notifOpen) {
            document.getElementById('petugas-notif-list').innerHTML =
                `<div class="role-notif-empty">${escapeHTML(AppAsync.errorMessage(err, 'Notifikasi gagal dimuat.'))}</div>`;
        }
    }
}

function toggleNotifikasi() {
    notifOpen = !notifOpen;
    document.getElementById('petugas-notif-dropdown').style.display = notifOpen ? 'block' : 'none';
    if (notifOpen) {
        loadNotifikasi();
        markAllNotifikasiRead();
    }
}

async function markAllNotifikasiRead() {
    try {
        const res = await apiFetch('/api/auth/notifications/read', { method: 'PATCH' });
        if (!res.ok) throw await AppAsync.responseError(res, 'Notifikasi gagal ditandai dibaca.');
        setTimeout(loadNotifikasi, 400);
    } catch (err) {
        console.error('Gagal mark read notifikasi', err);
    }
}

document.addEventListener('click', (e) => {
    const wrap = document.getElementById('petugas-notif-wrap');
    if (wrap && !wrap.contains(e.target) && notifOpen) {
        document.getElementById('petugas-notif-dropdown').style.display = 'none';
        notifOpen = false;
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePetugasSidebar();
});

async function loadTugas(force = false) {
    if (tugasLoaded && !force) {
        updateFilterCounts();
        return renderTugas(getFiltered(currentFilter));
    }
    if (tugasLoadPromise && !force) return tugasLoadPromise;
    const list = document.getElementById('tugas-list');
    const operationId = AppAsync.startOperation('Memuat daftar tugas...');
    list.innerHTML = '<div class="loading"><span class="spinner"></span> Memuat tugas...</div>';
    tugasLoadPromise = (async () => {
        try {
            const res = await apiFetch('/api/petugas/tugas');
            if (!res.ok) throw await AppAsync.responseError(res, 'Gagal memuat tugas.');
            allTugas = await res.json();
            tugasLoaded = true;
            updateFilterCounts();
            await renderTugas(getFiltered(currentFilter));
        } catch (error) {
            list.innerHTML = `<div class="alert alert-error">${escapeHTML(AppAsync.errorMessage(error, 'Gagal memuat tugas.'))}</div>`;
        } finally {
            tugasLoadPromise = null;
            AppAsync.finishOperation(operationId);
        }
    })();
    return tugasLoadPromise;
}

function getFiltered(filter) {
    const byStatus = filter === 'semua'
        ? allTugas
        : allTugas.filter(b => b.status === filter);
    const query = currentSearchQuery.trim().toLowerCase();
    if (!query) return byStatus;

    return byStatus.filter(b => {
        const nomor = String(b.nomor_berkas || '').toLowerCase();
        const pemohon = String(b.nama_pemohon || '').toLowerCase();
        return nomor.includes(query) || pemohon.includes(query);
    });
}

function filterTugas(filter) {
    currentFilter = filter;
    document.getElementById('filter-dropdown').value = filter;
    document.querySelectorAll('.petugas-filter-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    renderTugas(getFiltered(filter));
}

function handlePetugasSearch(value) {
    currentSearchQuery = value || '';
    const clearBtn = document.getElementById('petugas-search-clear');
    if (clearBtn) {
        clearBtn.style.display = currentSearchQuery.trim() ? 'inline-grid' : 'none';
    }
    renderTugas(getFiltered(currentFilter));
}

function clearPetugasSearch() {
    const input = document.getElementById('petugas-search');
    if (input) {
        input.value = '';
        input.focus();
    }
    handlePetugasSearch('');
}

function updateFilterCounts() {
    const count = (filter) => filter === 'semua'
        ? allTugas.length
        : allTugas.filter(b => b.status === filter).length;
    ['semua', 'pending', 'rescheduled_by_user', 'rescheduled_by_petugas', 'jadwal_fix', 'selesai', 'ditolak', 'dibatalkan'].forEach(filter => {
        const el = document.getElementById('count-' + filter);
        if (el) el.textContent = `(${count(filter)})`;
    });
}

function updateLocalTugas(id, changes) {
    const index = allTugas.findIndex(item => item.id === Number(id));
    if (index < 0) return false;
    allTugas[index] = { ...allTugas[index], ...changes };
    updateFilterCounts();
    renderTugas(getFiltered(currentFilter));
    return true;
}

function actionIcon(type) {
    const icons = {
        confirm: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="m8 12 3 3 5-6"></path></svg>',
        reschedule: '<svg viewBox="0 0 24 24"><path d="M8 2v4"></path><path d="M16 2v4"></path><rect x="3.5" y="5" width="17" height="16" rx="2.5"></rect><path d="M3.5 10h17"></path><path d="M8 15h6"></path><path d="m13 12 3 3-3 3"></path></svg>',
        reject: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="m15 9-6 6"></path><path d="m9 9 6 6"></path></svg>',
        location: '<svg viewBox="0 0 24 24"><path d="M12 21s7-5.4 7-12a7 7 0 0 0-14 0c0 6.6 7 12 7 12Z"></path><circle cx="12" cy="9" r="2.5"></circle></svg>',
        contact: '<svg viewBox="0 0 24 24"><path d="M7.5 19.5 4 20.5l1-3.3A8 8 0 1 1 7.5 19.5Z"></path><path d="M9 9.5c.5 2 2.5 4 4.5 4.5l1.2-1.2 2 1.1c.2.1.3.4.2.6-.4 1-1.2 1.6-2.4 1.6-3.7 0-6.7-3-6.7-6.7 0-1.2.6-2 1.6-2.4.2-.1.5 0 .6.2l1.1 2L9 9.5Z"></path></svg>',
        result: '<svg viewBox="0 0 24 24"><path d="M4 20h4l10.5-10.5a2.4 2.4 0 0 0-3.4-3.4L4 17v3Z"></path><path d="m13.5 7.5 3 3"></path><path d="M12 20h8"></path></svg>'
    };
    return `<span class="action-icon" aria-hidden="true">${icons[type] || icons.confirm}</span>`;
}

function renderTugas(data) {
    const list = document.getElementById('tugas-list');
    const emptyMessage = currentSearchQuery.trim()
        ? 'Tidak ada tugas yang cocok dengan pencarian'
        : 'Tidak ada tugas untuk filter ini';
    const emptyHtml = `
            <div class="empty-state">
                <div class="empty-icon empty-icon-svg" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                        <path d="M6 3h9l3 3v15H6Z"></path>
                        <path d="M15 3v4h4"></path>
                        <path d="M9 12h6"></path>
                        <path d="M9 16h4"></path>
                    </svg>
                </div>
                <p>${emptyMessage}</p>
            </div>`;
    return AppAsync.renderList(list, data, b => {
        const perluKonfirmasi = ['pending', 'rescheduled_by_user'].includes(b.status);
        const bisaInputHasil = b.status === 'jadwal_fix';
        const mapsUrl = safeMapsUrl(b.koordinat_maps);
        const noWa = b.no_telepon ? String(b.no_telepon).replace(/^0/, '62').replace(/\D/g, '') : null;
        const waUrl = noWa ? 'https://wa.me/' + encodeURIComponent(noWa) : null;

        return `
        <article class="tugas-card tugas-card-modern status-${b.status}">
            <section class="tugas-identity">
                <div class="tugas-nomor">#${escapeHTML(b.nomor_berkas)}</div>
                ${badgeStatus(b.status)}
                <div class="tugas-date-block">
                    <span class="date-icon"></span>
                    <strong>${formatDate(b.tanggal_fix || b.tanggal_diminta)}</strong>
                    <small>Tgl Pemeriksaan</small>
                </div>
            </section>

            <section class="tugas-detail-panel">
                <div class="tugas-detail-row">
                    <span>Pemohon</span><b>:</b><strong>${escapeHTML(b.nama_pemohon)}</strong>
                </div>
                <div class="tugas-detail-row">
                    <span>No. HP</span><b>:</b><strong>${escapeHTML(b.no_telepon || '-')}</strong>
                </div>
                <div class="tugas-detail-row">
                    <span>Lokasi</span><b>:</b><strong>${escapeHTML(b.nama_kecamatan)}, ${escapeHTML(b.nama_kelurahan)}</strong>
                </div>
                <div class="tugas-detail-row">
                    <span>Alamat</span><b>:</b><strong>${escapeHTML(b.alamat_lokasi || '-')}</strong>
                </div>
                <div class="tugas-detail-row">
                    <span>Catatan</span><b>:</b><strong>${escapeHTML(b.catatan_lapangan || '-')}</strong>
                </div>
            </section>

            <section class="tugas-info-box">
                <h4>Info Berkas</h4>
                <div><span>Nomor Berkas</span><b>:</b><strong>${escapeHTML(b.nomor_berkas)}</strong></div>
                <div><span>Tanggal Berkas</span><b>:</b><strong>${formatDate(b.tanggal_berkas || b.created_at)}</strong></div>
                <div><span>Status Berkas</span><b>:</b><strong>${badgeLabel(b.status)}</strong></div>
                <div><span>Jadwal Ditetapkan</span><b>:</b><strong>${b.tanggal_fix ? formatDate(b.tanggal_fix) : '-'}</strong></div>
            </section>

            <section class="tugas-action-panel">
                <div class="action-panel-title">Tindak Lanjut Berkas</div>
                ${perluKonfirmasi ? `
                <button class="action-row action-confirm" onclick="openKonfirmasi(${b.id})">
                    ${actionIcon('confirm')}<strong>Konfirmasi</strong><small>Tetapkan jadwal pemeriksaan</small>
                </button>
                <button class="action-row action-reschedule" onclick="openTolak(${b.id})">
                    ${actionIcon('reschedule')}<strong>Ubah Jadwal</strong><small>Ubah tanggal pemeriksaan</small>
                </button>
                <button class="action-row action-reject" onclick="openTolakBerkas(${b.id})">
                    ${actionIcon('reject')}<strong>Tolak Berkas</strong><small>Tolak permohonan berkas</small>
                </button>` : ''}
                ${bisaInputHasil ? `
                ${mapsUrl
                ? `<a href="${mapsUrl}" target="_blank" class="action-row action-location">${actionIcon('location')}<strong>Cek Lokasi</strong><small>Buka koordinat pemeriksaan</small></a>`
                : `<button class="action-row action-location" disabled>${actionIcon('location')}<strong>Cek Lokasi</strong><small>Koordinat belum tersedia</small></button>`}
                ${waUrl
                ? `<a href="${waUrl}" target="_blank" class="action-row action-contact">${actionIcon('contact')}<strong>Hubungi Pemohon</strong><small>Kirim pesan WhatsApp</small></a>`
                : `<button class="action-row action-contact" disabled>${actionIcon('contact')}<strong>Hubungi Pemohon</strong><small>No. HP belum tersedia</small></button>`}
                <button class="action-row action-result" onclick="goToInputHasil(${Number(b.id)})">
                    ${actionIcon('result')}<strong>Input Hasil</strong><small>Simpan hasil pemeriksaan</small>
                </button>` : ''}
                ${!perluKonfirmasi && !bisaInputHasil && b.status !== 'rescheduled_by_petugas' && b.status !== 'selesai' && b.status !== 'dibatalkan' ? `
                <p class="action-note">Tidak ada aksi lanjutan untuk status ini.</p>` : ''}
                ${b.status === 'rescheduled_by_petugas' ? `<p class="action-note">Menunggu konfirmasi ulang dari pemohon.</p>` : ''}
                ${b.status === 'selesai' ? `<p class="action-note success">Pemeriksaan telah selesai.</p>` : ''}
                ${b.status === 'dibatalkan' ? `<p class="action-note">Permohonan dibatalkan oleh pemohon.</p>` : ''}
            </section>
        </article>`;
    }, { chunkSize: 25, emptyHtml });
}

function openKonfirmasi(id) {
    selectedBookingId = id;
    const b = allTugas.find(x => x.id === id);
    document.getElementById('konfirmasi-detail').innerHTML = `
        <div class="info-box">
            <div class="info-box-row"><span>Berkas</span><strong>${escapeHTML(b.nomor_berkas)}</strong></div>
            <div class="info-box-row"><span>Pemohon</span><strong>${escapeHTML(b.nama_pemohon)}</strong></div>
            <div class="info-box-row"><span>Lokasi</span><strong>${escapeHTML(b.nama_kecamatan)}, ${escapeHTML(b.nama_kelurahan)}</strong></div>
            <div class="info-box-row"><span>Tanggal</span><strong>${formatDate(b.tanggal_diminta)}</strong></div>
        </div>`;
    document.getElementById('konfirmasi-error').style.display = 'none';
    document.getElementById('modal-konfirmasi').classList.add('show');
}

async function submitKonfirmasi() {
    const errEl = document.getElementById('konfirmasi-error');
    const btn = document.getElementById('btn-submit-konfirmasi');
    errEl.style.display = 'none';
    if (!setPetugasButtonLoading(btn, true, 'Mengonfirmasi...')) return;
    try {
        const res = await apiFetch('/api/petugas/konfirmasi/' + selectedBookingId, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.message; errEl.style.display = 'block'; return; }
        closeModal('modal-konfirmasi', true);
        const booking = allTugas.find(item => item.id === Number(selectedBookingId));
        updateLocalTugas(selectedBookingId, {
            status: 'jadwal_fix',
            tanggal_fix: booking?.tanggal_diminta || null
        });
        loadNotifikasi();
    } catch (error) {
        errEl.textContent = AppAsync.errorMessage(error, 'Konfirmasi jadwal gagal.');
        errEl.style.display = 'block';
    } finally {
        setPetugasButtonLoading(btn, false);
    }
}

function openTolak(id) {
    selectedBookingId = id;
    document.getElementById('tolak-tanggal').value = '';
    document.getElementById('tolak-alasan').value = '';
    document.getElementById('tolak-tanggal').min = today;
    document.getElementById('tolak-error').style.display = 'none';
    document.getElementById('modal-tolak').classList.add('show');
}

async function submitTolak() {
    const tanggal_baru = document.getElementById('tolak-tanggal').value;
    const alasan = document.getElementById('tolak-alasan').value.trim();
    const errEl = document.getElementById('tolak-error');
    const btn = document.getElementById('btn-submit-tolak');
    errEl.style.display = 'none';
    if (!tanggal_baru) { errEl.textContent = 'Tanggal baru wajib diisi'; errEl.style.display = 'block'; return; }
    if (!alasan) { errEl.textContent = 'Alasan penggantian jadwal wajib diisi'; errEl.style.display = 'block'; return; }
    const booking = allTugas.find(x => x.id === selectedBookingId);
    if (booking && dateOnly(booking.tanggal_diminta) === tanggal_baru) {
        errEl.textContent = 'Tanggal baru harus berbeda dari jadwal yang sedang berlaku';
        errEl.style.display = 'block';
        return;
    }
    if (!setPetugasButtonLoading(btn, true, 'Menyimpan...')) return;
    try {
        const res = await apiFetch('/api/petugas/tolak/' + selectedBookingId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tanggal_baru, alasan })
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.message; errEl.style.display = 'block'; return; }
        closeModal('modal-tolak', true);
        updateLocalTugas(selectedBookingId, {
            status: 'rescheduled_by_petugas',
            tanggal_diminta: tanggal_baru,
            tanggal_fix: null,
            last_reschedule_by: 'petugas',
            last_reschedule_alasan: alasan
        });
        loadNotifikasi();
    } catch (error) {
        errEl.textContent = AppAsync.errorMessage(error, 'Perubahan jadwal gagal.');
        errEl.style.display = 'block';
    } finally {
        setPetugasButtonLoading(btn, false);
    }
}

function openTolakBerkas(id) {
        selectedBookingId = id;
        const b = allTugas.find(x => x.id === id);
        document.getElementById('tolak-berkas-detail').innerHTML = `
<div class="info-box">
    <div class="info-box-row"><span>Berkas</span><strong>${escapeHTML(b.nomor_berkas)}</strong></div>
    <div class="info-box-row"><span>Pemohon</span><strong>${escapeHTML(b.nama_pemohon)}</strong></div>
    <div class="info-box-row"><span>Lokasi</span><strong>${escapeHTML(b.nama_kecamatan)}, ${escapeHTML(b.nama_kelurahan)}</strong></div>
    <div class="info-box-row"><span>Tgl Diminta</span><strong>${formatDate(b.tanggal_diminta)}</strong></div>
</div>`;
        document.getElementById('tolak-berkas-alasan').value = '';
        document.getElementById('tolak-berkas-error').style.display = 'none';
        document.getElementById('modal-tolak-berkas').classList.add('show');
    }

    async function submitTolakBerkas() {
        const alasan = document.getElementById('tolak-berkas-alasan').value.trim();
        const errEl = document.getElementById('tolak-berkas-error');
        const btn = document.getElementById('btn-submit-tolak-berkas');
        errEl.style.display = 'none';

        if (!alasan) {
            errEl.textContent = 'Alasan penolakan wajib diisi';
            errEl.style.display = 'block';
            return;
        }
        if (!setPetugasButtonLoading(btn, true, 'Menolak...')) return;
        try {
            const res = await apiFetch('/api/petugas/tolak-berkas/' + selectedBookingId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ alasan })
            });
            const data = await res.json();
            if (!res.ok) {
                errEl.textContent = data.message;
                errEl.style.display = 'block';
                return;
            }
            closeModal('modal-tolak-berkas', true);
            updateLocalTugas(selectedBookingId, { status: 'ditolak' });
            loadNotifikasi();
        } catch (error) {
            errEl.textContent = AppAsync.errorMessage(error, 'Penolakan berkas gagal.');
            errEl.style.display = 'block';
        } finally {
            setPetugasButtonLoading(btn, false);
        }
    }

async function loadBerkasDropdown() {
    try {
        if (!tugasLoaded) await loadTugas();
        const fixList = allTugas.filter(b => b.status === 'jadwal_fix');
        const sel = document.getElementById('hasil-berkas-select');
        sel.innerHTML = '<option value="">-- Pilih Berkas (Jadwal Ditetapkan) --</option>'
            + fixList.map(b => '<option value="' + Number(b.id)
                + '" data-nomor="' + escapeHTML(b.nomor_berkas)
                + '" data-pemohon="' + escapeHTML(b.nama_pemohon)
                + '" data-lokasi="' + escapeHTML(b.nama_kecamatan) + ', ' + escapeHTML(b.nama_kelurahan)
                + '" data-tgl="' + escapeHTML(b.tanggal_fix)
                + '">' + escapeHTML(b.nomor_berkas) + ' - ' + escapeHTML(b.nama_pemohon) + '</option>').join('');
        if (fixList.length === 0) {
            sel.innerHTML = '<option value="">Tidak ada berkas dengan Jadwal Ditetapkan</option>';
        }
    } catch (error) {
        const sel = document.getElementById('hasil-berkas-select');
        sel.innerHTML = `<option value="">${escapeHTML(AppAsync.errorMessage(error, 'Gagal memuat berkas'))}</option>`;
    }
}

function goToInputHasil(bookingId) {
    showPage('hasil');
    setTimeout(() => {
        const sel = document.getElementById('hasil-berkas-select');
        sel.value = bookingId;
        onBerkasChange();
    }, 300);
}

function onBerkasChange() {
    const sel = document.getElementById('hasil-berkas-select');
    const opt = sel.options[sel.selectedIndex];
    const infoEl = document.getElementById('hasil-info');
    const contentEl = document.getElementById('hasil-info-content');
    if (!sel.value) { infoEl.style.display = 'none'; return; }
    contentEl.innerHTML =
        '<div class="info-box-row"><span>No. Berkas</span><strong>' + escapeHTML(opt.dataset.nomor) + '</strong></div>' +
        '<div class="info-box-row"><span>Pemohon</span><strong>' + escapeHTML(opt.dataset.pemohon) + '</strong></div>' +
        '<div class="info-box-row"><span>Lokasi</span><strong>' + escapeHTML(opt.dataset.lokasi) + '</strong></div>' +
        '<div class="info-box-row"><span>Tgl Fix</span><strong>' + formatDate(opt.dataset.tgl) + '</strong></div>';
    infoEl.style.display = 'block';
}

async function submitHasil() {
    const bookingId = document.getElementById('hasil-berkas-select').value;
    const errEl = document.getElementById('hasil-error');
    const sucEl = document.getElementById('hasil-success');
    const btn = document.getElementById('btn-submit-hasil');
    errEl.style.display = 'none';
    sucEl.style.display = 'none';
    if (!bookingId) { errEl.textContent = 'Pilih berkas terlebih dahulu'; errEl.style.display = 'block'; return; }
    const formData = new FormData();
    const fotoLokasi = document.getElementById('foto_lokasi').files[0];
    const fotoRisalah = document.getElementById('foto_risalah').files[0];
    if (fotoLokasi) formData.append('foto_lokasi', fotoLokasi);
    if (fotoRisalah) formData.append('foto_risalah', fotoRisalah);
    formData.append('catatan_lapangan', document.getElementById('catatan_lapangan').value);
    if (!setPetugasButtonLoading(btn, true, 'Menyimpan...')) return;
    const progress = document.getElementById('hasil-upload-progress');
    const progressBar = document.getElementById('hasil-upload-progress-bar');
    const progressLabel = document.getElementById('hasil-upload-progress-label');
    progress.classList.add('is-visible');
    progressBar.style.width = '0%';
    progressLabel.textContent = 'Menyiapkan unggahan...';
    try {
        const result = await AppAsync.uploadWithProgress('/api/petugas/hasil/' + bookingId, {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrfToken() },
            body: formData,
            onProgress: percent => {
                progressBar.style.width = percent + '%';
                progressLabel.textContent = `Mengunggah ${percent}%`;
            }
        });
        if (!result.ok) {
            errEl.textContent = result.data?.message || 'Hasil pemeriksaan gagal disimpan.';
            errEl.style.display = 'block';
            return;
        }
        progressBar.style.width = '100%';
        progressLabel.textContent = 'Unggahan selesai';
        sucEl.textContent = 'Hasil pemeriksaan berhasil disimpan!';
        sucEl.style.display = 'block';
        updateLocalTugas(bookingId, { status: 'selesai' });
        resetHasil();
        setTimeout(() => { sucEl.style.display = 'none'; loadBerkasDropdown(); }, 2000);
    } catch (error) {
        errEl.textContent = AppAsync.errorMessage(error, 'Hasil pemeriksaan gagal disimpan.');
        errEl.style.display = 'block';
    } finally {
        window.setTimeout(() => progress.classList.remove('is-visible'), 600);
        setPetugasButtonLoading(btn, false);
    }
}

function resetHasil() {
    document.getElementById('hasil-berkas-select').value = '';
    document.getElementById('foto_lokasi').value = '';
    document.getElementById('foto_risalah').value = '';
    document.getElementById('catatan_lapangan').value = '';
    document.getElementById('hasil-info').style.display = 'none';
    document.getElementById('hasil-error').style.display = 'none';
}

function closeModal(id, force = false) {
    if (AppAsync.isBusy() && !force) return;
    document.getElementById(id).classList.remove('show');
}
// Sesi berada di cookie httpOnly, jadi keluar harus dilakukan server.
// Menghapus localStorage saja tidak membatalkan sesi apa pun.
function logout(button) {
    const btn = button || document.getElementById('btn-petugas-logout');
    if (!setPetugasButtonLoading(btn, true, 'Keluar...')) return;
    akhiriSesi('/login-petugas');
}

function dateOnly(d) {
    if (!d) return '';
    const raw = String(d);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    const parsed = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(parsed.getTime())) {
        const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
        return match ? match[0] : '';
    }

    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Makassar',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(parsed);
}






function badgeStatus(status) {
    const label = {
        pending: 'Menunggu Konfirmasi',
        rescheduled_by_user: 'Jadwal Diubah Pemohon',
        rescheduled_by_petugas: 'Jadwal Diubah Petugas',
        jadwal_fix: 'Jadwal Ditetapkan',
        selesai: 'Selesai',
        ditolak: 'Ditolak',
        dibatalkan: 'Dibatalkan'
    };
    return '<span class="badge badge-' + status + '">' + (label[status] || status) + '</span>';
}

function badgeLabel(status) {
    const label = {
        pending: 'Menunggu Konfirmasi',
        rescheduled_by_user: 'Jadwal Diubah Pemohon',
        rescheduled_by_petugas: 'Jadwal Diubah Petugas',
        jadwal_fix: 'Jadwal Ditetapkan',
        selesai: 'Selesai',
        ditolak: 'Ditolak',
        dibatalkan: 'Dibatalkan'
    };
    return label[status] || status || '-';
}

loadTugas();
loadNotifikasi();
setInterval(loadNotifikasi, 30000);
