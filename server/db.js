import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');

if (!fs.existsSync(envPath)) {
  fs.copyFileSync(path.join(__dirname, '.env.example'), envPath);
  console.log('Создан server/.env из server/.env.example — при необходимости поправьте значения.');
}

dotenv.config({ path: envPath });

export const DB_NAME = process.env.DB_NAME || 'svyaz_pokoleniy';

export const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'svyaz',
  password: process.env.DB_PASSWORD || 'svyaz_local',
  charset: 'utf8mb4',
};

export async function ensureDatabaseExists() {
  const connection = await mysql.createConnection({ ...dbConfig });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } catch (error) {
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      throw new Error(
        `Нет доступа к MariaDB для пользователя "${dbConfig.user}". Выполните один раз:\n  sudo mysql < server/setup-user.sql`,
      );
    }
    throw error;
  } finally {
    await connection.end();
  }
}

const pool = mysql.createPool({
  ...dbConfig,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

export default pool;
