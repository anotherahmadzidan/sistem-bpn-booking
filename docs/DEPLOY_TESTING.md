# Deploy Testing Server

Panduan ini untuk menaikkan aplikasi ke server testing/staging agar bisa diakses tim testing.

## Kebutuhan Server

- Node.js 20 LTS atau lebih baru
- MySQL/MariaDB
- Domain/subdomain testing, misalnya `testing-bpn.example.go.id`
- SMTP Gmail/app password yang sudah valid
- Reverse proxy seperti Nginx, atau panel hosting Node.js

## Environment Testing

Buat file `.env` di server berdasarkan `.env.example`.

Nilai penting untuk testing:

```env
NODE_ENV=production
PORT=3000
TRUST_PROXY=1
CORS_ORIGINS=https://domain-testing-anda
DB_HOST=localhost
DB_PORT=3306
DB_USER=user_database_testing
DB_PASSWORD=password_database_testing
DB_NAME=bpn_booking_testing
DB_SSL=false
DB_TIMEZONE=+08:00
JWT_SECRET=isi_secret_panjang_minimal_32_karakter
JWT_EXPIRES_IN=1d
EMAIL_USER=email_smtp@gmail.com
EMAIL_PASS=app_password_gmail_16_karakter
EMAIL_SERVICE=gmail
```

Jika memakai Clever Cloud MySQL, kamu boleh langsung memakai env dari Clever Cloud:

```env
MYSQL_ADDON_HOST=host_mysql_clever_cloud
MYSQL_ADDON_DB=nama_database_clever_cloud
MYSQL_ADDON_USER=user_database_clever_cloud
MYSQL_ADDON_PORT=3306
MYSQL_ADDON_PASSWORD=password_database_clever_cloud
MYSQL_ADDON_URI=mysql://user:password@host:3306/database
DB_TIMEZONE=+08:00
```

Aplikasi akan memprioritaskan `MYSQL_ADDON_*` di atas `DB_*`.

## Perintah Deploy

Jalankan dari folder project di server:

```powershell
npm ci --omit=dev
npm.cmd run test:db
npm.cmd run test:email
npm start
```

Untuk Linux server:

```bash
npm ci --omit=dev
npm run test:db
npm run test:email
npm start
```

Jika memakai PM2:

```bash
npm install -g pm2
pm2 start server.js --name bpn-booking-testing
pm2 save
pm2 startup
```

## Health Check

Setelah server berjalan, cek:

```text
https://domain-testing-anda/api/health
```

Respons sehat:

```json
{
  "status": "ok",
  "database": "ok"
}
```

## Nginx Reverse Proxy

Contoh konfigurasi:

```nginx
server {
    listen 80;
    server_name domain-testing-anda;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Catatan Penting

- Gunakan database testing terpisah dari data asli.
- Jangan upload `.env`, `node_modules`, atau `public/uploads` dari lokal.
- Pastikan enum `bookings.status` sudah mencakup `dibatalkan`.
- Set `CORS_ORIGINS` sesuai domain testing agar akses dari domain lain ditolak.
- Aktifkan HTTPS sebelum tim testing memakai akun sungguhan.
