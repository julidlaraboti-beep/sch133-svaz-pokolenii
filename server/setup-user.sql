-- Одноразовая настройка: выполнить один раз под root:
--   sudo mysql < server/setup-user.sql
-- Создаёт базу и локального пользователя для приложения.

CREATE DATABASE IF NOT EXISTS svyaz_pokoleniy
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'svyaz'@'localhost' IDENTIFIED BY 'svyaz_local';
CREATE USER IF NOT EXISTS 'svyaz'@'127.0.0.1' IDENTIFIED BY 'svyaz_local';

GRANT ALL PRIVILEGES ON svyaz_pokoleniy.* TO 'svyaz'@'localhost';
GRANT ALL PRIVILEGES ON svyaz_pokoleniy.* TO 'svyaz'@'127.0.0.1';

FLUSH PRIVILEGES;
