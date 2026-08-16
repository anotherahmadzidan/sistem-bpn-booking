# To-Do Penyempurnaan Sistem Sebelum Deploy

## Prioritas 1: Keamanan Kritis
- [x] Isi `.gitignore` dan pastikan `.env`, `node_modules`, log, dan upload lokal tidak ikut Git.
- [x] Buat `.env.example` tanpa password/token asli.
- [ ] Ganti `JWT_SECRET` dengan secret kuat dan panjang.
- [x] Batasi CORS hanya ke domain aplikasi resmi.
- [x] Tambahkan rate limiting untuk endpoint login/register.
- [ ] Tambahkan validasi input backend untuk semua form.
- [ ] Escape/sanitasi semua data user sebelum ditampilkan ke `innerHTML`.
- [ ] Kurangi penggunaan `innerHTML`, pakai `textContent` untuk teks biasa.
- [x] Batasi upload file: hanya gambar, ukuran maksimal, ekstensi aman, validasi MIME.
- [x] Jangan simpan file upload langsung sebagai aset publik tanpa validasi.
- [x] Tambahkan proteksi HTTP security headers dengan `helmet`.

## Prioritas 2: Validasi Alur Booking
- [x] Validasi tanggal booking tidak boleh masa lalu.
- [x] Validasi `tanggal_berkas` tidak boleh masa depan.
- [x] Validasi kelurahan benar-benar milik kecamatan yang dipilih.
- [x] Validasi petugas masih aktif saat booking dibuat.
- [x] Cek kuota ulang saat reschedule user.
- [x] Cek kuota ulang saat petugas menetapkan jadwal baru.
- [x] Pastikan pengurangan kuota tidak bisa menjadi negatif.
- [x] Rapikan status booking agar konsisten.
- [ ] Tambahkan audit log untuk perubahan status penting.

## Prioritas 3: Database & Deploy
- [ ] Buat file schema SQL/migration untuk semua tabel.
- [ ] Tambahkan seed data awal untuk admin, kecamatan, kelurahan.
- [ ] Pastikan semua foreign key dan unique constraint benar.
- [ ] Tambahkan index untuk kolom pencarian penting.
- [ ] Tambahkan constraint unik untuk kuota per tanggal dan target.
- [ ] Siapkan backup database otomatis.
- [ ] Pisahkan environment development dan production.
- [x] Pastikan timezone server/database konsisten dengan WITA.

## Prioritas 4: UI/UX
- [x] Perbaiki encoding karakter rusak di halaman HTML.
- [x] Buat CSS khusus dan konsisten untuk halaman petugas.
- [x] Buat CSS khusus dan konsisten untuk halaman admin.
- [x] Pastikan tampilan responsive di mobile, tablet, dan desktop.
- [ ] Tambahkan loading state, empty state, dan error state yang rapi.
- [ ] Rapikan tabel admin agar nyaman dipakai saat data banyak.
- [x] Tambahkan badge status booking yang konsisten warnanya.
- [x] Tambahkan modal konfirmasi untuk aksi berisiko.
- [ ] Pastikan semua tombol disabled saat request sedang berjalan.

## Prioritas 5: Fitur Operasional
- [ ] Tambahkan pencarian dan filter lanjutan di admin.
- [ ] Tambahkan pagination untuk daftar berkas dan petugas.
- [ ] Tambahkan export data berkas ke Excel/PDF.
- [ ] Tambahkan halaman detail berkas yang lebih lengkap untuk admin.
- [ ] Tambahkan preview foto hasil pemeriksaan.
- [ ] Tambahkan riwayat aktivitas per berkas.
- [ ] Tambahkan reset password untuk user/petugas/admin.
- [ ] Tambahkan fitur ubah profil/password.
- [x] Tambahkan template email yang lebih aman dan rapi.

## Prioritas 6: Testing & Monitoring
- [ ] Tambahkan test manual checklist untuk tiap role.
- [ ] Tambahkan unit/integration test untuk auth, booking, kuota, reschedule.
- [ ] Test upload file dengan file valid dan file berbahaya.
- [ ] Test race condition kuota dengan request bersamaan.
- [ ] Test login gagal berkali-kali.
- [x] Tambahkan logging error backend.
- [ ] Tambahkan monitoring uptime.
- [x] Tambahkan handler error global di Express.
- [x] Pastikan server tidak membocorkan stack trace di production.
