import pool from './db.js';
import { initAll } from './init.js';

async function main() {
  const { seeded, adminCreated } = await initAll();

  console.log('Инициализация базы данных завершена.');
  if (seeded) console.log('Импортированы начальные данные проектов (server/seed.sql).');
  if (adminCreated) {
    console.log(`Создан администратор: ${process.env.ADMIN_USERNAME || 'admin'} (пароль из server/.env).`);
  }

  await pool.end();
}

main().catch((error) => {
  console.error('Ошибка инициализации:', error.message);
  process.exitCode = 1;
});
