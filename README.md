# SIMPETA — Sistem Booking Pemeriksaan Tanah

Aplikasi web untuk mengatur penjadwalan pemeriksaan tanah di Badan Pertanahan
Nasional Kabupaten Luwu Timur.

## Siapa penggunanya

| Peran | Masuk lewat | Yang bisa dilakukan |
|---|---|---|
| **Pemohon** | `/` (email + kata sandi, verifikasi OTP email) | Mengajukan permohonan, memantau status, mengajukan ulang jadwal (maks. 1×), menyetujui atau membatalkan jadwal usulan petugas |
| **Petugas** | `/login-petugas` (NIP + kata sandi) | Melihat tugas masuk, mengonfirmasi atau mengganti jadwal, menolak berkas, mengunggah hasil pemeriksaan |
| **Admin** | `/login-petugas` (username + kata sandi) | Memantau seluruh berkas, mengelola akun petugas, mengatur kuota per kecamatan/kelurahan/petugas |

## Alur status berkas

```
pending ──konfirmasi petugas──> jadwal_fix ──input hasil──> selesai
   │                                 ↑
   ├──petugas ganti jadwal──> rescheduled_by_petugas ──disetujui pemohon──┘
   │                                 └──dibatalkan pemohon──> dibatalkan
   ├──pemohon ajukan ulang──> rescheduled_by_user ──konfirmasi petugas──> jadwal_fix
   └──petugas tolak──> ditolak
```

Kuota diperiksa dan dikunci per tanggal untuk tiga sasaran sekaligus
(kecamatan, kelurahan, petugas). Ketiganya harus tersedia agar booking diterima.

## Teknologi

- Node.js + Express 5 (CommonJS)
- MySQL 8 (mysql2, connection pool)
- JWT untuk sesi, bcrypt untuk kata sandi
- Nodemailer / Resend API untuk email OTP dan notifikasi
- Frontend HTML + CSS + JavaScript tanpa framework

## Menjalankan di lokal

```bash
git clone <url-repo> && cd bpn_booking
npm install
cp .env.example .env    # lalu isi nilainya, lihat tabel di bawah
mysql -u root -p nama_database < db/schema.sql
npm run dev
```

Aplikasi berjalan di `http://localhost:3000`.

## Variabel environment

**Wajib diisi:**

| Variabel | Keterangan |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Koneksi MySQL. Alternatif: `MYSQL_ADDON_*`, `MYSQL_URL`, atau `DATABASE_URL` |
| `JWT_SECRET` | Minimal 32 karakter acak |
| `JWT_EXPIRES_IN` | Masa berlaku token, mis. `1d`. Ada fallback `1d` bila kosong |

**Wajib di production:**

| Variabel | Nilai | Kenapa |
|---|---|---|
| `NODE_ENV` | `production` | Mengaktifkan cookie `Secure` dan menyembunyikan detail error dari klien |
| `TRUST_PROXY` | `1` | Bila di balik reverse proxy. Tanpa ini rate limit membaca IP proxy untuk semua orang, sehingga satu pengguna bisa mengunci semua pengguna lain |
| `CORS_ORIGINS` | domain resmi | Kosong di production berarti hanya same-origin yang lolos |
| `UPLOAD_DIR` | folder di luar direktori deploy | Foto hasil pemeriksaan akan hilang saat redeploy bila disimpan di `public/uploads` |

Sisanya (OTP, email, rate limit, reminder petugas) terdokumentasi di
[`.env.example`](.env.example).

## Struktur folder

```
server.js              titik masuk aplikasi
config/                koneksi database & lokasi folder upload
middleware/            verifikasi token (+ cek akun masih aktif), rate limit
routes/                pemetaan endpoint HTTP
controllers/           logika per peran: auth, booking, petugas, admin
utils/                 kuota, notifikasi & email, OTP, nomor HP, reminder, helper HTTP
public/pages/          markup halaman
public/js/             common.js (helper bersama) + satu berkas per halaman
public/css/            gaya per halaman
db/schema.sql          struktur tabel (dihasilkan scripts/dump-schema.js)
scripts/               pemeriksaan dan uji tanpa dependensi eksternal
docs/                  catatan audit dan deploy
```

## Perintah

```bash
npm run dev       # jalankan dengan auto-reload
npm start         # jalankan biasa
npm test          # lint + semua pemeriksaan
npm run test:xss  # regresi escaping XSS
npm run test:sesi # sesi cookie & proteksi CSRF
npm run lint      # ESLint saja
npm run test:db   # cek koneksi database
npm run test:email # cek pengiriman email
node scripts/dump-schema.js   # perbarui db/schema.sql dari database
```

## Catatan penting untuk pengembang

**Selalu bungkus data pengguna dengan `escapeHTML()` sebelum masuk `innerHTML`.**
Halaman ini menampilkan data yang diisi pemohon (`nomor_berkas`, `nama_pemohon`,
`alamat_lokasi`) di dasbor petugas dan admin. Tanpa escape, pemohon biasa bisa
menjalankan skrip di sesi petugas/admin. `npm run test:xss` menjaga hal ini dan
akan gagal bila ada interpolasi mentah yang kembali masuk.

**Untuk tautan peta pakai `safeMapsUrl()`**, jangan menyusun URL dari
`koordinat_maps` secara langsung — isinya bisa berupa teks bebas.

**Jangan memakai `pool.query` sambil memegang koneksi transaksi.** Lepas dulu
koneksinya (`conn.release()`) baru kirim notifikasi. Bila tidak, dua permintaan
bersamaan akan saling menunggu koneksi dan pool terkunci permanen — mysql2 tidak
punya batas waktu antrean.

**JavaScript halaman adalah skrip klasik, bukan module.** Fungsinya sengaja
global supaya atribut `onclick="..."` di HTML tetap berfungsi.

**Token JWT tidak pernah menyentuh JavaScript.** Sesi disimpan di cookie
`httpOnly` (`bpn_session`) sehingga celah XSS tidak bisa membacanya. Yang ada di
`localStorage` hanya nama dan peran untuk keperluan tampilan — bukan otorisasi.

**Setiap permintaan yang mengubah data wajib menyertakan header
`X-CSRF-Token`.** Nilainya dibaca dari cookie `bpn_csrf` lewat `csrfToken()` di
`common.js`; `headerSesi(method)` sudah melakukannya otomatis. Ini diperlukan
karena cookie dikirim browser secara otomatis, termasuk pada permintaan yang
dipicu situs lain. `npm run test:sesi` menjaga keduanya tetap terpasang.
