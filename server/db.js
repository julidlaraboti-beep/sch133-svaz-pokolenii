import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');


if (process.env.NODE_ENV !== 'production') {
  if (!fs.existsSync(envPath)) {
    fs.copyFileSync(
      path.join(__dirname, '.env.example'),
      envPath,
    );
    console.log('Создан server/.env из server/.env.example.');
  }

  dotenv.config({ path: envPath, override: false });
}

console.log('ENV check:', {
  nodeEnv: process.env.NODE_ENV || '(не задан)',
  railway: process.env.RAILWAY_ENVIRONMENT || '(не задан)',
  dbHost: process.env.DB_HOST || '(не задан)',
  dbPort: process.env.DB_PORT || '(не задан)',
  dbName: process.env.DB_NAME || '(не задан)',
  dbUser: process.env.DB_USER || '(не задан)',
});

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
        `Нет доступа к базе данных для пользователя "${dbConfig.user}". Проверьте DB_USER и права пользователя MySQL в Railway.`,
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
