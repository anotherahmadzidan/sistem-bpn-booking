# TODO Audit — SIMPETA BPN Luwu Timur

Daftar tindak lanjut hasil audit menyeluruh (keamanan, fungsi, tampilan, struktur repo).
Disusun berdasarkan prioritas. Status: `[ ]` belum · `[x]` selesai.

Tanggal audit: 22 Juli 2026 · Status proyek: **sudah production** di `simpeta-luwutimur.com`

---

## P0 — SEGERA (celah aktif di production)

### [ ] 1. Tutup celah Stored XSS di panel admin ⚠️ KRITIS

Sudah dibuktikan tereksekusi (payload `<img src=x onerror=...>` berhasil jalan).
Dampak: pemohon biasa bisa membajak sesi admin dan mencuri token.

Bungkus semua interpolasi data dengan `escapeHTML()` di `public/pages/admin.html`:

- [ ] Baris 1238–1241 — modal hapus berkas: `nomor_berkas`, `nama_pemohon`
- [ ] Baris 1095–1102 — modal detail: `nomor_berkas`, `nama_pemohon`, `no_telepon`,
      `email_user`, `nama_petugas`, `nip`
- [ ] Baris 1112 — `alamat_lokasi`
- [ ] Baris 1113 — `koordinat_maps` (masuk ke dalam atribut `href`, perlu
      **validasi format koordinat**, bukan sekadar escape)
- [ ] Baris 1130 — timeline: `nama_pemohon`, `nama_petugas`
- [ ] Baris 1834–1851 — isi `<option>`: `nama_kecamatan`, `nama_lengkap`, `nip`

Referensi pola yang sudah benar: baris 983–987 (tabel dashboard) dan 1145 (alasan reschedule).

- [ ] Audit ulang `user.html` dan `petugas.html` dengan cara yang sama

### [ ] 2. Sanitasi input di sisi server

Saat ini HTML mentah tersimpan apa adanya di database.

- [ ] `controllers/bookingController.js:71` — `nomor_berkas`, `nama_pemohon`,
      `alamat_lokasi`, `koordinat_maps`
- [ ] `controllers/authController.js:526` — `nama_lengkap`
- [ ] Tambah validasi format: `koordinat_maps` harus pola lat,long

### [ ] 3. Aktifkan Content Security Policy

`server.js:30` saat ini `contentSecurityPolicy: false` — tidak ada lapisan
pertahanan kedua saat XSS lolos.

- [ ] Aktifkan CSP di helmet dengan kebijakan yang sesuai
- [ ] Catatan: butuh penyesuaian karena banyak `<script>` dan `style` inline
      (lihat P4 nomor 22 — memindahkan JS keluar akan mempermudah ini)

### [ ] 4. Perketat penyimpanan token

- [ ] Persingkat `JWT_EXPIRES_IN` dari `7d` menjadi `1d`
- [ ] Pertimbangkan pindah dari `localStorage` ke cookie `httpOnly` + `Secure`
      (token di localStorage bisa dibaca JavaScript bila ada XSS)

---

## P1 — MINGGU INI

### [ ] 5. Perbarui dependensi rentan

`npm audit` menemukan 3 kerentanan (2 di antaranya *high*):
- **multer** — DoS via nested field names & upload yang dibatalkan
- **nodemailer** — CRLF injection pada header email

```bash
npm audit fix
npm test
```

### [ ] 6. Sembunyikan NIP petugas dari publik

`GET /api/auth/petugas-aktif` bisa diakses **tanpa login** dan mengembalikan
NIP + nama lengkap seluruh petugas. NIP adalah identitas ASN.

- [ ] Hapus kolom `nip` dari query di `controllers/authController.js:863`
      (form booking hanya butuh `id` + `nama_lengkap`)

### [ ] 7. Perbaiki tabel dashboard admin yang terpotong di HP

Di layar ≤720px, tabel "Berkas Terbaru" lebarnya 760px di dalam wadah 321px
yang tidak bisa di-scroll → ±58% isi terpotong permanen.

Penyebab: konflik spesifisitas CSS — selektor ber-ID menang.

- [ ] Tambahkan di dalam `@media (max-width: 720px)` pada `public/css/admin.css`:
      `.admin-dashboard #page-dashboard table { min-width: 0; }`
- [ ] Verifikasi di 360px, 375px, dan 720px

### [ ] 8. Verifikasi konfigurasi production di Hostinger

- [ ] `NODE_ENV=production` (mengaktifkan cookie Secure & menyembunyikan detail error)
- [ ] `TRUST_PROXY=1` (agar rate limit membaca IP asli, bukan IP proxy)
- [ ] `CORS_ORIGINS=https://simpeta-luwutimur.com`
- [ ] `UPLOAD_DIR=/home/u575625165/uploads` (folder persisten di luar direktori deploy)
- [ ] `DB_CONNECTION_LIMIT` sesuai kapasitas Hostinger
- [ ] SSL/HTTPS aktif dan memaksa redirect dari HTTP
- [ ] Uji ujung-ke-ujung: login → booking → upload foto → lihat foto di admin
- [ ] Pastikan foto **tetap ada setelah redeploy** (ini yang dulu bermasalah)

### [ ] 9. Rate limit di luar route auth

Saat ini `authLimiter` hanya dipasang di `routes/auth.js`. Endpoint booking
dan admin tidak dibatasi — pemohon bisa spam ribuan booking.

- [ ] Pasang limiter (batas lebih longgar) pada `routes/booking.js`
- [ ] Pertimbangkan limiter global sebagai jaring pengaman

### [ ] 10. Perkuat kebijakan kata sandi

- [ ] Naikkan minimum dari 6 → 8 karakter (`controllers/authController.js:532`)
- [ ] Pertimbangkan syarat kombinasi huruf + angka
- [ ] Samakan aturannya di frontend dan backend

---

## P2 — PERAPIAN STRUKTUR (tanpa mengubah perilaku)

> Nomor 11–13 saling terkait, kerjakan sekaligus. Total menghapus ±170 baris
> kode mati. Verifikasi dengan `npm test` — perilaku harus tetap sama.

### [ ] 11. Gabungkan `adminPetugasOverrides.js` ke `adminController.js`

Saat ini ada **dua implementasi `editPetugas`** yang hampir identik, dan yang
di `controllers/adminController.js:146` **tidak pernah dijalankan** (ditimpa saat
runtime). Risiko: memperbaiki bug di file itu tidak akan berefek apa pun.

- [ ] Pindahkan kelebihan versi override (normalisasi email ke huruf kecil,
      validasi panjang nama) ke `adminController.js`
- [ ] Hapus `adminPetugasOverrides.js`

### [ ] 12. Hapus duplikasi pool database

`config/db.js` dan `dbPool.js` duplikat 99% — beda hanya di `connectionLimit`
(hardcode `10` vs dari env). Skrip di `scripts/` memakai versi hardcode
sehingga bisa membuka 10 koneksi, mengabaikan `DB_CONNECTION_LIMIT`.

- [ ] Pertahankan satu file saja (yang membaca env), letakkan di `config/`
- [ ] Perbarui semua `require` yang menunjuk ke file yang dihapus

### [ ] 13. Hapus `bootstrap.js`, jadikan `server.js` entry point

`bootstrap.js` membajak `require.cache` untuk menukar modul. Akibatnya *kode
yang dibaca berbeda dari kode yang berjalan*. Ranjau: bila ada yang menjalankan
`node server.js` langsung, seluruh override hilang **tanpa pesan error**.

- [ ] Setelah nomor 11 & 12 selesai, hapus `bootstrap.js`
- [ ] Ubah `scripts.start` di package.json → `node server.js`

### [ ] 14. Perbaiki metadata `package.json`

- [ ] `main` menunjuk `index.js` yang **tidak ada** → ubah ke entry sebenarnya
- [ ] Isi `description` dan `author`
- [ ] Sesuaikan `license` dengan berkas LICENSE (nomor 18)

### [ ] 15. Hapus folder kosong yang menyesatkan

- [ ] `models/` — kosong & tidak ter-track, menjanjikan pola MVC yang tak pernah
      diwujudkan (query SQL ada di controllers). Hapus, atau isi sungguhan.
- [ ] `.agents/` — kosong

### [ ] 16. Rapikan penempatan file

- [ ] Pindahkan `dbPool.js` → `config/` (infrastruktur, bukan file root)
- [ ] Hapus `require` ganda di `routes/admin.js` baris 4 dan 15

---

## P3 — STANDAR PROFESIONAL REPO

### [ ] 17. Tulis `README.md` ⭐ paling penting di bagian ini

Saat ini **tidak ada sama sekali**. Orang lain (atau kamu 6 bulan lagi) tidak
tahu cara menjalankan proyek ini. Minimal memuat:

- [ ] Deskripsi singkat sistem & siapa penggunanya (pemohon, petugas, admin)
- [ ] Tumpukan teknologi: Node.js + Express 5, MySQL, JWT
- [ ] Cara menjalankan lokal (clone → `npm install` → salin `.env.example` → `npm run dev`)
- [ ] Daftar variabel environment yang **wajib** diisi
- [ ] Skema database / cara menyiapkannya
- [ ] Alur deploy ke Hostinger
- [ ] Struktur folder singkat

### [ ] 18. Tambahkan `LICENSE`

`package.json` mengklaim ISC tetapi berkasnya tidak ada. Untuk sistem instansi
pemerintah, pastikan lisensinya sesuai kebijakan.

### [ ] 19. Pasang linter & formatter

Ini yang akan **mencegah celah XSS seperti nomor 1 terulang**.

- [ ] ESLint + konfigurasi dasar
- [ ] Prettier (atau EditorConfig) agar gaya penulisan konsisten
- [ ] Tambahkan `npm run lint` ke `scripts`

### [ ] 20. Rapikan dokumentasi

- [ ] Pindahkan `DEPLOY_TESTING.md` dan `TODO_DEPLOY.md` ke `docs/`
- [ ] Perbarui atau hapus isinya yang sudah usang (proyek sudah production)

### [ ] 21. Siapkan CI sederhana (GitHub Actions)

- [ ] Jalankan `npm test` dan `npm run lint` otomatis setiap push
- [ ] Jalankan `npm audit` untuk memantau kerentanan dependensi

---

## P4 — JANGKA MENENGAH

### [ ] 22. Pindahkan JavaScript inline ke berkas terpisah

Ketimpangan terbesar proyek ini: backend rapi berlapis, frontend tanpa struktur.

| Berkas | Baris |
|---|---|
| `public/pages/admin.html` | **2.040** (±1.300 di antaranya JS) |
| `public/pages/user.html` | **1.405** |
| `public/pages/petugas.html` | 958 |

Konsekuensi nyata: tidak bisa di-lint, tidak bisa di-cache browser, sulit
di-review — **dan di sinilah celah XSS nomor 1 bersembunyi tanpa terdeteksi.**

- [ ] Ekstrak JS `admin.html` → `public/js/admin.js`
- [ ] Ekstrak JS `user.html` → `public/js/user.js`
- [ ] Ekstrak JS `petugas.html` → `public/js/petugas.js`
- [ ] Satukan fungsi bersama (`escapeHTML`, `stripHTML`, `badgeStatus`,
      `formatDate`) yang saat ini **diduplikasi di tiga berkas**
- [ ] Setelah ini selesai, CSP (nomor 3) jauh lebih mudah diperketat

### [ ] 23. Gunakan framework test sungguhan

`scripts/` berisi skrip uji manual, bukan test suite.

- [ ] Adopsi test runner (mis. `node:test` bawaan Node, atau Jest/Vitest)
- [ ] Prioritaskan test untuk: validasi nomor HP, alur OTP registrasi,
      perhitungan kuota, dan aturan reschedule
- [ ] Tambahkan test regresi untuk celah XSS nomor 1

### [ ] 24. Pertimbangkan lapisan model

Query SQL tersebar di 4 berkas controller. Bila sistem terus bertambah,
pertimbangkan memindahkan akses data ke lapisan tersendiri agar controller
fokus pada logika bisnis.

---

## Catatan: yang sudah baik (jangan dirusak)

Bagian-bagian ini sudah digarap serius dan **tidak perlu diubah**:

- **SQL semuanya parameterized** — tidak ada celah SQL injection
- **Tidak ada circular dependency**; lapisan routes → controllers → utils bersih
- **IDOR terlindungi** — query di-scope ke `user_id` / `petugas_id`
- **Transaksi + `FOR UPDATE`** pada operasi kritis (konfirmasi jadwal, input hasil, hapus berkas)
- **Password di-hash dengan bcrypt**
- **CORS allowlist ketat** di production
- **Anti email enumeration** pada fitur lupa sandi
- **Upload divalidasi** MIME + ekstensi + ukuran
- **Penanganan error seragam** lewat `utils/http.js`
- **`.env` tidak pernah ter-commit** (sudah diperiksa di seluruh riwayat git)
- **`.env.example` sangat lengkap** dan terdokumentasi baik
- **Halaman login responsif** dari 360px sampai 2560px
