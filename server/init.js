import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import pool, { ensureDatabaseExists } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function ensureProjectColumns() {
  await pool.execute(`CREATE TABLE IF NOT EXISTS projects (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description LONGTEXT NOT NULL,
    author VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL,
    image_url VARCHAR(1000) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    topic VARCHAR(80) NULL,
    project_type VARCHAR(40) NOT NULL DEFAULT 'photo',
    media_url VARCHAR(1000) NULL,
    before_image_url VARCHAR(1000) NULL,
    after_image_url VARCHAR(1000) NULL,
    author_role VARCHAR(150) NULL,
    project_date VARCHAR(80) NULL,
    source_info VARCHAR(500) NULL,
    tags_json TEXT NULL,
    gallery_json TEXT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS admins (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(80) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  const columns = {
    updated_at: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    topic: 'VARCHAR(80) NULL',
    project_type: "VARCHAR(40) NOT NULL DEFAULT 'photo'",
    media_url: 'VARCHAR(1000) NULL',
    before_image_url: 'VARCHAR(1000) NULL',
    after_image_url: 'VARCHAR(1000) NULL',
    author_role: 'VARCHAR(150) NULL',
    project_date: 'VARCHAR(80) NULL',
    source_info: 'VARCHAR(500) NULL',
    tags_json: 'TEXT NULL',
    gallery_json: 'TEXT NULL',
  };
  const [existing] = await pool.execute('SHOW COLUMNS FROM projects');
  const names = new Set(existing.map((column) => column.Field));
  for (const [name, definition] of Object.entries(columns)) {
    if (!names.has(name)) {
      await pool.execute(`ALTER TABLE projects ADD COLUMN ${name} ${definition}`);
    }
  }
}

async function seedIfEmpty() {
  const [rows] = await pool.execute('SELECT COUNT(*) AS total FROM projects');
  if (rows[0].total > 0) return false;

  const seedPath = path.join(__dirname, 'seed.sql');
  if (!fs.existsSync(seedPath)) return false;

  const sql = fs.readFileSync(seedPath, 'utf8').trim();
  if (!sql) return false;

  await pool.query(sql);
  return true;
}

async function ensureAdmin() {
  const [rows] = await pool.execute('SELECT COUNT(*) AS total FROM admins');
  if (rows[0].total > 0) return false;

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;

  if (!password || password.length < 12) {
    console.warn(
      'Администратор не создан: задайте ADMIN_PASSWORD (минимум 12 символов) в server/.env и выполните npm run setup.',
    );
    return false;
  }

  const hash = await bcrypt.hash(password, 12);
  await pool.execute('INSERT INTO admins (username, password_hash) VALUES (?, ?)', [username, hash]);
  return true;
}

export async function initAll() {
  await ensureDatabaseExists();
  await ensureProjectColumns();
  const seeded = await seedIfEmpty();
  const adminCreated = await ensureAdmin();
  return { seeded, adminCreated };
}
