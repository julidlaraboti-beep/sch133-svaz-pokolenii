
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import pool from './db.js';
import { initAll } from './init.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

async function main() {
  try {
    await initAll();

    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD;

    if (!password || password.length < 12) {
      throw new Error(
        `Пароль не прочитан или слишком короткий. Длина: ${password?.length ?? 0}. Проверь server/.env`
      );
    }

    const hash = await bcrypt.hash(password, 12);

    await pool.execute(
      `INSERT INTO admins (username, password_hash)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
      [username, hash]
    );

    console.log('Администратор создан или обновлён!');
    console.log(`Логин: ${username}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Ошибка создания администратора:', error.message);
  process.exitCode = 1;
});
