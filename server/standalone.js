// Подготовка автономной (офлайн) сборки dist.
//
//   node server/standalone.js pre   — выгружает проекты из MySQL в
//                                     src/data/standalone-projects.json (данные
//                                     попадают прямо в бандл: на file:// нельзя
//                                     делать fetch)
//   node server/standalone.js post  — копирует нужные медиафайлы в dist/uploads
//                                     и пишет инструкцию в dist
//
// pre запускается автоматически перед dev и build (см. "predev"/"prebuild"
// в package.json). Если база недоступна, файл остаётся прежним (или создаётся
// пустым), чтобы разработка и сборка не падали.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'src', 'data', 'standalone-projects.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DIST_DIR = path.join(ROOT, 'dist');

// Тот же словарь тем, что в server/index.js (withProjectTags)
const TOPIC_TITLES = {
  school: 'Школа: тогда и сейчас',
  family: 'Семейные истории',
  people: 'Люди и профессии',
  places: 'Памятные места',
  objects: 'Предметы и традиции',
  creative: 'Творческие работы',
};

function parseJson(value, fallback) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// Повторяет логику withProjectTags из server/index.js, но дополнительно
// переводит ссылки /uploads/... в относительные uploads/..., чтобы файлы
// находились и при открытии index.html с диска.
function prepareProject(raw) {
  const project = raw;
  const tags = parseJson(project.tags_json, []);
  const gallery = parseJson(project.gallery_json, []).map(toRelative);
  const topic = project.topic || null;
  const topicTitle = topic
    ? (TOPIC_TITLES[topic] || 'Материал участника')
    : 'Материал участника';

  const { tags_json: _tagsJson, gallery_json: _galleryJson, ...rest } = project;

  return {
    ...rest,
    image_url: toRelative(rest.image_url),
    media_url: toRelative(rest.media_url),
    before_image_url: toRelative(rest.before_image_url),
    after_image_url: toRelative(rest.after_image_url),
    tags,
    gallery,
    topic_title: topicTitle,
  };
}

function toRelative(value) {
  if (typeof value !== 'string') return value;
  if (value.startsWith('/uploads/')) return value.slice(1); // "/uploads/a.jpg" -> "uploads/a.jpg"
  return value;
}

function emptyData(admin) {
  return {
    generated_at: new Date().toISOString(),
    offline: true,
    admin,
    projects: [],
  };
}

function adminFromEnv() {
  return {
    username: process.env.ADMIN_USERNAME || 'admin',
    // Пароль для входа в админку офлайн-версии берём из server/.env.
    // Он же лежит там открытым текстом, секретность на file:// бессмысленна.
    password: process.env.ADMIN_PASSWORD || '',
  };
}

async function pre() {
  // db.js сам подхватывает server/.env
  const { default: pool } = await import('./db.js');
  const admin = adminFromEnv();

  let rows = null;
  try {
    const [result] = await pool.query(
      'SELECT * FROM projects ORDER BY created_at DESC, id DESC',
    );
    rows = result;
  } catch (error) {
    if (!fs.existsSync(DATA_FILE)) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(emptyData(admin), null, 2));
      console.warn(
        `База данных недоступна (${error.message}). Создан пустой ${path.relative(ROOT, DATA_FILE)} — каталог будет пустым.`,
      );
      await pool.end().catch(() => {});
      return;
    }
    console.warn(
      `База данных недоступна (${error.message}). Используется прежний ${path.relative(ROOT, DATA_FILE)}.`,
    );
    await pool.end().catch(() => {});
    return;
  }

  await pool.end();

  const data = {
    generated_at: new Date().toISOString(),
    offline: true,
    admin,
    projects: rows.map((row) => prepareProject(row)),
  };

  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

  const files = new Set();
  for (const project of data.projects) {
    for (const value of [project.image_url, project.media_url, project.before_image_url, project.after_image_url, ...(project.gallery || [])]) {
      if (typeof value === 'string' && value.startsWith('uploads/')) files.add(path.basename(value));
    }
  }

  console.log(
    `Данные для автономной сборки: ${data.projects.length} проектов, ${files.size} медиафайлов -> ${path.relative(ROOT, DATA_FILE)}`,
  );
}

function referencedFiles() {
  if (!fs.existsSync(DATA_FILE)) return new Set();
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const files = new Set();
  for (const project of data.projects || []) {
    const values = [
      project.image_url,
      project.media_url,
      project.before_image_url,
      project.after_image_url,
      ...(Array.isArray(project.gallery) ? project.gallery : []),
    ];
    for (const value of values) {
      if (typeof value === 'string' && value.startsWith('uploads/')) {
        files.add(path.basename(value));
      }
    }
  }
  return files;
}

function post() {
  const htmlPath = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(htmlPath)) {
    throw new Error('dist/index.html не найден — сначала выполните vite build');
  }

  const html = fs.readFileSync(htmlPath, 'utf8');
  if (html.includes('type="module"')) {
    console.warn('ВНИМАНИЕ: в dist/index.html остался type="module" — файл не откроется двойным кликом.');
  }

  const files = referencedFiles();
  const targetDir = path.join(DIST_DIR, 'uploads');
  fs.mkdirSync(targetDir, { recursive: true });

  let copied = 0;
  let skipped = 0;
  let missing = 0;
  let bytes = 0;

  for (const name of files) {
    const source = path.join(UPLOADS_DIR, name);
    const target = path.join(targetDir, name);

    if (!fs.existsSync(source)) {
      missing += 1;
      continue;
    }
    if (fs.existsSync(target) && fs.statSync(target).size === fs.statSync(source).size) {
      skipped += 1;
      bytes += fs.statSync(target).size;
      continue;
    }

    fs.copyFileSync(source, target);
    copied += 1;
    bytes += fs.statSync(target).size;
  }

  const instructions = [
    'АВТОНОМНАЯ ВЕРСИЯ ПОРТАЛА «СВЯЗЬ ПОКОЛЕНИЙ»',
    '',
    'Как открыть:',
    '  1. Скопируйте ВСЮ папку целиком (index.html, assets, images, uploads) на любой компьютер.',
    '  2. Откройте файл index.html двойным кликом — интернет и база данных не нужны.',
    '',
    'Что работает автономно:',
    '  - каталог, главная страница и карточки проектов (включая фото и видео);',
    '  - отправка нового проекта (фото сохраняются в браузере, видео — нет);',
    '  - админка на #/admin: вход, одобрение, редактирование, удаление.',
    '',
    'Важно:',
    '  - изменения сохраняются в этом браузере (localStorage) и на другие компьютеры',
    '    не переносятся; очистка данных сайта сотрёт их — каталог вернётся к исходному;',
    '  - вход в админку: логин admin, пароль из server/.env (ADMIN_PASSWORD) на момент сборки;',
    '  - папку index.html нельзя открывать, вытащив её из остальных файлов: рядом обязаны',
    '    лежать папки assets, images и uploads.',
    '',
    `Собрано: ${new Date().toLocaleString('ru-RU')}`,
    '',
  ].join('\r\n');

  // BOM: чтобы старые версии Блокнота показывали кириллицу, а не «кракозябры»
  fs.writeFileSync(path.join(DIST_DIR, 'ИНСТРУКЦИЯ.txt'), '\uFEFF' + instructions, 'utf8');

  const mb = (bytes / (1024 * 1024)).toFixed(1);
  console.log(
    `dist готов: скопировано файлов ${copied}, пропущено ${skipped}, отсутствует ${missing} (${mb} МБ), инструкция dist/ИНСТРУКЦИЯ.txt`,
  );
  if (missing > 0) {
    console.warn('Часть файлов не найдена в server/uploads — эти картинки будут отображаться без изображения.');
  }
}

const command = process.argv[2];

if (command === 'pre') {
  await pre();
} else if (command === 'post') {
  post();
} else {
  console.error('Использование: node server/standalone.js <pre|post>');
  process.exitCode = 1;
}
