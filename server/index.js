
import express from 'express';
import session from 'express-session';
import multer from 'multer';
import bcrypt from 'bcrypt';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import pool from './db.js';
import { initAll } from './init.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.API_PORT || 3001);

function withProjectTags(project) {
  let tags = [];
  try {
    const raw = project.tags_json;
    if (Array.isArray(raw)) tags = raw;
    else if (typeof raw === 'string' && raw.trim()) {
      const parsed = JSON.parse(raw);
      tags = Array.isArray(parsed) ? parsed : [];
    }
  } catch { tags = []; }
  let gallery = [];
  try {
    const rawGallery = project.gallery_json;
    if (Array.isArray(rawGallery)) gallery = rawGallery;
    else if (typeof rawGallery === 'string' && rawGallery.trim()) {
      const parsed = JSON.parse(rawGallery);
      gallery = Array.isArray(parsed) ? parsed : [];
    }
  } catch { gallery = []; }
  const topic = project.topic || null;
  const topicTitle = topic ? ({
    school: 'Школа: тогда и сейчас', family: 'Семейные истории',
    people: 'Люди и профессии', places: 'Памятные места',
    objects: 'Предметы и традиции', creative: 'Творческие работы',
  }[topic] || 'Материал участника') : 'Материал участника';
  const { tags_json: _tagsJson, gallery_json: _galleryJson, ...rest } = project;
  return { ...rest, tags, gallery, topic_title: topicTitle };
}

const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  '/uploads',
  express.static(uploadsDir),
);

app.use(
  session({
    name: 'svyaz.sid',
    secret: process.env.SESSION_SECRET || 'svyaz-pokoleniy-local-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024, files: 16 },
  fileFilter: (_req, file, cb) => {
    const allowed = file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/') || file.mimetype === 'application/pdf';
    if (allowed) cb(null, true);
    else cb(new Error('Формат этого файла не поддерживается'));
  },
});

function requireAdmin(req, res, next) {
  if (!req.session?.adminId) {
    return res.status(401).json({ message: 'Войдите в аккаунт администратора' });
  }
  next();
}

// Проверка работы API
app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'API работает' });
});

// Проверка авторизации
app.get('/api/auth/me', (req, res) => {
  if (!req.session?.adminId) {
    return res.json({ authenticated: false });
  }

  res.json({
    authenticated: true,
    username: req.session.adminUsername,
  });
});

// Вход администратора
app.post('/api/auth/login', async (req, res) => {
  try {
    const username =
      typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = req.body?.password;

    if (!username || typeof password !== 'string' || !password) {
      return res.status(400).json({ message: 'Введите логин и пароль' });
    }

    const [rows] = await pool.execute(
      'SELECT id, username, password_hash FROM admins WHERE username = ? LIMIT 1',
      [username],
    );

    if (!rows.length) {
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    const admin = rows[0];
    const valid =
      typeof admin.password_hash === 'string' &&
      admin.password_hash.startsWith('$2') &&
      await bcrypt.compare(password, admin.password_hash);

    if (!valid) {
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    req.session.regenerate((err) => {
      if (err) {
        console.error('Ошибка создания сессии:', err);
        return res.status(500).json({ message: 'Не удалось создать сессию' });
      }

      req.session.adminId = admin.id;
      req.session.adminUsername = admin.username;

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('Ошибка сохранения сессии:', saveErr);
          return res.status(500).json({ message: 'Не удалось сохранить сессию' });
        }

        res.json({
          success: true,
          authenticated: true,
          username: admin.username,
        });
      });
    });
  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ message: 'Внутренняя ошибка сервера' });
  }
});

// Выход администратора
app.post('/api/auth/logout', (req, res) => {
  if (!req.session) {
    return res.json({ success: true });
  }

  req.session.destroy((err) => {
    if (err) {
      console.error('Ошибка выхода:', err);
      return res.status(500).json({ message: 'Не удалось завершить сеанс' });
    }

    res.clearCookie('svyaz.sid');
    res.json({ success: true });
  });
});

// Публичный список: только утверждённые проекты
app.get('/api/projects', async (_req, res) => {
  try {
    const [projects] = await pool.execute(
      `SELECT * FROM projects WHERE status = 'approved' ORDER BY created_at DESC`,
    );

    res.json(projects.map(withProjectTags));
  } catch (error) {
    console.error('Ошибка загрузки проектов:', error);
    res.status(500).json({ message: 'Не удалось загрузить проекты' });
  }
});

// Один опубликованный проект: черновики и удалённые проекты публично недоступны
app.get('/api/projects/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: 'Некорректный ID проекта' });
    const [rows] = await pool.execute("SELECT * FROM projects WHERE id = ? AND status = 'approved' LIMIT 1", [id]);
    if (!rows.length) return res.status(404).json({ message: 'Проект не найден или ещё не опубликован' });
    res.json(withProjectTags(rows[0]));
  } catch (error) {
    console.error('Ошибка загрузки проекта:', error);
    res.status(500).json({ message: 'Не удалось загрузить проект' });
  }
});

// Отправка проекта на рассмотрение
app.post('/api/projects', (req, res) => {
  // Принимаем multipart-файлы, а затем сами сопоставляем допустимые имена.
  // Это предотвращает непрозрачную ошибку Multer Unexpected file field,
  // если старый фронтенд отправляет, например, cover вместо image.
  upload.any()(req, res, async (uploadError) => {
    if (uploadError) {
      const message =
        uploadError.code === 'LIMIT_FILE_SIZE'
          ? 'Размер файла не должен превышать 60 МБ'
          : uploadError.code === 'LIMIT_FILE_COUNT'
            ? 'Можно прикрепить не более 16 файлов'
            : uploadError.message || 'Ошибка загрузки файла';

      return res.status(400).json({ message });
    }

    const fieldAliases = {
      image: 'image',
      cover: 'image',
      coverImage: 'image',
      cover_image: 'image',
      thumbnail: 'image',
      // Несколько фотографий к проекту: поле images допускает больше одного файла
      images: 'images',
      photos: 'images',
      gallery: 'images',
      media: 'media',
      file: 'media',
      projectFile: 'media',
      project_file: 'media',
      beforeImage: 'beforeImage',
      before_image: 'beforeImage',
      before: 'beforeImage',
      afterImage: 'afterImage',
      after_image: 'afterImage',
      after: 'afterImage',
    };
    // В эти поля разрешён ровно один файл, в images сколько угодно (в пределах лимита).
    const singleFileFields = new Set(['image', 'media', 'beforeImage', 'afterImage']);
    const files = {};
    for (const file of req.files || []) {
      const normalizedField = fieldAliases[file.fieldname];
      if (!normalizedField) {
        for (const uploaded of req.files || []) {
          try { fs.unlinkSync(uploaded.path); } catch { /* файл мог уже отсутствовать */ }
        }
        return res.status(400).json({
          message: `Неизвестное поле файла "${file.fieldname}". Используй image для обложки, images для фотографий, media для материала, beforeImage и afterImage для сравнения.`,
        });
      }
      if (singleFileFields.has(normalizedField) && files[normalizedField]) {
        for (const uploaded of req.files || []) {
          try { fs.unlinkSync(uploaded.path); } catch { /* файл мог уже отсутствовать */ }
        }
        return res.status(400).json({
          message: `Для поля "${normalizedField}" можно загрузить только один файл.`,
        });
      }
      files[normalizedField] = files[normalizedField] || [];
      files[normalizedField].push(file);
    }

    try {
      const title = String(req.body?.title || '').trim();
      const author = String(req.body?.author || '').trim();
      const email = String(req.body?.email || '').trim();
      const description = String(req.body?.description || '').trim();
      const topic = String(req.body?.topic || '').trim();
      const projectType = String(req.body?.project_type || 'photo').trim();
      const authorRole = String(req.body?.author_role || '').trim();
      const projectDate = String(req.body?.project_date || '').trim();
      const sourceInfo = String(req.body?.source_info || '').trim();
      const cover = files.image?.[0] || null;
      const media = files.media?.[0] || null;
      const beforeImage = files.beforeImage?.[0] || null;
      const afterImage = files.afterImage?.[0] || null;
      const gallery = files.images || [];
      const allowedTypes = new Set(['photo', 'story', 'video', 'gif', 'pair', 'other']);
      const allowedTopics = new Set(['school', 'family', 'people', 'places', 'objects', 'creative']);

      if (!title || !author || !description || !cover) {
        return res.status(400).json({ message: 'Заполните название, описание, автора и добавьте обложку' });
      }
      if (!cover.mimetype.startsWith('image/')) return res.status(400).json({ message: 'Обложка должна быть изображением' });
      if (cover.size > 8 * 1024 * 1024) return res.status(400).json({ message: 'Обложка не должна превышать 8 МБ' });
      if (!allowedTypes.has(projectType)) return res.status(400).json({ message: 'Неизвестный формат проекта' });
      if (!allowedTopics.has(topic)) return res.status(400).json({ message: 'Выберите тему проекта' });
      if (projectType === 'video' && (!media || !media.mimetype.startsWith('video/'))) return res.status(400).json({ message: 'Для проекта-видео прикрепите видеофайл' });
      if (projectType === 'gif' && (!media || media.mimetype !== 'image/gif')) return res.status(400).json({ message: 'Для GIF-проекта прикрепите GIF-файл' });
      if (projectType === 'pair' && (!beforeImage || !afterImage || !beforeImage.mimetype.startsWith('image/') || !afterImage.mimetype.startsWith('image/'))) return res.status(400).json({ message: 'Для сравнения нужны два изображения' });
      if (gallery.length > 12) return res.status(400).json({ message: 'Можно приложить не более 12 фотографий' });
      for (const photo of gallery) {
        if (!photo.mimetype.startsWith('image/')) return res.status(400).json({ message: 'В списке фотографий могут быть только изображения' });
        if (photo.size > 8 * 1024 * 1024) return res.status(400).json({ message: 'Каждая фотография не должна превышать 8 МБ' });
      }
      if (title.length > 200 || author.length > 150 || email.length > 255 || authorRole.length > 150 || sourceInfo.length > 500) {
        return res.status(400).json({ message: 'Некоторые поля слишком длинные' });
      }

      let tags = [];
      try {
        const rawTags = JSON.parse(String(req.body?.tags || '[]'));
        if (Array.isArray(rawTags)) tags = [...new Set(rawTags.map((tag) => String(tag).replace(/^#+/, '').trim()).filter(Boolean))].slice(0, 20);
      } catch { tags = []; }
      const imageUrl = `/uploads/${cover.filename}`;
      const mediaUrl = media ? `/uploads/${media.filename}` : null;
      const beforeUrl = beforeImage ? `/uploads/${beforeImage.filename}` : null;
      const afterUrl = afterImage ? `/uploads/${afterImage.filename}` : null;
      const galleryUrls = gallery.map((photo) => `/uploads/${photo.filename}`);

      const [result] = await pool.execute(
        `INSERT INTO projects
          (title, description, author, email, image_url, status, topic, project_type,
           media_url, before_image_url, after_image_url, author_role, project_date, source_info, tags_json, gallery_json)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [title, description, author, email, imageUrl, topic, projectType, mediaUrl, beforeUrl, afterUrl, authorRole || null, projectDate || null, sourceInfo || null, JSON.stringify(tags), JSON.stringify(galleryUrls)],
      );

      res.status(201).json({ success: true, id: result.insertId, message: 'Проект отправлен на рассмотрение администратору' });
    } catch (error) {
      console.error('Ошибка сохранения проекта:', error);
      res.status(500).json({ message: 'Не удалось сохранить проект' });
    }
  });
});

// Список всех проектов для администратора
app.get('/api/admin/projects', requireAdmin, async (_req, res) => {
  try {
    const [projects] = await pool.execute('SELECT * FROM projects ORDER BY created_at DESC');
    res.json(projects.map(withProjectTags));
  } catch (error) {
    console.error('Ошибка загрузки проектов для администратора:', error);
    res.status(500).json({ message: 'Не удалось загрузить проекты' });
  }
});

// Редактирование карточки проекта администратором (в том числе уже опубликованной).
app.patch('/api/admin/projects/:id', requireAdmin, (req, res) => {
  upload.any()(req, res, async (uploadError) => {
    if (uploadError) {
      return res.status(400).json({ message: uploadError.message || 'Ошибка загрузки обложки' });
    }
    const uploaded = req.files || [];
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) {
        for (const file of uploaded) { try { fs.unlinkSync(file.path); } catch {} }
        return res.status(400).json({ message: 'Некорректный ID проекта' });
      }
      const [rows] = await pool.execute('SELECT * FROM projects WHERE id = ? LIMIT 1', [id]);
      if (!rows.length) {
        for (const file of uploaded) { try { fs.unlinkSync(file.path); } catch {} }
        return res.status(404).json({ message: 'Проект не найден' });
      }
      if (uploaded.some((file) => file.fieldname !== 'image' || !file.mimetype.startsWith('image/'))) {
        for (const file of uploaded) { try { fs.unlinkSync(file.path); } catch {} }
        return res.status(400).json({ message: 'Можно загрузить только изображение обложки в поле image' });
      }
      const body = req.body || {};
      const allowedTypes = new Set(['photo', 'story', 'video', 'gif', 'pair', 'other']);
      const allowedTopics = new Set(['school', 'family', 'people', 'places', 'objects', 'creative']);
      const title = String(body.title ?? rows[0].title ?? '').trim();
      const description = String(body.description ?? rows[0].description ?? '').trim();
      const author = String(body.author ?? rows[0].author ?? '').trim();
      const email = String(body.email ?? rows[0].email ?? '').trim();
      const authorRole = String(body.author_role ?? rows[0].author_role ?? '').trim();
      const topic = String(body.topic ?? rows[0].topic ?? 'school').trim();
      const projectType = String(body.project_type ?? rows[0].project_type ?? 'photo').trim();
      const projectDate = String(body.project_date ?? rows[0].project_date ?? '').trim();
      const sourceInfo = String(body.source_info ?? rows[0].source_info ?? '').trim();
      if (!title || !description || !author) {
        for (const file of uploaded) { try { fs.unlinkSync(file.path); } catch {} }
        return res.status(400).json({ message: 'Название, описание и автор обязательны' });
      }
      if (!allowedTopics.has(topic) || !allowedTypes.has(projectType)) {
        for (const file of uploaded) { try { fs.unlinkSync(file.path); } catch {} }
        return res.status(400).json({ message: 'Выбран неизвестный раздел или тип проекта' });
      }
      if (title.length > 200 || author.length > 150 || email.length > 255 || authorRole.length > 150 || sourceInfo.length > 500 || projectDate.length > 80) {
        for (const file of uploaded) { try { fs.unlinkSync(file.path); } catch {} }
        return res.status(400).json({ message: 'Одно из полей превышает допустимую длину' });
      }
      let tags = [];
      try {
        const raw = typeof body.tags === 'string' ? body.tags : '[]';
        const parsed = raw.startsWith('[') ? JSON.parse(raw) : raw.split(/[,;\s]+/);
        if (Array.isArray(parsed)) tags = [...new Set(parsed.map((tag) => String(tag).replace(/^#+/, '').trim()).filter(Boolean))].slice(0, 20);
        else tags = [...new Set(parsed)].slice(0, 20);
      } catch { tags = String(body.tags || '').split(/[,;\s]+/).map((tag) => tag.replace(/^#+/, '').trim()).filter(Boolean).slice(0, 20); }
      const newCover = uploaded.find((file) => file.fieldname === 'image');
      const imageUrl = newCover ? `/uploads/${newCover.filename}` : rows[0].image_url;
      await pool.execute(
        `UPDATE projects SET title = ?, description = ?, author = ?, email = ?, image_url = ?, topic = ?, project_type = ?, author_role = ?, project_date = ?, source_info = ?, tags_json = ? WHERE id = ?`,
        [title, description, author, email, imageUrl, topic, projectType, authorRole || null, projectDate || null, sourceInfo || null, JSON.stringify(tags), id],
      );
      if (newCover && typeof rows[0].image_url === 'string' && rows[0].image_url.startsWith('/uploads/')) {
        const oldName = path.basename(rows[0].image_url);
        const oldPath = path.join(uploadsDir, oldName);
        if (oldName && oldName !== '.' && oldName !== path.sep) { try { fs.unlinkSync(oldPath); } catch {} }
      }
      res.json({ success: true, id, message: 'Карточка проекта обновлена' });
    } catch (error) {
      for (const file of uploaded) { try { fs.unlinkSync(file.path); } catch {} }
      console.error('Ошибка редактирования проекта:', error);
      res.status(500).json({ message: 'Не удалось сохранить изменения проекта' });
    }
  });
});

// Безвозвратное удаление доступно только для проектов, уже находящихся в «Удалённых».
app.delete('/api/admin/projects/:id/permanent', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ message: 'Некорректный ID проекта' });
    }
    const [rows] = await pool.execute('SELECT * FROM projects WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Проект не найден' });
    if (rows[0].status !== 'deleted') {
      return res.status(409).json({ message: 'Сначала переместите проект в раздел «Удалённые»' });
    }
    await pool.execute('DELETE FROM projects WHERE id = ?', [id]);
    for (const key of ['image_url', 'media_url', 'before_image_url', 'after_image_url']) {
      const value = rows[0][key];
      if (typeof value === 'string' && value.startsWith('/uploads/')) {
        const filename = path.basename(value);
        if (filename && filename !== '.' && filename !== path.sep) {
          try { fs.unlinkSync(path.join(uploadsDir, filename)); } catch (error) {
            if (error.code !== 'ENOENT') console.warn('Не удалось удалить файл проекта:', filename, error.message);
          }
        }
      }
    }
    // Дополнительные фотографии проекта (список ссылок в gallery_json)
    try {
      const gallery = JSON.parse(rows[0].gallery_json || '[]');
      if (Array.isArray(gallery)) {
        for (const value of gallery) {
          if (typeof value !== 'string' || !value.startsWith('/uploads/')) continue;
          const filename = path.basename(value);
          if (filename && filename !== '.' && filename !== path.sep) {
            try { fs.unlinkSync(path.join(uploadsDir, filename)); } catch (error) {
              if (error.code !== 'ENOENT') console.warn('Не удалось удалить фотографию проекта:', filename, error.message);
            }
          }
        }
      }
    } catch { /* некорректный JSON, пропускаем */ }
    return res.json({ success: true, id, message: 'Проект безвозвратно удалён' });
  } catch (error) {
    console.error('Ошибка безвозвратного удаления проекта:', error);
    return res.status(500).json({ message: 'Не удалось удалить проект навсегда' });
  }
});

// Утверждение, удаление и восстановление проекта
app.patch('/api/admin/projects/:id/:action', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const action = req.params.action;

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ message: 'Некорректный ID проекта' });
    }

    const statusByAction = {
      approve: 'approved',
      publish: 'approved',
      restore: 'approved',
      delete: 'deleted',
      remove: 'deleted',
    };

    const status = statusByAction[action];

    if (!status) {
      return res.status(400).json({ message: 'Неизвестное действие с проектом' });
    }

    const [result] = await pool.execute(
      'UPDATE projects SET status = ? WHERE id = ?',
      [status, id],
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Проект не найден' });
    }

    res.json({ success: true, id, status });
  } catch (error) {
    console.error('Ошибка изменения проекта:', error);
    res.status(500).json({ message: 'Не удалось изменить проект' });
  }
});

// Обработка ошибок сервера (четыре аргумента обязательны для Express)
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Ошибка сервера:', err);
  res.status(500).json({ message: 'Внутренняя ошибка сервера' });
});

initAll()
  .then(() => {
    app.listen(PORT, () => console.log(`API сервер запущен: http://localhost:${PORT}`));
  })
  .catch((error) => {
    console.error('Не удалось инициализировать базу данных:', error.message);
    process.exitCode = 1;
  });
