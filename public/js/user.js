/* Logika halaman user. Dipindah dari public/pages/user.html supaya
   bisa di-lint, di-cache browser, dan di-review terpisah dari markup.
   Skrip klasik (bukan module): fungsi sengaja global agar dapat dipanggil
   penghubung aksi di common.js lewat atribut data-click/data-change/data-input. */

const nama = localStorage.getItem('nama');
const role = localStorage.getItem('role');

// Penjaga tampilan saja - otorisasi sesungguhnya ada di cookie sesi yang
// diperiksa server. Nilai di localStorage tidak lagi memuat token.
if (role !== 'user') {
    localStorage.clear();
    window.location.href = '/';
}

if (document.getElementById('header-avatar') && nama) {
    document.getElementById('header-avatar').textContent = nama.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const namaDepan = nama.split(' ')[0];
    document.getElementById('header-name-short').textContent = namaDepan;
}

function toggleProfileMenu() {
    const wrapper = document.querySelector('.profile-dropdown-wrapper');
    wrapper.classList.toggle('active');
}

window.addEventListener('click', function (e) {
    const wrapper = document.querySelector('.profile-dropdown-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
        wrapper.classList.remove('active');
    }
});

let wilayahData = { kecamatan: [], kelurahan: [] };
let selectedBookingId = null;
let riwayatBookings = [];
let profilLoaded = false;
let riwayatLoaded = false;
let profilLoadPromise = null;
let initialFormDataLoaded = false;
let initialFormDataPromise = null;
let kuotaTimeout = null;
const today = new Date().toISOString().split('T')[0];
document.getElementById('tanggal_diminta').min = today;
document.getElementById('tanggal_berkas').max = today;

function setButtonLoading(button, isLoading, label = 'Memproses...') {
    return AppAsync.setButtonLoading(button, isLoading, label);
}

let map = null;
let marker = null;
let focusMapRequestId = 0;
const MAP_DEFAULT_CENTER = { lat: -2.6000000, lng: 121.1700000, zoom: 10 };
const KECAMATAN_CENTER = {
    angkona: { lat: -2.6100000, lng: 121.1900000, zoom: 12 },
    burau: { lat: -2.8200000, lng: 120.9100000, zoom: 12 },
    kalaena: { lat: -2.4900000, lng: 120.9700000, zoom: 12 },
    malili: { lat: -2.6350000, lng: 121.0950000, zoom: 12 },
    mangkutana: { lat: -2.4100000, lng: 120.8050000, zoom: 12 },
    nuha: { lat: -2.4850000, lng: 121.3750000, zoom: 11 },
    tomoni: { lat: -2.5450000, lng: 120.7700000, zoom: 12 },
    'tomoni timur': { lat: -2.5350000, lng: 120.8450000, zoom: 12 },
    towuti: { lat: -2.7600000, lng: 121.4550000, zoom: 11 },
    wasponda: { lat: -2.5250000, lng: 121.2100000, zoom: 12 },
    wotu: { lat: -2.6000000, lng: 120.8050000, zoom: 12 }
};
const geocodeCache = new Map();

// ============================================================
// NOTIFIKASI
// ============================================================
let notifOpen = false;

async function loadNotifikasi() {
    try {
        const res = await apiFetch('/api/auth/notifications');
        if (!res.ok) throw await AppAsync.responseError(res, 'Notifikasi gagal dimuat.');
        const data = await res.json();

        const badge = document.getElementById('notif-badge');
        const list = document.getElementById('notif-list');

        if (data.unread > 0) {
            badge.textContent = data.unread > 99 ? '99+' : data.unread;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }

        if (data.notifications.length === 0) {
            list.innerHTML = '<div class="notif-empty">Belum ada notifikasi</div>';
            return;
        }

        list.innerHTML = data.notifications.map((n, index) => {
            const pesan = stripHTML(n.pesan);
            const isLong = pesan.length > 92;
            return `
    <div class="notif-item ${n.is_read ? '' : 'unread'} ${isLong ? 'is-expandable' : ''}"
        data-index="${index}"${isLong ? ` data-click="openNotifDetail" data-click-args='[${index}]'` : ''}>
        <div class="notif-item-judul">${escapeHTML(n.judul)}</div>
        <div class="notif-item-pesan">${escapeHTML(pesan)}</div>
        ${isLong ? '<button class="notif-more" type="button">Lihat lengkap</button>' : ''}
        <div class="notif-item-waktu">${formatWaktu(n.created_at)}</div>
    </div>
`;
        }).join('');
        window.latestNotifikasi = data.notifications.map(n => ({
            judul: n.judul,
            pesan: stripHTML(n.pesan),
            waktu: formatWaktu(n.created_at)
        }));
    } catch (err) {
        if (notifOpen) {
            document.getElementById('notif-list').innerHTML =
                `<div class="notif-empty">${escapeHTML(AppAsync.errorMessage(err, 'Notifikasi gagal dimuat.'))}</div>`;
        }
    }
}

function openNotifDetail(index) {
    const n = (window.latestNotifikasi || [])[index];
    if (!n) return;
    document.getElementById('notif-detail-title').textContent = n.judul || 'Detail Notifikasi';
    document.getElementById('notif-detail-message').textContent = n.pesan || '-';
    document.getElementById('notif-detail-time').textContent = n.waktu || '';
    document.getElementById('modal-notif-detail').classList.add('show');
}

function toggleNotif() {
    notifOpen = !notifOpen;
    const dropdown = document.getElementById('notif-dropdown');
    dropdown.style.display = notifOpen ? 'block' : 'none';
    if (notifOpen) {
        loadNotifikasi();
        markAllRead();
    }
}

async function markAllRead() {
    try {
        const res = await apiFetch('/api/auth/notifications/read', { method: 'PATCH' });
        if (!res.ok) throw await AppAsync.responseError(res, 'Notifikasi gagal ditandai dibaca.');
        setTimeout(loadNotifikasi, 500);
    } catch (err) {
        console.error('Gagal mark read', err);
    }
}

document.addEventListener('click', (e) => {
    const wrap = document.getElementById('notif-btn');
    if (wrap && !wrap.contains(e.target) && notifOpen) {
        document.getElementById('notif-dropdown').style.display = 'none';
        notifOpen = false;
    }
});




function userIcon(name, className = 'user-inline-icon') {
    const icons = {
        check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="m8 12 3 3 5-6"></path></svg>',
        error: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="m15 9-6 6"></path><path d="m9 9 6 6"></path></svg>',
        mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 7 8 6 8-6"></path></svg>',
        phone: '<svg viewBox="0 0 24 24"><path d="M7 4h10v16H7Z"></path><path d="M10 18h4"></path></svg>',
        emptyFile: '<svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6Z"></path><path d="M15 3v4h4"></path><path d="M9 12h6"></path><path d="M9 16h4"></path></svg>'
    };
    return `<span class="${className}" aria-hidden="true">${icons[name] || icons.emptyFile}</span>`;
}

function initMap(lat = MAP_DEFAULT_CENTER.lat, lng = MAP_DEFAULT_CENTER.lng, zoom = MAP_DEFAULT_CENTER.zoom) {
    if (map) {
        setTimeout(() => map.invalidateSize(), 200);
        return;
    }
    setTimeout(() => {
        map = L.map('map-picker', { attributionControl: false }).setView([lat, lng], zoom);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

        marker = L.marker([lat, lng], { draggable: true }).addTo(map);

        marker.on('dragend', () => {
            const latlng = marker.getLatLng();
            map.setView(latlng, map.getZoom()); // re-center peta kecil
            updateKoordinat(latlng);
            // sync ke modal kalau terbuka
            if (mapModal && document.getElementById('modal-map').style.display !== 'none') {
                mapModal.setView(latlng, mapModal.getZoom());
                markerModal.setLatLng(latlng);
                updateKoordinatModal(latlng);
            }
        });

        map.on('click', (e) => {
            marker.setLatLng(e.latlng);
            map.setView(e.latlng, map.getZoom()); // re-center
            updateKoordinat(e.latlng);
            if (mapModal && document.getElementById('modal-map').style.display !== 'none') {
                mapModal.setView(e.latlng, mapModal.getZoom());
                markerModal.setLatLng(e.latlng);
                updateKoordinatModal(e.latlng);
            }
        });

        updateKoordinat({ lat, lng });
    }, 200);
}

function normalizeWilayahName(name) {
    return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function getById(items, id) {
    return items.find(item => String(item.id) === String(id));
}

function getRowCoordinate(row) {
    if (!row) return null;
    const lat = parseFloat(row.lat ?? row.latitude ?? row.koordinat_lat);
    const lng = parseFloat(row.lng ?? row.longitude ?? row.koordinat_lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return null;
}

function getKecamatanCenter(kecId) {
    const kec = getById(wilayahData.kecamatan, kecId);
    const dbCoord = getRowCoordinate(kec);
    if (dbCoord) return { ...dbCoord, zoom: 12 };
    return KECAMATAN_CENTER[normalizeWilayahName(kec?.nama_kecamatan)];
}

function getEstimatedKelurahanCenter(kecId, kelId) {
    const kecCenter = getKecamatanCenter(kecId);
    if (!kecCenter) return null;

    const kelList = wilayahData.kelurahan.filter(k => String(k.kecamatan_id) === String(kecId));
    const index = Math.max(0, kelList.findIndex(k => String(k.id) === String(kelId)));
    const total = Math.max(kelList.length, 1);
    const angle = (Math.PI * 2 * index) / total;
    const ring = 0.010 + ((index % 3) * 0.006);

    return {
        lat: kecCenter.lat + Math.sin(angle) * ring,
        lng: kecCenter.lng + Math.cos(angle) * ring,
        zoom: 14
    };
}

function getSelectedOptionText(id) {
    const el = document.getElementById(id);
    return el.options[el.selectedIndex]?.text || '';
}

function setMapLocation(lat, lng, zoom = 13) {
    if (!map || !marker) {
        initMap(lat, lng, zoom);
        updateKoordinat({ lat, lng });
        return;
    }

    if (map && marker) {
        map.setView([lat, lng], zoom);
        marker.setLatLng([lat, lng]);
        setTimeout(() => map.invalidateSize(), 80);
    }

    if (mapModal && markerModal && document.getElementById('modal-map').style.display !== 'none') {
        mapModal.setView([lat, lng], zoom);
        markerModal.setLatLng([lat, lng]);
        setTimeout(() => mapModal.invalidateSize(), 80);
        updateKoordinatModal({ lat, lng });
    } else {
        updateKoordinat({ lat, lng });
    }
}

async function geocodeWilayah(query) {
    const key = normalizeWilayahName(query);
    if (!key) return null;
    if (geocodeCache.has(key)) return geocodeCache.get(key);

    try {
        const url = 'https://nominatim.openstreetmap.org/search?q='
            + encodeURIComponent(query)
            + '&format=json&limit=1&countrycodes=id';
        const res = await AppAsync.fetchWithTimeout(url);
        const data = await res.json();
        const found = data.length > 0
            ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
            : null;
        geocodeCache.set(key, found);
        return found;
    } catch (err) {
        console.error('Geocode wilayah gagal', err);
        return null;
    }
}

async function focusMapToSelection(level = 'kecamatan') {
    const requestId = ++focusMapRequestId;
    const kecId = document.getElementById('kecamatan_id').value;
    const kelId = document.getElementById('kelurahan_id').value;
    const kecNama = getSelectedOptionText('kecamatan_id');
    const kelNama = getSelectedOptionText('kelurahan_id');
    const kecCenter = getKecamatanCenter(kecId);

    if (level === 'kecamatan' && kecCenter) {
        setMapLocation(kecCenter.lat, kecCenter.lng, kecCenter.zoom);
    }

    if (level === 'kelurahan' && kelId && kelNama && kecNama) {
        const kel = getById(wilayahData.kelurahan, kelId);
        const dbCoord = getRowCoordinate(kel);
        if (dbCoord) {
            setMapLocation(dbCoord.lat, dbCoord.lng, 14);
            return;
        }

        const estimated = getEstimatedKelurahanCenter(kecId, kelId);
        if (estimated) {
            setMapLocation(estimated.lat, estimated.lng, estimated.zoom);
        }

        const query = `${kelNama}, ${kecNama}, Kabupaten Luwu Timur, Sulawesi Selatan, Indonesia`;
        const found = await geocodeWilayah(query);
        if (requestId !== focusMapRequestId) return;
        if (found) {
            setMapLocation(found.lat, found.lng, 14);
            return;
        }
        if (!estimated && kecCenter) setMapLocation(kecCenter.lat, kecCenter.lng, kecCenter.zoom);
    }
}

function updateKoordinat(latlng) {
    const lat = parseFloat(latlng.lat).toFixed(7);
    const lng = parseFloat(latlng.lng).toFixed(7);
    document.getElementById('koordinat_lat').value = lat;
    document.getElementById('koordinat_lng').value = lng;
    document.getElementById('koordinat_maps').value = lat + ',' + lng;
}

async function geocodeAlamat() {
    if (!map) return;
    const kecEl = document.getElementById('kecamatan_id');
    const kelEl = document.getElementById('kelurahan_id');
    const alamat = document.getElementById('alamat_lokasi').value.trim();

    const kecNama = kecEl.options[kecEl.selectedIndex]?.text || '';
    const kelNama = kelEl.options[kelEl.selectedIndex]?.text || '';
    const parts = [alamat, kelNama, kecNama, 'Luwu Timur', 'Sulawesi Selatan'].filter(Boolean);
    const query = parts.join(', ');

    try {
        const res = await AppAsync.fetchWithTimeout('https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(query) + '&format=json&limit=1');
        const data = await res.json();
        if (data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lng = parseFloat(data[0].lon);
            // Update peta utama
            map.setView([lat, lng], 14);
            marker.setLatLng([lat, lng]);
            updateKoordinat({ lat, lng });
            // Sync ke modal kalau terbuka
            if (mapModal && document.getElementById('modal-map').style.display !== 'none') {
                mapModal.setView([lat, lng], 14);
                markerModal.setLatLng([lat, lng]);
                updateKoordinatModal({ lat, lng });
            }
        }
    } catch (err) {
        console.error('Geocode gagal', err);
    }
}
// ============================================================
// MODAL PETA FULLSCREEN
// ============================================================
let mapModal = null;
let markerModal = null;

function bukaMapModal() {
    const modalEl = document.getElementById('modal-map');
    modalEl.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    const lat = parseFloat(document.getElementById('koordinat_lat').value) || -2.5;
    const lng = parseFloat(document.getElementById('koordinat_lng').value) || 121.5;

    setTimeout(() => {
        if (!mapModal) {
            mapModal = L.map('map-modal-inner', { attributionControl: false }).setView([lat, lng], map ? map.getZoom() : 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapModal);

            markerModal = L.marker([lat, lng], { draggable: true }).addTo(mapModal);

            markerModal.on('dragend', () => {
                const latlng = markerModal.getLatLng();
                mapModal.setView(latlng, mapModal.getZoom()); // re-center modal
                updateKoordinatModal(latlng);
                // sync ke peta kecil
                if (map && marker) {
                    map.setView(latlng, map.getZoom());
                    marker.setLatLng(latlng);
                }
            });

            mapModal.on('click', (e) => {
                markerModal.setLatLng(e.latlng);
                mapModal.setView(e.latlng, mapModal.getZoom()); // re-center
                updateKoordinatModal(e.latlng);
                if (map && marker) {
                    map.setView(e.latlng, map.getZoom());
                    marker.setLatLng(e.latlng);
                }
            });

            updateKoordinatModal({ lat, lng });
        } else {
            mapModal.setView([lat, lng], mapModal.getZoom());
            markerModal.setLatLng([lat, lng]);
            mapModal.invalidateSize();
        }
    }, 150);
}

function updateKoordinatModal(latlng) {
    const lat = parseFloat(latlng.lat).toFixed(7);
    const lng = parseFloat(latlng.lng).toFixed(7);

    // Update koordinat utama juga
    document.getElementById('koordinat_lat').value = lat;
    document.getElementById('koordinat_lng').value = lng;
    document.getElementById('koordinat_maps').value = lat + ',' + lng;

    // Update teks di modal
    document.getElementById('modal-koordinat-text').textContent = lat + ', ' + lng;

    // Sync marker peta utama
    if (marker) marker.setLatLng([lat, lng]);
}

function tutupMapModal() {
    document.getElementById('modal-map').style.display = 'none';
    document.body.style.overflow = '';

    // Sync posisi dari modal ke peta kecil setelah tutup
    if (mapModal && map && marker) {
        const latlng = markerModal.getLatLng();
        map.setView(latlng, map.getZoom());
        marker.setLatLng(latlng);
        setTimeout(() => map.invalidateSize(), 100);
    }
}

function showPage(page) {
    const pages = ['booking', 'profil'];

    pages.forEach(p => {
        const el = document.getElementById('page-' + p);
        const btn = document.getElementById('nav-' + p);
        if (p === page) {
            el.style.display = 'block';
            // Re-trigger animasi
            el.style.animation = 'none';
            el.offsetHeight; // force reflow
            el.style.animation = '';
        } else {
            el.style.display = 'none';
        }
        btn.classList.toggle('active', p === page);
    });

    if (page === 'profil') loadProfil();
    if (page === 'booking') {
        loadWilayahDanPetugas();
        initMap();
    }
}

async function apiFetch(url, options = {}) {
    const res = await AppAsync.fetchWithTimeout(url, {
        ...options,
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            ...headerSesi(options.method),
            ...(options.headers || {})
        }
    });
        if (res.status === 403) {
            const salinan = res.clone();
            const data = await salinan.json().catch(() => ({}));
            if (data.code === 'WAJIB_GANTI_SANDI') {
                bukaGantiSandi(true);
                throw new AppAsync.AppRequestError(data.message, {
                    code: data.code, status: 403
                });
            }
        }
    if (res.status === 401) {
        localStorage.clear();
        window.location.href = '/';
        throw new AppAsync.AppRequestError('Sesi Anda telah berakhir.', {
            code: 'UNAUTHORIZED',
            status: 401
        });
    }
    return res;
}

async function loadWilayahDanPetugas() {
    if (initialFormDataLoaded) return;
    if (initialFormDataPromise) return initialFormDataPromise;

    const selKec = document.getElementById('kecamatan_id');
    const selPet = document.getElementById('petugas_id');
    selKec.disabled = true;
    selPet.disabled = true;
    selKec.innerHTML = '<option value="">Memuat kecamatan...</option>';
    selPet.innerHTML = '<option value="">Memuat petugas...</option>';
    const operationId = AppAsync.startOperation('Menyiapkan form booking...');

    initialFormDataPromise = (async () => {
        try {
            const [resWilayah, resPetugas] = await Promise.all([
                AppAsync.fetchWithTimeout('/api/auth/wilayah'),
                AppAsync.fetchWithTimeout('/api/auth/petugas-aktif')
            ]);
            if (!resWilayah.ok) throw await AppAsync.responseError(resWilayah, 'Gagal memuat wilayah.');
            if (!resPetugas.ok) throw await AppAsync.responseError(resPetugas, 'Gagal memuat petugas.');

            const [data, pets] = await Promise.all([resWilayah.json(), resPetugas.json()]);
            wilayahData = data;
            selKec.innerHTML = '<option value="">-- Pilih Kecamatan --</option>'
                + data.kecamatan.map(k => `<option value="${Number(k.id)}">${escapeHTML(k.nama_kecamatan)}</option>`).join('');
            selPet.innerHTML = '<option value="">-- Pilih Petugas --</option>'
                + pets.map(p => `<option value="${Number(p.id)}">${escapeHTML(p.nama_lengkap)}</option>`).join('');
            initialFormDataLoaded = true;
        } catch (error) {
            const message = AppAsync.errorMessage(error, 'Data wilayah dan petugas gagal dimuat.');
            selKec.innerHTML = '<option value="">Gagal memuat kecamatan</option>';
            selPet.innerHTML = '<option value="">Gagal memuat petugas</option>';
            const errEl = document.getElementById('booking-error');
            errEl.textContent = message + ' Muat ulang halaman untuk mencoba kembali.';
            errEl.style.display = 'block';
        } finally {
            selKec.disabled = false;
            selPet.disabled = false;
            initialFormDataPromise = null;
            AppAsync.finishOperation(operationId);
        }
    })();
    return initialFormDataPromise;
}

function loadKelurahan() {
    const kecId = document.getElementById('kecamatan_id').value;
    const selKel = document.getElementById('kelurahan_id');
    selKel.innerHTML = '<option value="">-- Pilih Kelurahan/Desa --</option>';
    if (!kecId) {
        setMapLocation(MAP_DEFAULT_CENTER.lat, MAP_DEFAULT_CENTER.lng, MAP_DEFAULT_CENTER.zoom);
        return;
    }
    wilayahData.kelurahan
        .filter(k => k.kecamatan_id == kecId)
        .forEach(k => {
            selKel.innerHTML += `<option value="${Number(k.id)}">${escapeHTML(k.nama_kelurahan)}</option>`;
        });
    cekKuotaOtomatis();
    focusMapToSelection('kecamatan');
}

document.getElementById('kelurahan_id').addEventListener('change', () => {
    cekKuotaOtomatis();
    focusMapToSelection('kelurahan');
});
document.getElementById('alamat_lokasi').addEventListener('blur', geocodeAlamat);

async function cekKuotaOtomatis() {
    const kecId = document.getElementById('kecamatan_id').value;
    const kelId = document.getElementById('kelurahan_id').value;
    const petId = document.getElementById('petugas_id').value;
    const tgl = document.getElementById('tanggal_diminta').value;
    const el = document.getElementById('info-kuota');
    if (!kecId || !kelId || !petId || !tgl) { el.style.display = 'none'; return; }

    clearTimeout(kuotaTimeout);
    kuotaTimeout = setTimeout(async () => {
        el.className = 'kuota-info kuota-loading';
        el.innerHTML = '<span class="spinner"></span> Mengecek slot kuota peninjauan...';
        el.style.display = 'flex';

        try {
            const res = await apiFetch(`/api/booking/kuota?kecamatan_id=${kecId}&kelurahan_id=${kelId}&petugas_id=${petId}&tanggal=${tgl}`);
            if (!res.ok) throw await AppAsync.responseError(res, 'Gagal mengecek kuota.');
            const data = await res.json();
            if (data.tersedia) {
                const sk = data.kecamatan.sisa !== null ? data.kecamatan.sisa + ' slot' : 'Unlimited';
                const sl = data.kelurahan.sisa !== null ? data.kelurahan.sisa + ' slot' : 'Unlimited';
                const sp = data.petugas.sisa !== null ? data.petugas.sisa + ' slot' : '-';
                el.className = 'kuota-info kuota-ok';
                el.innerHTML = `${userIcon('check')} <span>Slot tersedia &nbsp;|&nbsp; Kec: <b>${sk}</b> &nbsp;|&nbsp; Kel: <b>${sl}</b> &nbsp;|&nbsp; Petugas: <b>${sp}</b></span>`;
            } else {
                el.className = 'kuota-info kuota-full';
                let msg = 'Slot penuh pada agenda tanggal ini -';
                if (!data.kecamatan.tersedia) msg += ' ' + (data.kecamatan.message || 'Kuota kecamatan habis.');
                if (!data.kelurahan.tersedia) msg += ' ' + (data.kelurahan.message || 'Kuota kelurahan habis.');
                if (!data.petugas.tersedia) msg += ' ' + (data.petugas.message || 'Kuota petugas penuh.');
                el.innerHTML = `${userIcon('error')} <span>${escapeHTML(msg)}</span>`;
            }
        } catch (error) {
            el.className = 'kuota-info kuota-full';
            el.innerHTML = `${userIcon('error')} <span>${escapeHTML(AppAsync.errorMessage(error, 'Gagal mengecek kuota.'))}</span>`;
        }
    }, 500);
}

async function submitBooking() {
    const errEl = document.getElementById('booking-error');
    const sucEl = document.getElementById('booking-success');
    errEl.style.display = 'none'; sucEl.style.display = 'none';

    const phoneResult = PhoneValidation.validateInput(
        'no_telepon',
        'no-telepon-feedback',
        { showEmpty: true }
    );
    const body = {
        nomor_berkas: document.getElementById('nomor_berkas').value.trim(),
        tanggal_berkas: document.getElementById('tanggal_berkas').value,
        nama_pemohon: document.getElementById('nama_pemohon').value.trim(),
        kecamatan_id: document.getElementById('kecamatan_id').value,
        kelurahan_id: document.getElementById('kelurahan_id').value,
        alamat_lokasi: document.getElementById('alamat_lokasi').value.trim(),
        koordinat_maps: document.getElementById('koordinat_maps').value.trim(),
        no_telepon: phoneResult.normalized,
        petugas_id: document.getElementById('petugas_id').value,
        tanggal_diminta: document.getElementById('tanggal_diminta').value,
    };

    const required = ['nomor_berkas', 'tanggal_berkas', 'nama_pemohon', 'kecamatan_id', 'kelurahan_id', 'alamat_lokasi', 'no_telepon', 'petugas_id', 'tanggal_diminta'];
    if (!phoneResult.valid) {
        errEl.textContent = phoneResult.message;
        errEl.style.display = 'block';
        return;
    }
    if (required.some(f => !body[f])) {
        errEl.textContent = 'Seluruh field wajib Anda isi lengkap';
        errEl.style.display = 'block'; return;
    }

    const btn = document.getElementById('btn-submit');
    if (!setButtonLoading(btn, true, 'Mengirim Booking...')) return;

    try {
        const res = await apiFetch('/api/booking', { method: 'POST', body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) {
            errEl.textContent = data.message; errEl.style.display = 'block'; return;
        }
        sucEl.textContent = 'Pengajuan booking berhasil masuk! Menunggu Konfirmasi.';
        sucEl.style.display = 'block';
        resetForm();
        invalidateProfilCache();
        setTimeout(() => showPage('profil'), 2000);
    } catch (error) {
        errEl.textContent = AppAsync.errorMessage(error, 'Booking gagal dikirim.');
        errEl.style.display = 'block';
    } finally {
        setButtonLoading(btn, false);
    }
}

function resetForm() {
    ['nomor_berkas', 'tanggal_berkas', 'nama_pemohon', 'kecamatan_id', 'kelurahan_id', 'alamat_lokasi', 'koordinat_maps', 'no_telepon', 'petugas_id', 'tanggal_diminta'].forEach(id => {
        document.getElementById(id).value = '';
    });
    document.getElementById('koordinat_lat').value = '';
    document.getElementById('koordinat_lng').value = '';
    document.getElementById('info-kuota').style.display = 'none';
    PhoneValidation.validateInput('no_telepon', 'no-telepon-feedback');
}

function invalidateProfilCache() {
    riwayatLoaded = false;
}

PhoneValidation.bind('no_telepon', 'no-telepon-feedback');

function updateLocalBooking(id, changes) {
    const index = riwayatBookings.findIndex(item => item.id === Number(id));
    if (index < 0) return false;
    riwayatBookings[index] = { ...riwayatBookings[index], ...changes };
    renderRiwayat(riwayatBookings);
    return true;
}

function renderRiwayat(data) {
    const list = document.getElementById('riwayat-list');
    return AppAsync.renderList(list, data, function (b) {
        const alasanPetugas = b.status === 'rescheduled_by_petugas' && b.last_reschedule_by === 'petugas'
            ? (b.last_reschedule_alasan || 'Petugas mengusulkan perubahan jadwal tanpa catatan tambahan.')
            : null;
        const bisaAjukanJadwal = ['jadwal_fix', 'rescheduled_by_petugas'].includes(b.status) && b.reschedule_count < 1;
        return `<article class="berkas-card status-${b.status}">
            <section class="berkas-top">
                <div class="berkas-nomor">#${escapeHTML(b.nomor_berkas)}</div>
                ${badgeStatus(b.status)}
                <div class="berkas-date-block">
                    <span class="date-icon"></span>
                    <strong>${formatDate(b.tanggal_fix || b.tanggal_diminta)}</strong>
                    <small>Tgl Pemeriksaan</small>
                </div>
            </section>
            <section class="berkas-detail">
                <div class="berkas-row"><span>Pemohon</span><b>:</b><strong>${escapeHTML(b.nama_pemohon)}</strong></div>
                <div class="berkas-row"><span>Wilayah</span><b>:</b><strong>${escapeHTML(b.nama_kecamatan)}, ${escapeHTML(b.nama_kelurahan)}</strong></div>
                <div class="berkas-row"><span>Petugas</span><b>:</b><strong>${escapeHTML(b.nama_petugas || '-')}</strong></div>
                <div class="berkas-row"><span>Alamat</span><b>:</b><strong>${escapeHTML(b.alamat_lokasi || '-')}</strong></div>
                <div class="berkas-row"><span>Catatan</span><b>:</b><strong>${escapeHTML(b.catatan_lapangan || '-')}</strong></div>
            </section>
            <section class="berkas-info-box">
                <h4>Info Berkas</h4>
                <div><span>Nomor Berkas</span><b>:</b><strong>${escapeHTML(b.nomor_berkas)}</strong></div>
                <div><span>Tanggal Berkas</span><b>:</b><strong>${formatDate(b.tanggal_berkas || b.created_at)}</strong></div>
                <div><span>Status Berkas</span><b>:</b><strong>${badgeLabel(b.status)}</strong></div>
                <div><span>Jadwal Ditetapkan</span><b>:</b><strong>${b.tanggal_fix ? formatDate(b.tanggal_fix) : '-'}</strong></div>
            </section>
            <section class="berkas-action-panel">
                <div class="berkas-action-title">Tindak Lanjut Berkas</div>
                ${alasanPetugas ? `
                <div class="berkas-reason">
                    <span>Alasan Petugas</span>
                    <p>${escapeHTML(alasanPetugas)}</p>
                </div>` : ''}
                ${b.status === 'rescheduled_by_petugas' ? `
                <button class="berkas-action-row action-confirm" data-click="approvePetugasSchedule" data-click-args='[${b.id},"$el"]'>
                    ${riwayatActionIcon('confirm')}<strong>Setujui Jadwal</strong><small>Gunakan jadwal dari petugas</small>
                </button>
                ${bisaAjukanJadwal ? `<button class="berkas-action-row action-reschedule" data-click="openReschedule" data-click-args='[${b.id}]'>${riwayatActionIcon('reschedule')}<strong>Ajukan Jadwal Lain</strong><small>Ajukan perubahan satu kali</small></button>` : ''}
                <button class="berkas-action-row action-cancel" data-click="openCancelBooking" data-click-args='[${b.id}]'>
                    ${riwayatActionIcon('cancel')}<strong>Batalkan Permohonan</strong><small>Jika jadwal tidak bisa disepakati</small>
                </button>` : ''}
                ${b.status !== 'rescheduled_by_petugas' && bisaAjukanJadwal ? `
                <button class="berkas-action-row action-reschedule" data-click="openReschedule" data-click-args='[${b.id}]'>
                    ${riwayatActionIcon('reschedule')}<strong>Ajukan Reschedule</strong><small>Ajukan perubahan satu kali</small>
                </button>` : ''}
                ${!bisaAjukanJadwal && b.status !== 'rescheduled_by_petugas' ? `<p class="berkas-action-note">${riwayatStatusNote(b.status)}</p>` : ''}
            </section>
        </article>`;
    }, {
        chunkSize: 30,
        emptyHtml: '<div class="empty-state">' + userIcon('emptyFile', 'empty-icon empty-icon-svg') + '<p>Belum ada riwayat pengajuan agenda.</p></div>'
    });
}

async function loadProfil(options = {}) {
    const forceRefresh = options.force === true;
    if (!forceRefresh && profilLoaded && riwayatLoaded) return;
    if (!forceRefresh && profilLoadPromise) return profilLoadPromise;
    const operationId = AppAsync.startOperation('Memuat profil dan riwayat...');

    profilLoadPromise = (async () => {
        try {
            if (forceRefresh || !profilLoaded) {
                const res = await apiFetch('/api/auth/profile');
                if (!res.ok) throw await AppAsync.responseError(res, 'Profil gagal dimuat.');
                const user = await res.json();
                document.getElementById('profil-nama').textContent = user.nama_lengkap;
                document.getElementById('profil-email').innerHTML = userIcon('mail') + '<span>' + escapeHTML(user.email) + '</span>';
                document.getElementById('profil-hp').innerHTML = userIcon('phone') + '<span>' + escapeHTML(user.no_hp) + '</span>';
                document.getElementById('profil-avatar').textContent = user.nama_lengkap[0].toUpperCase();
                profilLoaded = true;
            }
        } catch (err) { console.error(err); }

        const list = document.getElementById('riwayat-list');
        if (!forceRefresh && riwayatLoaded) {
            renderRiwayat(riwayatBookings);
            return;
        }

        list.innerHTML = '<div class="loading"><span class="spinner"></span> Memuat daftar berkas...</div>';
        try {
            const res = await apiFetch('/api/booking/my');
            if (!res.ok) throw await AppAsync.responseError(res, 'Riwayat gagal dimuat.');
            const data = await res.json();
            riwayatBookings = data;
            riwayatLoaded = true;
            renderRiwayat(data);
        } catch (error) {
            list.innerHTML = `<div class="alert alert-error">${escapeHTML(AppAsync.errorMessage(error, 'Gagal memuat agenda.'))}</div>`;
        }
    })();

    try {
        await profilLoadPromise;
    } finally {
        profilLoadPromise = null;
        AppAsync.finishOperation(operationId);
    }
}

async function approvePetugasSchedule(id, button) {
    if (!setButtonLoading(button, true, 'Menyetujui...')) return;
    try {
        const res = await apiFetch(`/api/booking/approve-petugas-schedule/${id}`, {
            method: 'POST'
        });
        if (!res.ok) {
            const data = await res.json();
            alert(data.message || 'Gagal menyetujui jadwal.');
            return;
        }
        const booking = riwayatBookings.find(item => item.id === Number(id));
        updateLocalBooking(id, {
            status: 'jadwal_fix',
            tanggal_fix: booking?.tanggal_diminta || null
        });
        loadNotifikasi();
    } catch (error) {
        alert(AppAsync.errorMessage(error, 'Gagal menyetujui jadwal.'));
    } finally {
        setButtonLoading(button, false);
    }
}

function openCancelBooking(id) {
    selectedBookingId = id;
    document.getElementById('cancel-alasan').value = '';
    document.getElementById('cancel-error').style.display = 'none';
    document.getElementById('modal-cancel-booking').classList.add('show');
}

async function submitCancelBooking() {
    const alasan = document.getElementById('cancel-alasan').value.trim();
    const errEl = document.getElementById('cancel-error');
    const btn = document.getElementById('btn-cancel-submit');
    errEl.style.display = 'none';

    if (!alasan) {
        errEl.textContent = 'Alasan pembatalan wajib diisi.';
        errEl.style.display = 'block';
        return;
    }

    if (!setButtonLoading(btn, true, 'Membatalkan...')) return;
    try {
        const res = await apiFetch(`/api/booking/cancel/${selectedBookingId}`, {
            method: 'POST',
            body: JSON.stringify({ alasan })
        });
        if (!res.ok) {
            const data = await res.json();
            errEl.textContent = data.message || 'Gagal membatalkan permohonan.';
            errEl.style.display = 'block';
            return;
        }
        closeModal('modal-cancel-booking');
        updateLocalBooking(selectedBookingId, {
            status: 'dibatalkan',
            tanggal_fix: null
        });
        loadNotifikasi();
    } catch (error) {
        errEl.textContent = AppAsync.errorMessage(error, 'Gagal membatalkan permohonan.');
        errEl.style.display = 'block';
    } finally {
        setButtonLoading(btn, false);
    }
}

function openReschedule(id) {
    selectedBookingId = id;
    document.getElementById('reschedule-tanggal').value = '';
    document.getElementById('reschedule-alasan').value = '';
    document.getElementById('reschedule-error').style.display = 'none';
    document.getElementById('reschedule-tanggal').min = today;
    document.getElementById('modal-reschedule').classList.add('show');
}

async function submitReschedule() {
    const tanggal_baru = document.getElementById('reschedule-tanggal').value;
    const alasan = document.getElementById('reschedule-alasan').value;
    const errEl = document.getElementById('reschedule-error');
    const btn = document.getElementById('btn-reschedule-submit');
    errEl.style.display = 'none';

    if (!tanggal_baru) {
        errEl.textContent = 'Tanggal pengajuan baru wajib diisi.';
        errEl.style.display = 'block'; return;
    }
    const booking = riwayatBookings.find(b => b.id === selectedBookingId);
    if (booking && dateOnly(booking.tanggal_diminta) === tanggal_baru) {
        errEl.textContent = 'Tanggal baru harus berbeda dari jadwal yang sedang berlaku.';
        errEl.style.display = 'block';
        return;
    }
    if (!setButtonLoading(btn, true, 'Mengajukan...')) return;
    try {
        const res = await apiFetch(`/api/booking/reschedule/${selectedBookingId}`, {
            method: 'POST',
            body: JSON.stringify({ tanggal_baru, alasan })
        });
        if (!res.ok) { const d = await res.json(); errEl.textContent = d.message; errEl.style.display = 'block'; return; }
        closeModal('modal-reschedule');
        const booking = riwayatBookings.find(item => item.id === Number(selectedBookingId));
        updateLocalBooking(selectedBookingId, {
            status: 'rescheduled_by_user',
            tanggal_diminta: tanggal_baru,
            tanggal_fix: null,
            reschedule_count: Number(booking?.reschedule_count || 0) + 1
        });
        loadNotifikasi();
    } catch (error) {
        errEl.textContent = AppAsync.errorMessage(error, 'Gagal menyimpan perubahan.');
        errEl.style.display = 'block';
    } finally {
        setButtonLoading(btn, false);
    }
}

function closeModal(id) { document.getElementById(id).classList.remove('show'); }
// Sesi berada di cookie httpOnly, jadi keluar harus dilakukan server.
// Menghapus localStorage saja tidak membatalkan sesi apa pun.
function logout(button) {
    setButtonLoading(button || document.getElementById('btn-logout'), true, 'Keluar...');
    akhiriSesi('/');
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
    return label[status] || status;
}

function riwayatStatusNote(status) {
    const notes = {
        pending: 'Berkas sedang menunggu konfirmasi petugas.',
        rescheduled_by_user: 'Usulan jadwal baru Anda sedang menunggu konfirmasi petugas.',
        jadwal_fix: 'Jadwal pemeriksaan sudah ditetapkan.',
        selesai: 'Pemeriksaan berkas telah selesai.',
        ditolak: 'Berkas ditolak dan tidak memiliki aksi lanjutan.',
        dibatalkan: 'Permohonan dibatalkan oleh pemohon.'
    };
    return notes[status] || 'Tidak ada aksi lanjutan untuk status ini.';
}

function riwayatActionIcon(type) {
    const icons = {
        confirm: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="m8 12 3 3 5-6"></path></svg>',
        reschedule: '<svg viewBox="0 0 24 24"><path d="M8 2v4"></path><path d="M16 2v4"></path><rect x="3.5" y="5" width="17" height="16" rx="2.5"></rect><path d="M3.5 10h17"></path><path d="M8 15h6"></path><path d="m13 12 3 3-3 3"></path></svg>',
        cancel: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="m15 9-6 6"></path><path d="m9 9 6 6"></path></svg>'
    };
    return `<span class="berkas-action-icon" aria-hidden="true">${icons[type] || icons.confirm}</span>`;
}

function badgeStatus(status) {
    return '<span class="badge badge-' + status + '">' + badgeLabel(status) + '</span>';
}

// Init Peta Otomatis
loadWilayahDanPetugas();
initMap();
loadNotifikasi();
setInterval(loadNotifikasi, 30000);
