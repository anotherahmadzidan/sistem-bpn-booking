# SIMPETA — Sistem Booking Pemeriksaan Tanah

Aplikasi web untuk mengatur penjadwalan pemeriksaan tanah di Badan Pertanahan
Nasional Kabupaten Luwu Timur.

## Siapa penggunanya

| Peran | Masuk lewat | Yang bisa dilakukan |
|---|---|---|
| **Pemohon** | `/` (email + kata sandi, verifikasi OTP email) | Mengajukan permohonan, memantau status, mengajukan ulang jadwal (maks. 1×), menyetujui atau membatalkan jadwal usulan petugas |
| **Petugas** | `/login-petugas` (NIP + kata sandi) | Melihat tugas masuk, mengonfirmasi atau mengganti jadwal, menolak berkas, mengunggah hasil pemeriksaan |
| **Admin** | `/login-petugas` (username + kata sandi) | Memantau seluruh berkas, mengelola akun petugas, mengatur kuota per kecamatan/kelurahan/petugas |

### Kata sandi

| | Ganti sandi | Lupa sandi |
|---|---|---|
| **Pemohon** | Menu profil — wajib sandi lama | OTP ke email |
| **Petugas** | Sidebar — wajib sandi lama | OTP ke email terdaftar, cukup masukkan NIP |
| **Admin** | Sidebar — wajib sandi lama | `node scripts/reset-sandi-admin.js` di server |

Sandi petugas yang dibuat admin bersifat **sementara**: petugas wajib
menggantinya saat login pertama, dan sampai itu dilakukan server menolak seluruh
endpoint lain. Setelah diganti, admin tidak lagi mengetahui sandi yang berlaku —
ia masih bisa mereset, tetapi reset itu memicu email pemberitahuan ke petugas
sehingga tindakannya tidak bisa dilakukan diam-diam.

Admin **tidak** punya pemulihan lewat email: akun admin memegang kendali penuh
atas sistem, sehingga membuatnya dapat dipulihkan lewat sebuah kotak surat
berarti menurunkan keamanan sistem menjadi setara keamanan email itu. Yang jadi
bukti identitas adalah akses ke server. Sangat disarankan menambah **admin
kedua** agar keduanya bisa saling mereset dan sistem tidak lumpuh saat satu-
satunya admin berhalangan.

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

Pakai database terpisah untuk pengembangan. **Jangan mengarahkan `.env` ke
database produksi** — siapa pun yang menjalankan `npm run dev` akan langsung
menyentuh data warga yang sebenarnya.

```bash
git clone <url-repo> && cd bpn_booking
npm install

# Siapkan database pengembangan
mysql -u root -e "CREATE DATABASE bpn_booking_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mysql -u root bpn_booking_dev < db/schema.sql

npm run seed:lokal   # isi data contoh + akun uji
npm run dev:lokal    # jalankan terhadap database lokal
```

`dev:lokal` menyetel sendiri koneksi ke `bpn_booking_dev` tanpa menyentuh
`.env`, mematikan penjadwal reminder, dan mengalihkan email ke berkas di
`tmp/email-keluar/` — jadi tidak ada email sungguhan yang terkirim dan kode OTP
bisa dibaca langsung dari berkas itu saat menguji.

`npm run seed:lokal` menolak berjalan bila `DB_HOST` bukan localhost.

Untuk menjalankan terhadap `.env` apa adanya: `npm run dev`.
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
logs/                  catatan error harian (tidak ikut Git)
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
npm run test:sandi # ganti & lupa sandi
npm run dev:lokal  # jalankan terhadap database pengembangan
npm run seed:lokal # isi database pengembangan dengan data contoh
npm run lint      # ESLint saja
npm run test:db   # cek koneksi database
npm run test:email # cek pengiriman email
node scripts/dump-schema.js   # perbarui db/schema.sql dari database
```

## Jejak dan pemantauan

**Audit log** (`audit_log`) mencatat tindakan yang mengubah status berkas:
konfirmasi jadwal, penggantian jadwal, penolakan berkas, penyimpanan hasil
pemeriksaan, penghapusan berkas, dan reset sandi petugas oleh admin. Sifatnya
hanya-tambah — tidak ada endpoint yang mengubah atau menghapus barisnya.

Catatan ini baru bermakna karena petugas kini memegang sandinya sendiri. Selama
sandi petugas diketahui admin, baris "petugas X menolak berkas" tidak
membuktikan apa pun.

**Pemantauan error** menulis setiap kegagalan ke `logs/error-YYYY-MM-DD.log`,
karena keluaran konsol di hosting hilang saat proses di-restart. Ringkasannya
muncul di `GET /api/health` (`total_error`, `error_terakhir`), dan 20 error
terakhir dapat dilihat admin lewat `GET /api/admin/diagnostik/error`. Promise
yang ditolak tanpa penanganan ikut tertangkap, supaya proses tidak mati tanpa
meninggalkan jejak. Atur lokasinya lewat env `LOG_DIR`.

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

**Jangan memakai atribut event inline (`onclick=`, `onchange=`, ...).** CSP
kini menetapkan `script-src-attr 'none'`, sehingga atribut seperti itu tidak
akan dieksekusi browser — termasuk yang berhasil disuntikkan penyerang. Nyatakan
handler lewat atribut data-*, yang dihubungkan `common.js`:

```html
<button data-click="filterTugas" data-click-args='["pending"]'>Menunggu</button>
<input  data-input="cariBerkas"  data-input-args='["$val"]'>
```

Token `"$el"` (elemen, dulu `this`), `"$val"` (nilai elemen), dan `"$ev"` (objek
event) tersedia di dalam args; `data-stop="1"` menjalankan `stopPropagation()`.
`npm run test:xss` akan gagal bila atribut event inline muncul kembali.

**JavaScript halaman adalah skrip klasik, bukan module.** Fungsinya sengaja
global agar dapat dipanggil penghubung aksi tersebut.

**Token JWT tidak pernah menyentuh JavaScript.** Sesi disimpan di cookie
`httpOnly` (`bpn_session`) sehingga celah XSS tidak bisa membacanya. Yang ada di
`localStorage` hanya nama dan peran untuk keperluan tampilan — bukan otorisasi.

**Setiap penulisan kolom `password` wajib ikut menyetel `password_changed_at`.**
Middleware menolak token yang diterbitkan sebelum waktu itu — inilah yang membuat
penggantian sandi benar-benar memutus sesi lama, termasuk sesi penyerang.
Tanpanya, mengganti sandi karena curiga akun dibajak tidak mengusir siapa pun.
`npm run test:sandi` gagal bila ada penulisan sandi yang melewatkannya.

**Setiap permintaan yang mengubah data wajib menyertakan header
`X-CSRF-Token`.** Nilainya dibaca dari cookie `bpn_csrf` lewat `csrfToken()` di
`common.js`; `headerSesi(method)` sudah melakukannya otomatis. Ini diperlukan
karena cookie dikirim browser secara otomatis, termasuk pada permintaan yang
dipicu situs lain. `npm run test:sesi` menjaga keduanya tetap terpasang.
