-- Skema database SIMPETA (BPN Kabupaten Luwu Timur)
-- Dibuat otomatis oleh: node scripts/dump-schema.js
-- Jangan diedit manual; ubah database lalu jalankan ulang skrip ini.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `kecamatan` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nama_kecamatan` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kabupaten` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Luwu Timur',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kelurahan` (
  `id` int NOT NULL AUTO_INCREMENT,
  `kecamatan_id` int NOT NULL,
  `nama_kelurahan` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `kecamatan_id` (`kecamatan_id`),
  CONSTRAINT `kelurahan_ibfk_1` FOREIGN KEY (`kecamatan_id`) REFERENCES `kecamatan` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nama_lengkap` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `no_hp` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email_verified_at` datetime DEFAULT NULL,
  `profile_completed_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `no_hp` (`no_hp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `petugas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nip` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nama_lengkap` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `no_hp` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nip` (`nip`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `uniq_petugas_no_hp` (`no_hp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nama_lengkap` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bookings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nomor_berkas` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` int NOT NULL,
  `petugas_id` int NOT NULL,
  `kecamatan_id` int NOT NULL,
  `kelurahan_id` int NOT NULL,
  `nama_pemohon` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tanggal_berkas` date NOT NULL,
  `alamat_lokasi` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `koordinat_maps` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `no_telepon` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tanggal_diminta` date NOT NULL,
  `tanggal_fix` date DEFAULT NULL,
  `reschedule_count` tinyint NOT NULL DEFAULT '0',
  `status` enum('pending','rescheduled_by_user','rescheduled_by_petugas','jadwal_fix','selesai','ditolak','dibatalkan') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nomor_berkas` (`nomor_berkas`),
  KEY `kecamatan_id` (`kecamatan_id`),
  KEY `kelurahan_id` (`kelurahan_id`),
  KEY `idx_tanggal_kecamatan` (`tanggal_diminta`,`kecamatan_id`),
  KEY `idx_tanggal_kelurahan` (`tanggal_diminta`,`kelurahan_id`),
  KEY `idx_tanggal_petugas` (`tanggal_diminta`,`petugas_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_petugas_id` (`petugas_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `bookings_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `bookings_ibfk_2` FOREIGN KEY (`petugas_id`) REFERENCES `petugas` (`id`),
  CONSTRAINT `bookings_ibfk_3` FOREIGN KEY (`kecamatan_id`) REFERENCES `kecamatan` (`id`),
  CONSTRAINT `bookings_ibfk_4` FOREIGN KEY (`kelurahan_id`) REFERENCES `kelurahan` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hasil_pemeriksaan` (
  `id` int NOT NULL AUTO_INCREMENT,
  `booking_id` int NOT NULL,
  `petugas_id` int NOT NULL,
  `nomor_berkas` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `foto_lokasi` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `foto_risalah` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `catatan_lapangan` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `booking_id` (`booking_id`),
  KEY `petugas_id` (`petugas_id`),
  CONSTRAINT `hasil_pemeriksaan_ibfk_1` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`),
  CONSTRAINT `hasil_pemeriksaan_ibfk_2` FOREIGN KEY (`petugas_id`) REFERENCES `petugas` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reschedule_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `booking_id` int NOT NULL,
  `tanggal_lama` date NOT NULL,
  `tanggal_baru` date NOT NULL,
  `diminta_oleh` enum('user','petugas') COLLATE utf8mb4_unicode_ci NOT NULL,
  `alasan` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `booking_id` (`booking_id`),
  CONSTRAINT `reschedule_log_ibfk_1` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `recipient_role` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user',
  `recipient_id` int DEFAULT NULL,
  `booking_id` int NOT NULL,
  `judul` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pesan` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `booking_id` (`booking_id`),
  KEY `idx_user_unread` (`user_id`,`is_read`),
  KEY `idx_notification_recipient` (`recipient_role`,`recipient_id`,`is_read`),
  CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `notifications_ibfk_2` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `otp_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `pending_registration_id` int DEFAULT NULL,
  `email` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `purpose` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `otp_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `attempts` int NOT NULL DEFAULT '0',
  `max_attempts` int NOT NULL DEFAULT '5',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_otp_lookup` (`email`,`purpose`,`used_at`,`created_at`),
  KEY `idx_otp_user` (`user_id`,`purpose`,`created_at`),
  KEY `idx_otp_pending` (`pending_registration_id`,`purpose`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pending_registrations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nama_lengkap` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `no_hp` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `verified_at` datetime DEFAULT NULL,
  `email_verified_at` datetime DEFAULT NULL,
  `status` enum('pending_email_verification','pending_profile_completion') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending_email_verification',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pending_email` (`email`),
  UNIQUE KEY `uniq_pending_no_hp` (`no_hp`),
  KEY `idx_pending_expires` (`expires_at`),
  KEY `idx_pending_verified` (`verified_at`),
  KEY `idx_pending_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kuota_default` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tipe` enum('kecamatan','kelurahan','petugas') COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_id` int NOT NULL,
  `kuota_max` int NOT NULL DEFAULT '10',
  `is_unlimited` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `set_order` bigint NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_kuota_default_target` (`tipe`,`target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kuota_kecamatan` (
  `id` int NOT NULL AUTO_INCREMENT,
  `kecamatan_id` int NOT NULL,
  `tanggal` date NOT NULL,
  `kuota_max` int NOT NULL DEFAULT '10',
  `terisi` int NOT NULL DEFAULT '0',
  `is_unlimited` tinyint(1) NOT NULL DEFAULT '0',
  `source` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'tanggal',
  `set_order` bigint NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_kec_tanggal` (`kecamatan_id`,`tanggal`),
  UNIQUE KEY `uniq_kuota_kecamatan_tanggal` (`kecamatan_id`,`tanggal`),
  CONSTRAINT `kuota_kecamatan_ibfk_1` FOREIGN KEY (`kecamatan_id`) REFERENCES `kecamatan` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kuota_kelurahan` (
  `id` int NOT NULL AUTO_INCREMENT,
  `kelurahan_id` int NOT NULL,
  `tanggal` date NOT NULL,
  `kuota_max` int NOT NULL DEFAULT '10',
  `terisi` int NOT NULL DEFAULT '0',
  `is_unlimited` tinyint(1) NOT NULL DEFAULT '0',
  `source` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'tanggal',
  `set_order` bigint NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_kel_tanggal` (`kelurahan_id`,`tanggal`),
  UNIQUE KEY `uniq_kuota_kelurahan_tanggal` (`kelurahan_id`,`tanggal`),
  CONSTRAINT `kuota_kelurahan_ibfk_1` FOREIGN KEY (`kelurahan_id`) REFERENCES `kelurahan` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kuota_petugas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `petugas_id` int NOT NULL,
  `tanggal` date NOT NULL,
  `kuota_max` int NOT NULL DEFAULT '10',
  `terisi` int NOT NULL DEFAULT '0',
  `source` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'tanggal',
  `set_order` bigint NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pet_tanggal` (`petugas_id`,`tanggal`),
  UNIQUE KEY `uniq_kuota_petugas_tanggal` (`petugas_id`,`tanggal`),
  CONSTRAINT `kuota_petugas_ibfk_1` FOREIGN KEY (`petugas_id`) REFERENCES `petugas` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `email_reminders` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `booking_id` int NOT NULL,
  `recipient_role` varchar(20) NOT NULL,
  `recipient_id` int NOT NULL,
  `reminder_type` varchar(30) NOT NULL,
  `scheduled_date` date NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `attempts` int NOT NULL DEFAULT '0',
  `last_error` varchar(500) DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_email_reminder` (`booking_id`,`recipient_role`,`reminder_type`,`scheduled_date`),
  KEY `idx_email_reminder_status` (`status`,`updated_at`),
  KEY `idx_email_reminder_recipient` (`recipient_role`,`recipient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

SET FOREIGN_KEY_CHECKS = 1;
