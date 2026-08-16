/* Logika halaman admin. Dipindah dari public/pages/admin.html supaya
   bisa di-lint, di-cache browser, dan di-review terpisah dari markup.
   Skrip klasik (bukan module) agar fungsi tetap global untuk onclick="...". */

    const token = localStorage.getItem('token');
    const nama = localStorage.getItem('nama');
    const role = localStorage.getItem('role');

    if (!token || role !== 'admin') {
        localStorage.clear();
        window.location.href = '/login-petugas';
    }

    document.getElementById('sidebar-nama').textContent = nama;

    let allBerkas = [];
    let allPetugas = [];
    let wilayahData = { kecamatan: [], kelurahan: [] };
    let selectedDeleteBerkas = null;
    let selectedStatusPetugas = null;
    let selectedDeletePetugas = null;
    let activeAdminPage = 'dashboard';
    const loadedAdminPages = {
        dashboard: false,
        berkas: false,
        petugas: false,
        kuota: false
    };
    const kuotaResultCache = {};
    const adminLoadPromises = {};
    let bookingsLoadPromise = null;

    function setAdminButtonLoading(button, isLoading, label = 'Memproses...') {
        return AppAsync.setButtonLoading(button, isLoading, label);
    }

    function setAdminSidebarOpen(isOpen) {
        document.body.classList.toggle('admin-sidebar-open', isOpen);
        const toggle = document.getElementById('admin-sidebar-toggle');
        if (toggle) {
            toggle.setAttribute('aria-expanded', String(isOpen));
            toggle.setAttribute('aria-label', isOpen ? 'Tutup menu admin' : 'Buka menu admin');
        }
    }

    function toggleAdminSidebar() {
        setAdminSidebarOpen(!document.body.classList.contains('admin-sidebar-open'));
    }

    function closeAdminSidebar() {
        setAdminSidebarOpen(false);
    }

    // ============================================================
    // NAVIGASI
    // ============================================================
    function showPage(page) {
        if (activeAdminPage === page && loadedAdminPages[page]) {
            if (window.matchMedia('(max-width: 720px)').matches) closeAdminSidebar();
            return;
        }
        activeAdminPage = page;

        ['dashboard', 'berkas', 'petugas', 'kuota'].forEach(p => {
            document.getElementById('page-' + p).style.display = p === page ? 'block' : 'none';
        });
        document.querySelectorAll('.nav-item').forEach((el, i) => {
            el.classList.toggle('active', i === ['dashboard', 'berkas', 'petugas', 'kuota'].indexOf(page));
        });
        if (window.matchMedia('(max-width: 720px)').matches) closeAdminSidebar();
        if (page === 'dashboard') loadDashboard();
        if (page === 'berkas') loadBerkas();
        if (page === 'petugas') loadPetugas();
        if (page === 'kuota') loadWilayahKuota();
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAdminSidebar();
    });

    // ============================================================
    // API HELPER
    // ============================================================
    async function apiFetch(url, options = {}) {
        const res = await AppAsync.fetchWithTimeout(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token,
                ...(options.headers || {})
            }
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

    // ============================================================
    // DASHBOARD
    // ============================================================
    async function loadBookingsData(force = false) {
        const hasCache = loadedAdminPages.dashboard || loadedAdminPages.berkas;
        if (hasCache && !force) return allBerkas;
        if (bookingsLoadPromise && !force) return bookingsLoadPromise;

        bookingsLoadPromise = (async () => {
            const response = await apiFetch('/api/admin/bookings');
            if (!response.ok) throw await AppAsync.responseError(response, 'Gagal memuat berkas.');
            allBerkas = await response.json();
            return allBerkas;
        })();
        try {
            return await bookingsLoadPromise;
        } finally {
            bookingsLoadPromise = null;
        }
    }

    function renderDashboard() {
        document.getElementById('stat-total').textContent = allBerkas.length;
        document.getElementById('stat-pending').textContent = allBerkas.filter(b => b.status === 'pending').length;
        document.getElementById('stat-rescheduled-user').textContent = allBerkas.filter(b => b.status === 'rescheduled_by_user').length;
        document.getElementById('stat-rescheduled-petugas').textContent = allBerkas.filter(b => b.status === 'rescheduled_by_petugas').length;
        document.getElementById('stat-fix').textContent = allBerkas.filter(b => b.status === 'jadwal_fix').length;
        document.getElementById('stat-selesai').textContent = allBerkas.filter(b => b.status === 'selesai').length;
        document.getElementById('stat-ditolak').textContent = allBerkas.filter(b => b.status === 'ditolak').length;
        document.getElementById('stat-dibatalkan').textContent = allBerkas.filter(b => b.status === 'dibatalkan').length;

        return AppAsync.renderList(document.getElementById('tabel-dashboard'), allBerkas.slice(0, 8), b => `
            <tr>
                <td><strong>${escapeHTML(b.nomor_berkas)}</strong></td>
                <td>${escapeHTML(b.nama_pemohon)}</td>
                <td>${escapeHTML(b.nama_kecamatan)}</td>
                <td>${escapeHTML(b.nama_kelurahan)}</td>
                <td>${escapeHTML(b.nama_petugas)}</td>
                <td>${formatDate(b.tanggal_diminta)}</td>
                <td>${badgeStatus(b.status)}</td>
            </tr>`, {
            chunkSize: 8,
            emptyHtml: `<tr><td colspan="7"><div class="empty-state">
                ${adminIcon('emptyFile', 'empty-icon empty-icon-svg')}<p>Belum ada berkas</p>
            </div></td></tr>`
        });
    }

    async function loadDashboard(force = false) {
        if (loadedAdminPages.dashboard && !force) return;
        // Navigasi menu tidak memunculkan overlay global; tabel sudah punya spinner inline.
        try {
            await loadBookingsData(force);
            await renderDashboard();
            loadedAdminPages.dashboard = true;
        } catch (error) {
            document.getElementById('tabel-dashboard').innerHTML =
                `<tr><td colspan="7"><div class="alert alert-error">${escapeHTML(AppAsync.errorMessage(error, 'Gagal memuat dashboard.'))}</div></td></tr>`;
        }
    }

    // ============================================================
    // SEMUA BERKAS
    // ============================================================
    async function loadBerkas(force = false) {
        if (loadedAdminPages.berkas && !force) return;
        const tbody = document.getElementById('tabel-berkas');
        // Navigasi menu tidak memunculkan overlay global; tabel sudah punya spinner inline.
        try {
            await loadBookingsData(force);
            await renderBerkas(allBerkas);
            loadedAdminPages.berkas = true;
        } catch (error) {
            tbody.innerHTML = `<tr><td colspan="10"><div class="alert alert-error">${escapeHTML(AppAsync.errorMessage(error, 'Gagal memuat data.'))}</div></td></tr>`;
        }
    }

    function filterBerkas() {
        const q = document.getElementById('search-berkas').value.toLowerCase();
        const status = document.getElementById('filter-status').value;
        let filtered = allBerkas;
        if (q) filtered = filtered.filter(b =>
            b.nomor_berkas.toLowerCase().includes(q) ||
            b.nama_pemohon.toLowerCase().includes(q)
        );
        if (status) filtered = filtered.filter(b => b.status === status);
        renderBerkas(filtered);
    }

    function renderBerkas(data) {
        const tbody = document.getElementById('tabel-berkas');
        return AppAsync.renderList(tbody, data, b => `
    <tr>
      <td><strong>${escapeHTML(b.nomor_berkas)}</strong></td>
      <td>${escapeHTML(b.nama_pemohon)}</td>
      <td>${escapeHTML(b.nama_kecamatan)}</td>
      <td>${escapeHTML(b.nama_kelurahan)}</td>
      <td>${escapeHTML(b.nama_petugas)}</td>
      <td>${formatDate(b.tanggal_diminta)}</td>
      <td>${b.tanggal_fix ? formatDate(b.tanggal_fix) : '<span style="color:#aaa">-</span>'}</td>
      <td style="text-align:center">${b.reschedule_count}x</td>
      <td>${badgeStatus(b.status)}</td>
      <td class="table-actions">
        <button type="button" class="berkas-icon-button berkas-icon-info"
            title="Detail Berkas" aria-label="Detail Berkas"
            onclick="lihatDetail(${b.id})">
            ${adminIcon('info', 'berkas-action-icon')}
        </button>
        <button type="button" class="berkas-icon-button berkas-icon-delete"
            title="Hapus Berkas" aria-label="Hapus Berkas"
            onclick="openHapusBerkas(${b.id})">
            ${adminIcon('trash', 'berkas-action-icon')}
        </button>
      </td>
    </tr>`, {
            chunkSize: 40,
            emptyHtml: `<tr><td colspan="10"><div class="empty-state">
                ${adminIcon('emptyFile', 'empty-icon empty-icon-svg')}<p>Tidak ada data</p>
            </div></td></tr>`
        });
    }


    async function lihatDetail(id) {
        const body = document.getElementById('modal-detail-body');
        const operationId = AppAsync.startOperation('Memuat detail berkas...');
        body.innerHTML = '<div class="loading"><span class="spinner"></span> Memuat detail...</div>';
        document.getElementById('modal-detail').classList.add('show');

        try {
            const res = await apiFetch('/api/admin/berkas/' + id);
            if (!res.ok) throw await AppAsync.responseError(res, 'Gagal memuat detail berkas.');
            const data = await res.json();
            const b = data.booking;

            body.innerHTML = `
    <!-- INFO BERKAS -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px">
        ${detailRow('No. Berkas', '<strong>' + escapeHTML(b.nomor_berkas) + '</strong>')}
        ${detailRow('Tgl Berkas', formatDate(b.tanggal_berkas))}
        ${detailRow('Nama Pemohon', escapeHTML(b.nama_pemohon))}
        ${detailRow('No. Telepon', escapeHTML(b.no_telepon))}
        ${detailRow('Email', escapeHTML(b.email_user))}
        ${detailRow('Kecamatan', escapeHTML(b.nama_kecamatan))}
        ${detailRow('Kelurahan', escapeHTML(b.nama_kelurahan))}
        ${detailRow('Petugas', escapeHTML(b.nama_petugas) + '<br><span style="font-size:11px;color:#888">NIP: ' + escapeHTML(b.nip) + '</span>')}
        ${detailRow('Tgl Diminta', formatDate(b.tanggal_diminta))}
        ${detailRow('Tgl Fix', b.tanggal_fix ? formatDate(b.tanggal_fix) : '-')}
        ${detailRow('Reschedule', b.reschedule_count + 'x')}
        ${detailRow('Status', badgeStatus(b.status))}
    </div>

    ${b.alamat_lokasi ? `
    <div style="margin-bottom:24px">
        <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;margin-bottom:6px">Alamat Lokasi</div>
        <div style="background:#f8fafc;border-radius:8px;padding:10px 14px;font-size:13px;color:#334155">${escapeHTML(b.alamat_lokasi)}</div>
        ${safeMapsUrl(b.koordinat_maps) ? `<a href="${safeMapsUrl(b.koordinat_maps)}" target="_blank" rel="noopener noreferrer" 
            style="display:inline-flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;color:#2e86c1;text-decoration:none">
            ${adminIcon('mapPin')} Buka Google Maps <span aria-hidden="true">-&gt;</span></a>` : ''}
    </div>` : ''}

    <!-- TIMELINE -->
    <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;margin-bottom:14px;letter-spacing:0.06em">
        Alur & Riwayat Berkas
    </div>
    <div class="timeline-wrap">

        <!-- Booking dibuat -->
        <div class="timeline-item tl-created">
            <div class="tl-dot"></div>
            <div class="tl-content">
                <div class="tl-title">Permohonan Diajukan</div>
                <div class="tl-time">${formatDateTime(b.created_at)}</div>
                <div class="tl-desc">Pemohon <strong>${escapeHTML(b.nama_pemohon)}</strong> mengajukan permohonan pemeriksaan tanah kepada petugas <strong>${escapeHTML(b.nama_petugas)}</strong>.</div>
            </div>
        </div>

        <!-- Reschedule log -->
        ${data.reschedule_log.map(r => {
                const isDitolak = r.alasan && r.alasan.startsWith('[DITOLAK]');
                const isDibatalkan = r.alasan && r.alasan.startsWith('[DIBATALKAN]');
                const alasan = r.alasan ? r.alasan.replace('[DITOLAK] ', '').replace('[DIBATALKAN] ', '') : null;
                if (isDitolak) return `
                <div class="timeline-item tl-danger">
                    <div class="tl-dot"></div>
                    <div class="tl-content">
                        <div class="tl-title">Ditolak</div>
                        <div class="tl-time">${formatDateTime(r.created_at)}</div>
                        ${alasan ? `<div class="tl-desc">Alasan: <strong>${escapeHTML(alasan)}</strong></div>` : ''}
                    </div>
                </div>`;
                if (isDibatalkan) return `
                <div class="timeline-item tl-muted">
                    <div class="tl-dot"></div>
                    <div class="tl-content">
                        <div class="tl-title">Dibatalkan Pemohon</div>
                        <div class="tl-time">${formatDateTime(r.created_at)}</div>
                        ${alasan ? `<div class="tl-desc">Alasan: <strong>${escapeHTML(alasan)}</strong></div>` : ''}
                    </div>
                </div>`;
                return `
                <div class="timeline-item tl-${r.diminta_oleh === 'user' ? 'user' : 'petugas'}">
                    <div class="tl-dot"></div>
                    <div class="tl-content">
                        <div class="tl-title">${r.diminta_oleh === 'user' ? 'Jadwal Diubah Pemohon' : 'Jadwal Diubah Petugas'}</div>
                        <div class="tl-time">${formatDateTime(r.created_at)}</div>
                        <div class="tl-desc">
                            Dari <strong>${formatDate(r.tanggal_lama)}</strong> -&gt; <strong>${formatDate(r.tanggal_baru)}</strong>
                            ${alasan ? '<br>Alasan: ' + escapeHTML(alasan) : ''}
                        </div>
                    </div>
                </div>`;
            }).join('')}

        <!-- Status saat ini -->
        ${b.status === 'jadwal_fix' ? `
        <div class="timeline-item tl-info">
            <div class="tl-dot"></div>
            <div class="tl-content">
                <div class="tl-title">Jadwal Ditetapkan</div>
                <div class="tl-time">${formatDate(b.tanggal_fix)}</div>
                <div class="tl-desc">Jadwal pemeriksaan telah fix. Petugas akan melakukan peninjauan.</div>
            </div>
        </div>` : ''}

        <!-- Hasil pemeriksaan -->
        ${data.hasil ? `
        <div class="timeline-item tl-success">
            <div class="tl-dot"></div>
            <div class="tl-content">
                <div class="tl-title">Selesai</div>
                <div class="tl-time">${formatDateTime(data.hasil.created_at)}</div>
                ${data.hasil.catatan_lapangan ? `<div class="tl-desc">Catatan: ${escapeHTML(data.hasil.catatan_lapangan)}</div>` : ''}
                <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
                    ${data.hasil.foto_lokasi ? `<a href="/uploads/${encodeURIComponent(data.hasil.foto_lokasi)}" target="_blank" 
                        style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#2e86c1;text-decoration:none">${adminIcon('image')} Foto Lokasi</a>` : ''}
                    ${data.hasil.foto_risalah ? `<a href="/uploads/${encodeURIComponent(data.hasil.foto_risalah)}" target="_blank"
                        style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#2e86c1;text-decoration:none">${adminIcon('document')} Foto Risalah</a>` : ''}
                </div>
            </div>
        </div>` : ''}

        <!-- Status ditolak final -->
        ${b.status === 'ditolak' ? `
        <div class="timeline-item tl-danger">
            <div class="tl-dot"></div>
            <div class="tl-content">
                <div class="tl-title">Ditolak</div>
                <div class="tl-time">${formatDateTime(b.updated_at)}</div>
            </div>
        </div>` : ''}

        ${b.status === 'dibatalkan' ? `
        <div class="timeline-item tl-muted">
            <div class="tl-dot"></div>
            <div class="tl-content">
                <div class="tl-title">Dibatalkan</div>
                <div class="tl-time">${formatDateTime(b.updated_at)}</div>
                <div class="tl-desc">Permohonan dibatalkan oleh pemohon.</div>
            </div>
        </div>` : ''}

    </div>`;
        } catch (error) {
            body.innerHTML = `<div class="alert alert-error">${escapeHTML(AppAsync.errorMessage(error, 'Gagal memuat detail berkas.'))}</div>`;
        } finally {
            AppAsync.finishOperation(operationId);
        }
    }

    function detailRow(label, value) {
        return `<div>
    <div style="font-size:12px;color:#888;margin-bottom:2px">${label}</div>
    <div style="font-size:14px;font-weight:500">${value}</div>
  </div>`;
    }

    function openHapusBerkas(id) {
        const berkas = allBerkas.find(b => b.id === id);
        selectedDeleteBerkas = berkas || { id, nomor_berkas: '-', nama_pemohon: '-' };

        document.getElementById('delete-berkas-summary').innerHTML = `
            <div><span>No. Berkas</span><strong>${escapeHTML(selectedDeleteBerkas.nomor_berkas || '-')}</strong></div>
            <div><span>Pemohon</span><strong>${escapeHTML(selectedDeleteBerkas.nama_pemohon || '-')}</strong></div>
            <div><span>Status</span>${selectedDeleteBerkas.status ? badgeStatus(selectedDeleteBerkas.status) : '-'}</div>
        `;
        document.getElementById('delete-berkas-confirm').value = '';
        document.getElementById('delete-berkas-error').style.display = 'none';
        document.getElementById('btn-confirm-delete-berkas').disabled = true;
        document.getElementById('modal-hapus-berkas').classList.add('show');
    }

    function validateDeleteBerkasConfirm() {
        const value = document.getElementById('delete-berkas-confirm').value;
        document.getElementById('btn-confirm-delete-berkas').disabled = value !== 'HAPUS';
    }

    async function submitHapusBerkas() {
        const errEl = document.getElementById('delete-berkas-error');
        const btn = document.getElementById('btn-confirm-delete-berkas');
        const confirmation = document.getElementById('delete-berkas-confirm').value;

        errEl.style.display = 'none';
        if (!selectedDeleteBerkas || confirmation !== 'HAPUS') {
            errEl.textContent = 'Ketik HAPUS dengan huruf besar untuk menghapus berkas.';
            errEl.style.display = 'block';
            return;
        }

        if (!setAdminButtonLoading(btn, true, 'Menghapus...')) return;
        try {
            const res = await apiFetch(`/api/admin/berkas/${selectedDeleteBerkas.id}`, {
                method: 'DELETE',
                body: JSON.stringify({ confirmation })
            });
            const data = await res.json();
            if (!res.ok) {
                errEl.textContent = data.message || 'Gagal menghapus berkas';
                errEl.style.display = 'block';
                return;
            }
            closeModal('modal-hapus-berkas');
            closeModal('modal-detail');
            const deletedId = Number(selectedDeleteBerkas.id);
            selectedDeleteBerkas = null;
            allBerkas = allBerkas.filter(item => item.id !== deletedId);
            if (loadedAdminPages.berkas) await renderBerkas(allBerkas);
            if (loadedAdminPages.dashboard) await renderDashboard();
        } catch (error) {
            errEl.textContent = AppAsync.errorMessage(error, 'Terjadi kesalahan saat menghapus berkas.');
            errEl.style.display = 'block';
        } finally {
            setAdminButtonLoading(btn, false, 'Hapus Permanen');
            validateDeleteBerkasConfirm();
        }
    }

    // ============================================================
    // KELOLA PETUGAS
    // ============================================================
    function setPetugasValidationState(input, feedback, state, message) {
        if (!input) return;
        input.classList.toggle('petugas-input-invalid', state === 'error');
        input.classList.toggle('petugas-input-valid', state === 'valid');
        if (!feedback) return;
        feedback.classList.toggle('is-error', state === 'error');
        feedback.classList.toggle('is-valid', state === 'valid');
        feedback.textContent = message;
    }

    function validatePetugasNip(inputId, feedbackId, showEmpty = false) {
        const input = document.getElementById(inputId);
        const feedback = document.getElementById(feedbackId);
        const value = input.value.replace(/\D/g, '').slice(0, 18);
        input.value = value;

        if (!value) {
            const message = showEmpty
                ? 'NIP wajib diisi.'
                : 'NIP harus terdiri dari 18 digit angka.';
            setPetugasValidationState(input, feedback, showEmpty ? 'error' : 'neutral', message);
            return { valid: false, value, message };
        }

        if (value.length !== 18) {
            const message = `NIP masih ${value.length} digit. NIP wajib tepat 18 digit.`;
            setPetugasValidationState(input, feedback, 'error', message);
            return { valid: false, value, message };
        }

        const message = 'Format NIP valid.';
        setPetugasValidationState(input, feedback, 'valid', message);
        return { valid: true, value, message };
    }

    function validatePetugasEmail(inputId, feedbackId, showEmpty = false) {
        const input = document.getElementById(inputId);
        const feedback = document.getElementById(feedbackId);
        const value = input.value.trim().toLowerCase();
        const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value);

        if (!value) {
            const message = showEmpty ? 'Email wajib diisi.' : 'Masukkan alamat email aktif.';
            setPetugasValidationState(input, feedback, showEmpty ? 'error' : 'neutral', message);
            return { valid: false, value, message };
        }

        if (!valid) {
            const message = 'Format email belum valid. Contoh: nama@contoh.com';
            setPetugasValidationState(input, feedback, 'error', message);
            return { valid: false, value, message };
        }

        input.value = value;
        const message = 'Format email valid.';
        setPetugasValidationState(input, feedback, 'valid', message);
        return { valid: true, value, message };
    }

    function validatePetugasName(inputId, feedbackId, showEmpty = false) {
        const input = document.getElementById(inputId);
        const feedback = document.getElementById(feedbackId);
        const value = input.value.trim();

        if (!value) {
            const message = showEmpty
                ? 'Nama lengkap wajib diisi.'
                : 'Nama lengkap minimal 3 karakter.';
            setPetugasValidationState(input, feedback, showEmpty ? 'error' : 'neutral', message);
            return { valid: false, value, message };
        }

        if (value.length < 3) {
            const message = 'Nama lengkap minimal 3 karakter.';
            setPetugasValidationState(input, feedback, 'error', message);
            return { valid: false, value, message };
        }

        const message = 'Nama lengkap valid.';
        setPetugasValidationState(input, feedback, 'valid', message);
        return { valid: true, value, message };
    }

    function validatePetugasPassword(inputId, feedbackId, required = false) {
        const input = document.getElementById(inputId);
        const feedback = document.getElementById(feedbackId);
        const value = input.value;

        if (!value) {
            const message = required
                ? 'Password wajib diisi.'
                : 'Kosongkan jika tidak ingin mengubah password. Minimal 6 karakter jika diisi.';
            setPetugasValidationState(input, feedback, required ? 'error' : 'neutral', message);
            return { valid: !required, value, message };
        }

        if (value.length < 8) {
            const message = 'Password minimal 8 karakter.';
            setPetugasValidationState(input, feedback, 'error', message);
            return { valid: false, value, message };
        }

        const message = required ? 'Password valid.' : 'Password baru valid.';
        setPetugasValidationState(input, feedback, 'valid', message);
        return { valid: true, value, message };
    }

    function bindPetugasIdentityValidation() {
        [
            ['new-nip', 'new-nip-feedback'],
            ['edit-nip', 'edit-nip-feedback']
        ].forEach(([inputId, feedbackId]) => {
            document.getElementById(inputId)?.addEventListener('input', () => {
                validatePetugasNip(inputId, feedbackId);
            });
        });

        [
            ['new-email', 'new-email-feedback'],
            ['edit-email', 'edit-email-feedback']
        ].forEach(([inputId, feedbackId]) => {
            document.getElementById(inputId)?.addEventListener('input', () => {
                validatePetugasEmail(inputId, feedbackId);
            });
        });

        [
            ['new-nama', 'new-nama-feedback'],
            ['edit-nama', 'edit-nama-feedback']
        ].forEach(([inputId, feedbackId]) => {
            document.getElementById(inputId)?.addEventListener('input', () => {
                validatePetugasName(inputId, feedbackId);
            });
        });

        [
            ['new-password', 'new-password-feedback', true],
            ['edit-password', 'edit-password-feedback', false]
        ].forEach(([inputId, feedbackId, required]) => {
            document.getElementById(inputId)?.addEventListener('input', () => {
                validatePetugasPassword(inputId, feedbackId, required);
            });
        });
    }

    function togglePetugasPassword(inputId, button) {
        const input = document.getElementById(inputId);
        const visible = input.type === 'password';
        input.type = visible ? 'text' : 'password';
        button.classList.toggle('is-visible', visible);
        button.setAttribute('aria-pressed', String(visible));
        button.setAttribute('aria-label', visible ? 'Sembunyikan password' : 'Tampilkan password');
        button.title = visible ? 'Sembunyikan password' : 'Tampilkan password';
    }

    function resetPetugasPasswordVisibility() {
        const input = document.getElementById('edit-password');
        const button = document.querySelector('.petugas-password-toggle');
        if (!input || !button) return;
        input.type = 'password';
        button.classList.remove('is-visible');
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-label', 'Tampilkan password');
        button.title = 'Tampilkan password';
    }

    function renderPetugas() {
        const tbody = document.getElementById('tabel-petugas');
        return AppAsync.renderList(tbody, allPetugas, p => `
            <tr>
                <td>${escapeHTML(p.nip)}</td>
                <td><strong>${escapeHTML(p.nama_lengkap)}</strong></td>
                <td>${escapeHTML(p.email)}</td>
                <td>${escapeHTML(p.no_hp)}</td>
                <td>
                    <span class="badge ${p.is_active ? 'badge-confirmed' : 'badge-ditolak'}">
                        ${p.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                </td>
                <td class="petugas-action-cell">
                    <div class="petugas-action-row">
                    <button type="button" class="petugas-icon-button petugas-icon-edit"
                        title="Edit Petugas" aria-label="Edit Petugas"
                        onclick="openEditPetugas(${p.id})">
                        ${adminIcon('pencil', 'petugas-action-icon')}
                    </button>
                    <button type="button"
                        class="petugas-icon-button ${p.is_active ? 'petugas-icon-disable' : 'petugas-icon-enable'}"
                        title="${p.is_active ? 'Nonaktifkan Petugas' : 'Aktifkan Petugas'}"
                        aria-label="${p.is_active ? 'Nonaktifkan Petugas' : 'Aktifkan Petugas'}"
                        onclick="openTogglePetugas(${p.id}, ${p.is_active ? 1 : 0})">
                        ${adminIcon('forbidden', 'petugas-action-icon')}
                    </button>
                    <button type="button" class="petugas-icon-button petugas-icon-delete"
                        title="Hapus Petugas" aria-label="Hapus Petugas"
                        onclick="openHapusPetugas(${p.id})">
                        ${adminIcon('trash', 'petugas-action-icon')}
                    </button>
                    </div>
                </td>
            </tr>`, {
            chunkSize: 40,
            emptyHtml: `<tr><td colspan="6"><div class="empty-state">
                ${adminIcon('users', 'empty-icon empty-icon-svg')}<p>Belum ada petugas</p>
            </div></td></tr>`
        });
    }

    async function loadPetugas(force = false) {
        if (loadedAdminPages.petugas && !force) return;
        const tbody = document.getElementById('tabel-petugas');
        // Navigasi menu tidak memunculkan overlay global; tabel sudah punya spinner inline.
        try {
            const res = await apiFetch('/api/admin/petugas');
            if (!res.ok) throw await AppAsync.responseError(res, 'Gagal memuat petugas.');
            allPetugas = await res.json();
            await renderPetugas();
            loadedAdminPages.petugas = true;
        } catch (error) {
            tbody.innerHTML = `<tr><td colspan="6"><div class="alert alert-error">${escapeHTML(AppAsync.errorMessage(error, 'Gagal memuat data.'))}</div></td></tr>`;
        }
    }

    async function tambahPetugas() {
        const nipResult = validatePetugasNip('new-nip', 'new-nip-feedback', true);
        const nameResult = validatePetugasName('new-nama', 'new-nama-feedback', true);
        const emailResult = validatePetugasEmail('new-email', 'new-email-feedback', true);
        const passwordResult = validatePetugasPassword('new-password', 'new-password-feedback', true);
        const nip = nipResult.value;
        const nama_lengkap = nameResult.value;
        const email = emailResult.value;
        const phoneResult = PhoneValidation.validateInput(
            'new-hp',
            'new-hp-feedback',
            { showEmpty: true }
        );
        const password = passwordResult.value;
        const errEl = document.getElementById('petugas-error');
        const sucEl = document.getElementById('petugas-success');
        const btn = document.getElementById('btn-add-petugas');
        errEl.style.display = 'none';
        sucEl.style.display = 'none';

        // Validasi per-field sudah menampilkan pesannya masing-masing di
        // bawah tiap input; kotak error utama hanya untuk error server.
        // Jika ada yang tidak valid, cukup fokuskan field pertama yang gagal.
        const firstInvalidAdd = [
            { valid: nipResult.valid, id: 'new-nip' },
            { valid: nameResult.valid, id: 'new-nama' },
            { valid: emailResult.valid, id: 'new-email' },
            { valid: phoneResult.valid, id: 'new-hp' },
            { valid: passwordResult.valid, id: 'new-password' }
        ].find(field => !field.valid);
        if (firstInvalidAdd) {
            document.getElementById(firstInvalidAdd.id).focus();
            return;
        }
        if (!setAdminButtonLoading(btn, true, 'Menyimpan...')) return;
        try {
            const res = await apiFetch('/api/admin/petugas', {
                method: 'POST',
                body: JSON.stringify({
                    nip,
                    nama_lengkap,
                    email,
                    no_hp: phoneResult.normalized,
                    password
                })
            });
            const data = await res.json();
            if (!res.ok) {
                errEl.textContent = data.message;
                errEl.style.display = 'block';
                return;
            }
            sucEl.textContent = 'Petugas berhasil ditambahkan';
            sucEl.style.display = 'block';
            ['new-nip', 'new-nama', 'new-email', 'new-hp', 'new-password']
                .forEach(id => document.getElementById(id).value = '');
            if (data.petugas) {
                allPetugas.unshift(data.petugas);
                await renderPetugas();
                loadedAdminPages.petugas = true;
            } else {
                await loadPetugas(true);
            }
        } catch (error) {
            errEl.textContent = AppAsync.errorMessage(error, 'Petugas gagal ditambahkan.');
            errEl.style.display = 'block';
        } finally {
            setAdminButtonLoading(btn, false);
        }
    }

    function openEditPetugas(id) {
        const p = allPetugas.find(x => x.id === id);
        if (!p) return;
        document.getElementById('edit-id').value = p.id;
        document.getElementById('edit-nip').value = p.nip || '';
        document.getElementById('edit-nama').value = p.nama_lengkap;
        document.getElementById('edit-email').value = p.email;
        document.getElementById('edit-hp').value = p.no_hp;
        validatePetugasNip('edit-nip', 'edit-nip-feedback');
        validatePetugasName('edit-nama', 'edit-nama-feedback');
        validatePetugasEmail('edit-email', 'edit-email-feedback');
        PhoneValidation.validateInput('edit-hp', 'edit-hp-feedback');
        document.getElementById('edit-password').value = '';
        validatePetugasPassword('edit-password', 'edit-password-feedback', false);
        resetPetugasPasswordVisibility();
        document.getElementById('edit-error').style.display = 'none';
        document.getElementById('modal-edit-petugas').classList.add('show');
    }

    async function submitEditPetugas() {
        const id = document.getElementById('edit-id').value;
        const nipResult = validatePetugasNip('edit-nip', 'edit-nip-feedback', true);
        const nameResult = validatePetugasName('edit-nama', 'edit-nama-feedback', true);
        const emailResult = validatePetugasEmail('edit-email', 'edit-email-feedback', true);
        const passwordResult = validatePetugasPassword('edit-password', 'edit-password-feedback', false);
        const nip = nipResult.value;
        const nama_lengkap = nameResult.value;
        const email = emailResult.value;
        const phoneResult = PhoneValidation.validateInput(
            'edit-hp',
            'edit-hp-feedback',
            { showEmpty: true }
        );
        const password = passwordResult.value;
        const errEl = document.getElementById('edit-error');
        const btn = document.getElementById('btn-edit-petugas');
        errEl.style.display = 'none';

        // Validasi per-field sudah menampilkan pesannya masing-masing di
        // bawah tiap input; kotak error utama hanya untuk error server.
        // Jika ada yang tidak valid, cukup fokuskan field pertama yang gagal.
        const firstInvalidEdit = [
            { valid: nipResult.valid, id: 'edit-nip' },
            { valid: nameResult.valid, id: 'edit-nama' },
            { valid: emailResult.valid, id: 'edit-email' },
            { valid: phoneResult.valid, id: 'edit-hp' },
            { valid: passwordResult.valid, id: 'edit-password' }
        ].find(field => !field.valid);
        if (firstInvalidEdit) {
            document.getElementById(firstInvalidEdit.id).focus();
            return;
        }
        if (!setAdminButtonLoading(btn, true, 'Menyimpan...')) return;
        try {
            const res = await apiFetch(`/api/admin/petugas/${id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    nip,
                    nama_lengkap,
                    email,
                    no_hp: phoneResult.normalized,
                    password
                })
            });
            const data = await res.json();
            if (!res.ok) {
                errEl.textContent = data.message;
                errEl.style.display = 'block';
                return;
            }
            closeModal('modal-edit-petugas');
            const index = allPetugas.findIndex(item => item.id === Number(id));
            if (index >= 0) {
                allPetugas[index] = {
                    ...allPetugas[index],
                    nip: data.petugas?.nip || nip,
                    nama_lengkap,
                    email,
                    no_hp: data.petugas?.no_hp || phoneResult.normalized
                };
                await renderPetugas();
            }
        } catch (error) {
            errEl.textContent = AppAsync.errorMessage(error, 'Data petugas gagal disimpan.');
            errEl.style.display = 'block';
        } finally {
            setAdminButtonLoading(btn, false);
        }
    }

    PhoneValidation.bind('new-hp', 'new-hp-feedback');
    PhoneValidation.bind('edit-hp', 'edit-hp-feedback');
    bindPetugasIdentityValidation();

    function openTogglePetugas(id, isActive) {
        const petugas = allPetugas.find(p => p.id === id);
        if (!petugas) return;

        selectedStatusPetugas = { id, isActive: Boolean(isActive), petugas };
        const action = isActive ? 'Nonaktifkan' : 'Aktifkan';
        const nextStatus = isActive ? 'Nonaktif' : 'Aktif';

        document.getElementById('status-petugas-title').textContent = `${action} Petugas`;
        document.getElementById('status-petugas-message').textContent = isActive
            ? 'Petugas yang dinonaktifkan tidak bisa login ke portal petugas.'
            : 'Petugas yang diaktifkan kembali bisa login dan menerima penugasan.';
        document.getElementById('status-petugas-summary').innerHTML = `
            <div><span>Nama</span><strong>${escapeHTML(petugas.nama_lengkap || '-')}</strong></div>
            <div><span>NIP</span><strong>${escapeHTML(petugas.nip || '-')}</strong></div>
            <div><span>Email</span><strong>${escapeHTML(petugas.email || '-')}</strong></div>
            <div><span>Status Baru</span><strong>${nextStatus}</strong></div>
        `;
        const errEl = document.getElementById('status-petugas-error');
        errEl.style.display = 'none';
        errEl.textContent = '';
        const btn = document.getElementById('btn-confirm-status-petugas');
        btn.className = `btn ${isActive ? 'btn-danger' : 'btn-success'}`;
        btn.innerHTML = action;
        delete btn.dataset.originalHtml;
        setAdminButtonLoading(btn, false);
        document.getElementById('modal-status-petugas').classList.add('show');
    }

    async function submitTogglePetugas() {
        if (!selectedStatusPetugas) return;

        const { id, isActive } = selectedStatusPetugas;
        const btn = document.getElementById('btn-confirm-status-petugas');
        const errEl = document.getElementById('status-petugas-error');

        errEl.style.display = 'none';
        if (!setAdminButtonLoading(btn, true, isActive ? 'Menonaktifkan...' : 'Mengaktifkan...')) return;
        try {
            const res = await apiFetch(`/api/admin/petugas/${id}/toggle`, { method: 'PATCH' });
            const data = await res.json();
            if (!res.ok) {
                errEl.textContent = data.message || 'Gagal mengubah status petugas';
                errEl.style.display = 'block';
                return;
            }
            closeModal('modal-status-petugas');
            const index = allPetugas.findIndex(item => item.id === Number(id));
            if (index >= 0) {
                allPetugas[index] = {
                    ...allPetugas[index],
                    is_active: data.petugas?.is_active ?? (isActive ? 0 : 1)
                };
                await renderPetugas();
            }
            selectedStatusPetugas = null;
        } catch (error) {
            errEl.textContent = AppAsync.errorMessage(error, 'Gagal mengubah status petugas.');
            errEl.style.display = 'block';
        } finally {
            setAdminButtonLoading(btn, false);
        }
    }

    function openHapusPetugas(id) {
        const petugas = allPetugas.find(p => p.id === id);
        if (!petugas) return;

        selectedDeletePetugas = petugas;
        document.getElementById('delete-petugas-summary').innerHTML = `
            <div><span>Nama</span><strong>${escapeHTML(petugas.nama_lengkap || '-')}</strong></div>
            <div><span>NIP</span><strong>${escapeHTML(petugas.nip || '-')}</strong></div>
            <div><span>Email</span><strong>${escapeHTML(petugas.email || '-')}</strong></div>
            <div><span>Status</span><strong>${petugas.is_active ? 'Aktif' : 'Nonaktif'}</strong></div>
        `;
        document.getElementById('delete-petugas-confirm').value = '';
        document.getElementById('delete-petugas-error').style.display = 'none';
        document.getElementById('btn-confirm-delete-petugas').disabled = true;
        const btn = document.getElementById('btn-confirm-delete-petugas');
        btn.innerHTML = 'Hapus Petugas';
        delete btn.dataset.originalHtml;
        setAdminButtonLoading(btn, false);
        document.getElementById('modal-hapus-petugas').classList.add('show');
    }

    function validateDeletePetugasConfirm() {
        const value = document.getElementById('delete-petugas-confirm').value;
        document.getElementById('btn-confirm-delete-petugas').disabled = value !== 'HAPUS';
    }

    async function submitHapusPetugas() {
        const errEl = document.getElementById('delete-petugas-error');
        const btn = document.getElementById('btn-confirm-delete-petugas');
        const confirmation = document.getElementById('delete-petugas-confirm').value;

        errEl.style.display = 'none';
        if (!selectedDeletePetugas || confirmation !== 'HAPUS') {
            errEl.textContent = 'Ketik HAPUS dengan huruf besar untuk menghapus petugas.';
            errEl.style.display = 'block';
            return;
        }

        if (!setAdminButtonLoading(btn, true, 'Menghapus...')) return;
        try {
            const res = await apiFetch(`/api/admin/petugas/${selectedDeletePetugas.id}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) {
                errEl.textContent = data.message || 'Gagal menghapus petugas';
                errEl.style.display = 'block';
                return;
            }
            closeModal('modal-hapus-petugas');
            const deletedId = Number(selectedDeletePetugas.id);
            selectedDeletePetugas = null;
            allPetugas = allPetugas.filter(item => item.id !== deletedId);
            await renderPetugas();
        } catch (error) {
            errEl.textContent = AppAsync.errorMessage(error, 'Terjadi kesalahan saat menghapus petugas.');
            errEl.style.display = 'block';
        } finally {
            setAdminButtonLoading(btn, false);
            validateDeletePetugasConfirm();
        }
    }

    // ============================================================
    // KELOLA KUOTA
    // ============================================================
    async function loadWilayahKuota(force = false) {
        if (loadedAdminPages.kuota && !force) {
            const activeTab = document.querySelector('.kuota-tab.active')?.id?.replace('ktab-', '') || 'kecamatan';
            lihatKuota(activeTab);
            return;
        }
        // Navigasi menu tidak memunculkan overlay global; panel kuota punya indikatornya sendiri.
        try {
            const petugasCached = loadedAdminPages.petugas;
            const [resWilayah, resPetugas] = await Promise.all([
                AppAsync.fetchWithTimeout('/api/admin/wilayah'),
                petugasCached ? Promise.resolve(null) : apiFetch('/api/admin/petugas')
            ]);
            if (!resWilayah.ok) throw await AppAsync.responseError(resWilayah, 'Gagal memuat wilayah.');
            if (resPetugas && !resPetugas.ok) throw await AppAsync.responseError(resPetugas, 'Gagal memuat petugas.');
            wilayahData = await resWilayah.json();
            if (resPetugas) allPetugas = await resPetugas.json();

            // Isi dropdown kecamatan
            const selKec = document.getElementById('kec-target');
            selKec.innerHTML = '<option value="">-- Pilih Kecamatan --</option>'
                + wilayahData.kecamatan.map(k => `<option value="${Number(k.id)}">${escapeHTML(k.nama_kecamatan)}</option>`).join('');

            // Isi filter kecamatan untuk kelurahan
            const selFilterKec = document.getElementById('kel-filter-kec');
            selFilterKec.innerHTML = '<option value="">-- Semua Kecamatan --</option>'
                + wilayahData.kecamatan.map(k => `<option value="${Number(k.id)}">${escapeHTML(k.nama_kecamatan)}</option>`).join('');
            const selLihatKec = document.getElementById('kel-lihat-kec');
            selLihatKec.innerHTML = '<option value="">-- Pilih Kecamatan --</option>'
                + wilayahData.kecamatan.map(k => `<option value="${Number(k.id)}">${escapeHTML(k.nama_kecamatan)}</option>`).join('');

            // Isi dropdown kelurahan (semua)
            filterKelurahanKuota();

            // Isi dropdown petugas
            const selPet = document.getElementById('pet-target');
            selPet.innerHTML = '<option value="">-- Pilih Petugas --</option>'
                + allPetugas.filter(p => p.is_active)
                    .map(p => `<option value="${Number(p.id)}">${escapeHTML(p.nama_lengkap)} (${escapeHTML(p.nip)})</option>`)
                    .join('');

            const today = new Date().toISOString().split('T')[0];
            document.getElementById('kec-tanggal').value = today;
            document.getElementById('kec-tanggal-selesai').value = today;
            document.getElementById('kel-tanggal').value = today;
            document.getElementById('kel-tanggal-selesai').value = today;
            document.getElementById('pet-tanggal').value = today;
            document.getElementById('pet-tanggal-selesai').value = today;
            document.getElementById('kec-lihat-tanggal').value = today;
            document.getElementById('kel-lihat-tanggal').value = today;
            document.getElementById('pet-lihat-tanggal').value = today;
            ['kecamatan', 'kelurahan', 'petugas'].forEach(toggleKuotaMode);

            // Auto load kuota hari ini untuk tab yang aktif
            loadedAdminPages.kuota = true;
            lihatKuota('kecamatan');

        } catch (error) {
            document.getElementById('kec-result').innerHTML =
                `<div class="alert alert-error">${escapeHTML(AppAsync.errorMessage(error, 'Data kuota gagal dimuat.'))}</div>`;
        }
    }

    function filterKelurahanKuota() {
        const kecId = document.getElementById('kel-filter-kec').value;
        const sel = document.getElementById('kel-target');
        const lihatKec = document.getElementById('kel-lihat-kec');
        sel.innerHTML = '<option value="">-- Pilih Kelurahan/Desa --</option>';
        const filtered = kecId
            ? wilayahData.kelurahan.filter(k => k.kecamatan_id == kecId)
            : wilayahData.kelurahan;
        filtered.forEach(k => {
            sel.innerHTML += `<option value="${Number(k.id)}">${escapeHTML(k.nama_kelurahan)}</option>`;
        });
        if (lihatKec && kecId) {
            lihatKec.value = kecId;
        }
    }

    function getKuotaPrefix(tipe) {
        return { kecamatan: 'kec', kelurahan: 'kel', petugas: 'pet' }[tipe];
    }

    function toggleKuotaMode(tipe) {
        const prefix = getKuotaPrefix(tipe);
        const modeEl = document.getElementById(prefix + '-mode');
        const rangeEl = document.getElementById(prefix + '-range-fields');
        if (!modeEl || !rangeEl) return;

        const isDaily = modeEl.value === 'daily';
        rangeEl.style.display = isDaily ? 'none' : 'grid';
    }

    function syncKuotaEndDate(tipe) {
        const prefix = getKuotaPrefix(tipe);
        const startEl = document.getElementById(prefix + '-tanggal');
        const endEl = document.getElementById(prefix + '-tanggal-selesai');
        if (!startEl || !endEl) return;

        endEl.min = startEl.value || '';
        if (startEl.value && (!endEl.value || endEl.value < startEl.value)) {
            endEl.value = startEl.value;
        }
    }

    async function simpanKuota(tipe, button) {
        const map = {
            kecamatan: { id: 'kec-target', mode: 'kec-mode', tgl: 'kec-tanggal', tglEnd: 'kec-tanggal-selesai', max: 'kec-max', unl: 'kec-unlimited', err: 'kec-error', suc: 'kec-success' },
            kelurahan: { id: 'kel-target', mode: 'kel-mode', tgl: 'kel-tanggal', tglEnd: 'kel-tanggal-selesai', max: 'kel-max', unl: 'kel-unlimited', err: 'kel-error', suc: 'kel-success' },
            petugas: { id: 'pet-target', mode: 'pet-mode', tgl: 'pet-tanggal', tglEnd: 'pet-tanggal-selesai', max: 'pet-max', unl: null, err: 'pet-kq-error', suc: 'pet-kq-success' },
        };
        const m = map[tipe];
        const id = document.getElementById(m.id).value;
        const mode = document.getElementById(m.mode).value;
        const tanggal_mulai = document.getElementById(m.tgl).value;
        const tanggal_selesai = document.getElementById(m.tglEnd).value || tanggal_mulai;
        const kuota_max = parseInt(document.getElementById(m.max).value);
        const is_unlimited = m.unl ? (document.getElementById(m.unl).checked ? 1 : 0) : 0;
        const errEl = document.getElementById(m.err);
        const sucEl = document.getElementById(m.suc);
        errEl.style.display = 'none';
        sucEl.style.display = 'none';

        if (!id || (mode !== 'daily' && (!tanggal_mulai || !tanggal_selesai))) {
            errEl.textContent = mode === 'daily'
                ? 'Pilih target terlebih dahulu'
                : 'Pilih target, tanggal mulai, dan tanggal selesai terlebih dahulu';
            errEl.style.display = 'block';
            return;
        }

        if (mode !== 'daily' && tanggal_selesai < tanggal_mulai) {
            errEl.textContent = 'Tanggal selesai tidak boleh sebelum tanggal mulai';
            errEl.style.display = 'block';
            return;
        }
        const submitButton = button || document.getElementById(`btn-kuota-${tipe}`);
        if (!setAdminButtonLoading(submitButton, true, 'Menyimpan...')) return;
        try {
            const res = await apiFetch('/api/admin/kuota', {
                method: 'POST',
                body: JSON.stringify({ tipe, id, mode, tanggal_mulai, tanggal_selesai, kuota_max, is_unlimited })
            });
            const data = await res.json();
            if (!res.ok) {
                errEl.textContent = data.message;
                errEl.style.display = 'block';
                return;
            }
            sucEl.textContent = data.message || 'Kuota berhasil disimpan';
            sucEl.style.display = 'block';
            // Auto refresh tampilan kuota aktif
            invalidateKuotaCache(tipe);
            await lihatKuota(tipe, true);
        } catch (error) {
            errEl.textContent = AppAsync.errorMessage(error, 'Kuota gagal disimpan.');
            errEl.style.display = 'block';
        } finally {
            setAdminButtonLoading(submitButton, false);
        }
    }

    function toggleUnlimitedKuota(tipe) {
        const map = {
            kecamatan: { max: 'kec-max', unl: 'kec-unlimited' },
            kelurahan: { max: 'kel-max', unl: 'kel-unlimited' },
        };
        const m = map[tipe];
        if (!m) return;

        const maxEl = document.getElementById(m.max);
        const unlimitedEl = document.getElementById(m.unl);
        const isUnlimited = unlimitedEl.checked;

        maxEl.disabled = isUnlimited;
        maxEl.classList.toggle('input-disabled', isUnlimited);
        if (isUnlimited) maxEl.value = '';
        if (!isUnlimited && !maxEl.value) maxEl.value = '10';
    }

    function getKuotaCacheKey(tipe) {
        const tglMap = { kecamatan: 'kec-lihat-tanggal', kelurahan: 'kel-lihat-tanggal', petugas: 'pet-lihat-tanggal' };
        const tanggal = document.getElementById(tglMap[tipe]).value;
        const kecamatanFilter = tipe === 'kelurahan'
            ? document.getElementById('kel-lihat-kec')?.value
            : '';

        return `${tipe}|${tanggal || ''}|${kecamatanFilter || ''}`;
    }

    function invalidateKuotaCache(tipe) {
        Object.keys(kuotaResultCache)
            .filter(key => !tipe || key.startsWith(`${tipe}|`))
            .forEach(key => delete kuotaResultCache[key]);
    }

    async function lihatKuota(tipe, force = false, button = null) {
        const tglMap = { kecamatan: 'kec-lihat-tanggal', kelurahan: 'kel-lihat-tanggal', petugas: 'pet-lihat-tanggal' };
        const resMap = { kecamatan: 'kec-result', kelurahan: 'kel-result', petugas: 'pet-result' };
        const tanggal = document.getElementById(tglMap[tipe]).value;
        const el = document.getElementById(resMap[tipe]);
        const kecamatanFilter = tipe === 'kelurahan'
            ? document.getElementById('kel-lihat-kec')?.value
            : '';
        const cacheKey = getKuotaCacheKey(tipe);

        if (!tanggal) {
            el.innerHTML = '<p style="color:#888;font-size:13px">Pilih tanggal terlebih dahulu.</p>';
            return;
        }
        if (tipe === 'kelurahan' && !kecamatanFilter) {
            el.innerHTML = '<p style="color:#888;font-size:13px">Pilih kecamatan untuk melihat kuota kelurahan.</p>';
            return;
        }

        if (!force && kuotaResultCache[cacheKey]) {
            el.innerHTML = kuotaResultCache[cacheKey];
            return;
        }
        if (adminLoadPromises[cacheKey]) return adminLoadPromises[cacheKey];

        el.innerHTML = '<div class="loading"><span class="spinner"></span> Memuat...</div>';
        // Tanpa overlay global: panel sudah menampilkan spinner inline di atas.
        if (button && !setAdminButtonLoading(button, true, 'Memuat...')) return;

        adminLoadPromises[cacheKey] = (async () => {
            try {
            const params = new URLSearchParams({ tanggal });
            if (tipe === 'kelurahan' && kecamatanFilter) {
                params.set('kecamatan_id', kecamatanFilter);
            }
            const res = await apiFetch(`/api/admin/kuota?${params.toString()}`);
            if (!res.ok) throw await AppAsync.responseError(res, 'Gagal memuat kuota.');
            const data = await res.json();

            let items = [];
            if (tipe === 'kecamatan') items = data.kecamatan;
            else if (tipe === 'kelurahan') items = data.kelurahan;
            else if (tipe === 'petugas') items = data.petugas;

            if (items.length === 0) {
                el.innerHTML = `<div class="empty-state">
    ${adminIcon('checkCircle', 'empty-icon empty-icon-svg')}
    <p style="font-size:13px">Tidak ada data untuk ditampilkan.</p>
</div>`;
                kuotaResultCache[cacheKey] = el.innerHTML;
                return;
            }

            const html = `<div style="display:flex;flex-direction:column;gap:8px">` +
                items.map(item => {
                    const nama = item.nama_kecamatan || item.nama_kelurahan || item.nama_lengkap;
                    const unlimited = Boolean(item.is_unlimited);
                    const terisi = Number(item.terisi || 0);
                    const max = Number(item.kuota_max || 0);
                    const pct = !unlimited && max > 0 ? Math.round((terisi / max) * 100) : 0;
                    const barColor = unlimited ? '#10B981' : pct >= 100 ? '#EF4444' : pct >= 70 ? '#F59E0B' : '#10B981';
                    const textColor = unlimited ? '#059669' : pct >= 100 ? '#DC2626' : pct >= 70 ? '#D97706' : '#059669';
                    const sub = tipe === 'kelurahan' ? `<span style="font-size:11px;color:#888">${item.nama_kecamatan || ''}</span>` : '';
                    const statusText = unlimited ? 'Unlimited' : `${terisi}/${max}`;

                    return `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
                    <div>
                        <div style="font-size:13px;font-weight:600;color:#1e293b">${nama}</div>
                        ${sub}
                    </div>
                    <span style="font-size:12px;font-weight:600;color:${textColor};background:${barColor}20;padding:2px 8px;border-radius:99px">
                        ${statusText}
                    </span>
                </div>
                ${!unlimited ? `
                <div style="height:6px;background:#e2e8f0;border-radius:99px;overflow:hidden">
                    <div style="height:100%;width:${Math.min(pct, 100)}%;background:${barColor};border-radius:99px;transition:width 0.3s"></div>
                </div>
                <div style="font-size:11px;color:#94a3b8;margin-top:4px">${terisi} slot terisi dari ${max} slot</div>
                ` : `<div style="font-size:11px;color:#059669">Kuota tidak dibatasi</div>`}
            </div>`;
                }).join('') + `</div>`;
            el.innerHTML = html;
            kuotaResultCache[cacheKey] = html;
            } catch (error) {
                el.innerHTML = `<div class="alert alert-error">${escapeHTML(AppAsync.errorMessage(error, 'Gagal memuat kuota.'))}</div>`;
            } finally {
                delete adminLoadPromises[cacheKey];
                if (button) setAdminButtonLoading(button, false);
            }
        })();
        return adminLoadPromises[cacheKey];
    }

    function switchKuotaTab(tab) {
        ['kecamatan', 'kelurahan', 'petugas'].forEach(t => {
            document.getElementById('kpanel-' + t).style.display = t === tab ? 'block' : 'none';
            document.getElementById('ktab-' + t).classList.toggle('active', t === tab);
        });
        lihatKuota(tab);
    }

    // ============================================================
    // HELPERS
    // ============================================================
    function adminIcon(name, className = 'admin-inline-icon') {
        const icons = {
            emptyFile: '<svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6Z"></path><path d="M15 3v4h4"></path><path d="M9 12h6"></path><path d="M9 16h4"></path></svg>',
            mapPin: '<svg viewBox="0 0 24 24"><path d="M12 21s7-5.4 7-12a7 7 0 0 0-14 0c0 6.6 7 12 7 12Z"></path><circle cx="12" cy="9" r="2.5"></circle></svg>',
            image: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="8.5" cy="10" r="1.5"></circle><path d="m21 15-4.5-4.5L9 18"></path></svg>',
            document: '<svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6Z"></path><path d="M15 3v4h4"></path><path d="M9 13h6"></path><path d="M9 17h5"></path></svg>',
            users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"></circle><path d="M3.5 20a5.5 5.5 0 0 1 11 0"></path><path d="M17 11.5a3 3 0 0 0 0-6"></path><path d="M18.5 20a4.5 4.5 0 0 0-3-4.25"></path></svg>',
            pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z"></path><path d="m13.5 6.5 4 4"></path></svg>',
            info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 8h.01"></path></svg>',
            forbidden: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="m5.6 5.6 12.8 12.8"></path></svg>',
            trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M6 7l1 14h10l1-14"></path><path d="M9 7V4h6v3"></path></svg>',
            checkCircle: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="m8 12 3 3 5-6"></path></svg>'
        };
        return `<span class="${className}" aria-hidden="true">${icons[name] || icons.emptyFile}</span>`;
    }

    function closeModal(id) { document.getElementById(id).classList.remove('show'); }
    function logout(button) {
        if (!setAdminButtonLoading(button || document.getElementById('btn-admin-logout'), true, 'Keluar...')) return;
        window.setTimeout(() => {
            localStorage.clear();
            window.location.href = '/login-petugas';
        }, 100);
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
        return `<span class="badge badge-${status}">${label[status] || status}</span>`;
    }

    // INIT
    loadDashboard();
