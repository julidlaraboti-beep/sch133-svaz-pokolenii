# Связь поколений — школьный конкурс «Мы помним связь поколений»

Портал конкурса: React (Vite) + Express + MariaDB/MySQL.

## Требования

- Node.js 18+
- MariaDB или MySQL, запущенный локально
  - Debian/Ubuntu: `sudo apt install mariadb-server`
  - macOS: `brew install mariadb && brew services start mariadb`
  - Windows: `winget install MariaDB.Server`, служба `MariaDB` запускается
    автоматически (при необходимости — `Start-Service MariaDB` в PowerShell
    от имени администратора)

## Первоначальная настройка (один раз)

1. Создайте базу и пользователя для приложения (потребуется пароль sudo/root):

   ```bash
   sudo mysql < server/setup-user.sql
   ```

   На Windows (PowerShell, от имени администратора):

   ```powershell
   cmd /c "`"C:\Program Files\MariaDB 13.0\bin\mariadb.exe`" -u root < server\setup-user.sql"
   ```

2. Установите зависимости:

   ```bash
   npm install
   ```

3. Инициализируйте базу (создаст `server/.env` из примера, таблицы, импортирует
   начальные проекты и создаст администратора):

   ```bash
   npm run setup
   ```

## Запуск

```bash
# API-сервер (http://localhost:3001)
npm run server

# фронтенд Vite (http://localhost:5173) — в отдельном терминале
npm run dev

# или оба сразу
npm run dev:all
```

Сайт открывается по адресу http://localhost:5173 — Vite проксирует `/api` и
`/uploads` на API-сервер.

При первом запуске `npm run server` на пустой базе автоматически выполняется
та же инициализация, что и `npm run setup` (таблицы, seed, админ).

## Автономная сборка (dist)

```bash
npm run build
```

`dist/` получается полностью автономной версией: **достаточно скопировать папку
на любой компьютер и открыть `index.html` двойным кликом** — интернет, Node.js
и база данных не нужны.

Что для этого меняется в сборке:

- проекты выгружаются из базы в `src/data/standalone-projects.json` и попадают
  прямо в бандл — на `file://` браузер запрещает `fetch`;
- медиафайлы копируются в `dist/uploads/`, а все пути делаются относительными;
- бандл собирается обычным классическим скриптом (без `type="module"`) —
  внешние ES-модули браузеры с диска не загружают из-за CORS;
- `base: './'` — ассеты ищутся рядом с `index.html`, а не от корня диска.

Что работает автономно: каталог, карточки проектов (включая фото и видео),
отправка новых проектов, админка на `#/admin` (вход, одобрение, редактирование,
удаление).

Особенности автономного режима:

- изменения сохраняются в `localStorage` **этого браузера** и на другие
  компьютеры не переносятся: очистка данных сайта вернёт каталог к исходному;
- загруженные офлайн-фотографии ужимаются до 1600 px (иначе не влезут в
  хранилище браузера), видеофайлы при отправке не сохраняются — публикация
  видео работает только через сервер;
- вход в админку: `admin` + `ADMIN_PASSWORD` из `server/.env` **на момент
  сборки** (пароль вшит в бандл, поэтому меняйте его до публикации);
- в `dist/ИНСТРУКЦИЯ.txt` лежит краткая памятка для того, кто будет открывать.

Автопроверка сборки в реальном браузере (Headless Edge, 15 сценариев —
отрисовка с диска, картинки, видео, отправка проекта, админка, публикация,
сохранение после перезагрузки):

```bash
npm run test:offline
```

Перед `npm run dev` и `npm run build` автоматически выполняется
`node server/standalone.js pre` (нужен запущенный MariaDB). Если база
недоступна, берётся ранее выгруженный файл, разработка и сборка не падают.

## Администратор

- Логин: `admin` (задаётся `ADMIN_USERNAME` в `server/.env`)
- Пароль: из `ADMIN_PASSWORD` в `server/.env`
- Админка: http://localhost:5173/admin

Чтобы сбросить пароль админа — поменяйте `ADMIN_PASSWORD` в `server/.env`
(минимум 12 символов) и выполните `node server/create-admin.js`.

## Конфигурация

Все настройки — в `server/.env` (создаётся автоматически из
`server/.env.example`):

| Переменная | Назначение |
| --- | --- |
| `API_PORT` | Порт API-сервера (по умолчанию 3001) |
| `DB_HOST`, `DB_PORT` | Хост и порт базы данных |
| `DB_NAME`, `DB_USER`, `DB_PASSWORD` | База и пользователь БД |
| `SESSION_SECRET` | Секрет сессий (смените при публикации) |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Учётные данные администратора |

## Структура

- `src/` — фронтенд (React + Vite)
- `src/lib/api.js` — запросы к API; на `file://` уходит в автономный режим
- `src/lib/standalone.js` — автономный API (данные из бандла + localStorage)
- `server/index.js` — API Express
- `server/db.js` — подключение к базе
- `server/init.js` — авто-инициализация (таблицы, seed, админ)
- `server/standalone.js` — подготовка автономной сборки (pre/post)
- `server/seed.sql` — начальные данные проектов
- `server/setup-user.sql` — SQL для создания пользователя БД
- `server/uploads/` — загруженные файлы (не в git)
- `test/standalone.e2e.mjs` — проверка dist в Headless Edge (`npm run test:offline`)
- `dist/` — собранная автономная версия (не в git)

## Заметки

- Если в Windows PowerShell команда `npm` не запускается с ошибкой про
  `npm.ps1` — выполните один раз:
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
- Каталог `server/uploads/` и файлы загрузок не хранятся в git. Проекты из
  seed-данных будут отображаться без изображений, пока файлы не загрузят через
  админку.
- `node_modules`, `dist`, `server/.env` и `*.sql` (кроме seed) в git не входят.
