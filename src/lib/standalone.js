// Автономный (офлайн) режим API.
//
// dist/index.html открывается с диска (file://), где браузер запрещает fetch,
// внешние модули и IndexedDB. Поэтому проекты выгружаются из базы прямо в бандл
// (src/data/standalone-projects.json, см. server/standalone.js pre), а все
// изменения пользователя живут в localStorage этого браузера.
//
// Сообщения об ошибках совпадают с server/index.js, чтобы интерфейс вёл себя
// одинаково в обоих режимах.

import baked from '@/data/standalone-projects.json'

const STORAGE_KEY = 'svyaz.standalone.v1'

const TOPIC_TITLES = {
  school: 'Школа: тогда и сейчас',
  family: 'Семейные истории',
  people: 'Люди и профессии',
  places: 'Памятные места',
  objects: 'Предметы и традиции',
  creative: 'Творческие работы',
}

const ALLOWED_TYPES = new Set(['photo', 'story', 'video', 'gif', 'pair', 'other'])
const ALLOWED_TOPICS = new Set(['school', 'family', 'people', 'places', 'objects', 'creative'])

const STATUS_BY_ACTION = {
  approve: 'approved',
  publish: 'approved',
  restore: 'approved',
  delete: 'deleted',
  remove: 'deleted',
}

const MAX_RAW_BYTES = 700 * 1024 // до этого размера кладём файл как есть
const MAX_ATTACH_BYTES = 1.5 * 1024 * 1024 // предел для не пережимаемых файлов (GIF, PDF)
const IMAGE_MAX_SIDE = 1600
const IMAGE_QUALITY = 0.82

let state = null

export function isStandalone() {
  return typeof window !== 'undefined' && window.location.protocol === 'file:'
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function initialState() {
  const projects = Array.isArray(baked.projects) ? clone(baked.projects) : []
  const nextId = projects.reduce((max, project) => Math.max(max, Number(project.id) || 0), 0) + 1

  return {
    projects,
    admin: {
      username: (baked.admin && baked.admin.username) || 'admin',
      password: (baked.admin && baked.admin.password) || '',
    },
    authenticated: false,
    nextId,
  }
}

function readState() {
  if (state) return state

  state = initialState()

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw)
      if (saved && Array.isArray(saved.projects)) {
        // Данные для входа всегда берём из бандла, а не из хранилища
        state = { ...state, ...saved, admin: state.admin }
        state.nextId = Math.max(
          state.nextId,
          state.projects.reduce((max, project) => Math.max(max, Number(project.id) || 0), 0) + 1,
        )
      }
    }
  } catch {
    // Приватный режим или повреждённые данные — работаем на встроенной копии
  }

  return state
}

function isQuotaError(error) {
  return Boolean(
    error &&
      (error.name === 'QuotaExceededError' ||
        error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        error.code === 22),
  )
}

function persist() {
  const current = state

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
    return
  } catch (error) {
    if (!isQuotaError(error)) {
      throw new Error(`Не удалось сохранить данные в браузере: ${error.message}`)
    }
  }

  // Место кончилось: у локальных проектов постепенно убираем прикреплённые
  // изображения, пока изменения не влезут в квоту браузера.
  const local = current.projects.filter((project) => project.__local)

  const steps = [
    (project) => { project.gallery = [] },
    (project) => {
      project.media_url = null
      project.before_image_url = null
      project.after_image_url = null
      project.gallery = []
    },
    (project) => {
      project.image_url = null
      project.media_url = null
      project.before_image_url = null
      project.after_image_url = null
      project.gallery = []
    },
  ]

  for (const step of steps) {
    local.forEach(step)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
      return
    } catch {
      // пробуем следующий шаг
    }
  }

  throw new Error('В браузере закончилось место для автономных данных. Очистите данные сайта и повторите.')
}

function requireAuth(current) {
  if (!current.authenticated) {
    throw new Error('Войдите в аккаунт администратора')
  }
}

function byNewest(a, b) {
  const left = String(a.created_at || '')
  const right = String(b.created_at || '')
  if (left === right) return (Number(b.id) || 0) - (Number(a.id) || 0)
  return left < right ? 1 : -1
}

function publicList(current, { onlyApproved = false } = {}) {
  const list = current.projects.filter((project) => (onlyApproved ? project.status === 'approved' : true))
  return clone(list.sort(byNewest))
}

function findProject(current, id) {
  const project = current.projects.find((item) => Number(item.id) === Number(id))
  if (!project) throw new Error('Проект не найден')
  return project
}

function topicTitle(topic) {
  if (!topic) return 'Материал участника'
  return TOPIC_TITLES[topic] || 'Материал участника'
}

function parseBody(body) {
  if (!body) return {}
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch {
      return {}
    }
  }
  if (typeof body === 'object' && !(body instanceof FormData)) return body
  return {}
}

function parseTags(raw) {
  const value = typeof raw === 'string' ? raw : '[]'
  let parsed
  try {
    parsed = value.startsWith('[') ? JSON.parse(value) : value.split(/[,;\s]+/)
  } catch {
    parsed = value.split(/[,;\s]+/)
  }
  const list = Array.isArray(parsed) ? parsed : [parsed]
  return [...new Set(list.map((tag) => String(tag).replace(/^#+/, '').trim()).filter(Boolean))].slice(0, 20)
}

function nowIso() {
  return new Date().toISOString()
}

function fileName(file) {
  return file && file.name ? file.name : 'файл'
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error(`Не удалось прочитать файл «${fileName(file)}»`))
    reader.readAsDataURL(file)
  })
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => resolve({ image, url })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Не удалось открыть изображение «${fileName(file)}»`))
    }
    image.src = url
  })
}

// Файл -> data:URL. Крупные фотографии ужимаются (иначе не поместятся
// в localStorage), мелкие и «особые» форматы (GIF, SVG, PDF) сохраняем как есть.
async function fileToDataUrl(file, { required = false, label = 'файл' } = {}) {
  if (!file || typeof file.size !== 'number') {
    if (required) throw new Error(`Добавьте ${label}`)
    return null
  }

  const type = file.type || ''
  const isImage = type.startsWith('image/')
  const keepRaw = !isImage || type === 'image/gif' || type === 'image/svg+xml' || file.size <= MAX_RAW_BYTES

  if (keepRaw) {
    if (file.size > MAX_ATTACH_BYTES) {
      throw new Error(
        `«${fileName(file)}» слишком большой для автономной версии (до 1,5 МБ). Для таких файлов нужен сервер: npm run server.`,
      )
    }
    return readAsDataUrl(file)
  }

  const { image, url } = await loadImageElement(file)
  try {
    const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0, width, height)

    return canvas.toDataURL('image/jpeg', IMAGE_QUALITY)
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function createProject(current, form) {
  if (!(form instanceof FormData)) {
    throw new Error('Некорректный запрос')
  }

  const text = (key) => String(form.get(key) ?? '').trim()
  const title = text('title')
  const author = text('author')
  const email = text('email')
  const description = text('description')
  const topic = text('topic')
  const projectType = text('project_type') || 'photo'
  const authorRole = text('author_role')
  const projectDate = text('project_date')
  const sourceInfo = text('source_info')

  const coverFile = form.get('image')
  const mediaFile = form.get('media')
  const beforeFile = form.get('beforeImage')
  const afterFile = form.get('afterImage')
  const galleryFiles = form.getAll('images').filter((item) => item && typeof item.size === 'number')

  if (!title || !author || !description || !coverFile) {
    throw new Error('Заполните название, описание, автора и добавьте обложку')
  }
  if (!coverFile.type.startsWith('image/')) throw new Error('Обложка должна быть изображением')
  if (coverFile.size > 8 * 1024 * 1024) throw new Error('Обложка не должна превышать 8 МБ')
  if (!ALLOWED_TYPES.has(projectType)) throw new Error('Неизвестный формат проекта')
  if (!ALLOWED_TOPICS.has(topic)) throw new Error('Выберите тему проекта')
  if (projectType === 'video') {
    throw new Error(
      'Автономная версия не сохраняет видеофайлы — их публикация работает через сервер (npm run server).',
    )
  }
  if (projectType === 'gif' && (!mediaFile || mediaFile.type !== 'image/gif')) {
    throw new Error('Для GIF-проекта прикрепите GIF-файл')
  }
  if (
    projectType === 'pair' &&
    (!beforeFile || !afterFile || !beforeFile.type.startsWith('image/') || !afterFile.type.startsWith('image/'))
  ) {
    throw new Error('Для сравнения нужны два изображения')
  }
  if (galleryFiles.length > 12) throw new Error('Можно приложить не более 12 фотографий')
  for (const photo of galleryFiles) {
    if (!photo.type.startsWith('image/')) throw new Error('В списке фотографий могут быть только изображения')
    if (photo.size > 8 * 1024 * 1024) throw new Error('Каждая фотография не должна превышать 8 МБ')
  }
  if (
    title.length > 200 ||
    author.length > 150 ||
    email.length > 255 ||
    authorRole.length > 150 ||
    sourceInfo.length > 500
  ) {
    throw new Error('Некоторые поля слишком длинные')
  }

  const imageUrl = await fileToDataUrl(coverFile, { label: 'обложку' })
  const mediaUrl = projectType === 'gif' ? await fileToDataUrl(mediaFile, { label: 'GIF-файл' }) : null
  const beforeUrl = beforeFile ? await fileToDataUrl(beforeFile, { label: 'фотографию «тогда»' }) : null
  const afterUrl = afterFile ? await fileToDataUrl(afterFile, { label: 'фотографию «сейчас»' }) : null

  const gallery = []
  for (const photo of galleryFiles) {
    gallery.push(await fileToDataUrl(photo, { label: 'фотографию' }))
  }

  const id = current.nextId
  current.nextId += 1

  const project = {
    id,
    title,
    description,
    author,
    email,
    image_url: imageUrl,
    status: 'pending',
    created_at: nowIso(),
    updated_at: nowIso(),
    topic,
    project_type: projectType,
    media_url: mediaUrl,
    before_image_url: beforeUrl,
    after_image_url: afterUrl,
    author_role: authorRole || null,
    project_date: projectDate || null,
    source_info: sourceInfo || null,
    tags: parseTags(form.get('tags')),
    gallery,
    topic_title: topicTitle(topic),
    __local: true,
  }

  current.projects.push(project)
  persist()

  return {
    success: true,
    id: project.id,
    message: 'Проект отправлен на рассмотрение администратору',
  }
}

function editProject(current, id, form) {
  const project = findProject(current, id)

  // Как и на сервере: отсутствующее поле берётся из карточки,
  // а явно пустое значение остаётся пустым
  const field = (key, fallback) =>
    form.has(key) ? String(form.get(key) ?? '').trim() : fallback

  const title = field('title', project.title)
  const description = field('description', project.description)
  const author = field('author', project.author)
  const email = field('email', project.email) || ''
  const authorRole = field('author_role', project.author_role) || ''
  const topic = field('topic', project.topic)
  const projectType = field('project_type', project.project_type)
  const projectDate = field('project_date', project.project_date) || ''
  const sourceInfo = field('source_info', project.source_info) || ''

  if (!title || !description || !author) throw new Error('Название, описание и автор обязательны')
  if (!ALLOWED_TOPICS.has(topic) || !ALLOWED_TYPES.has(projectType)) {
    throw new Error('Выбран неизвестный раздел или тип проекта')
  }
  if (
    title.length > 200 ||
    author.length > 150 ||
    email.length > 255 ||
    authorRole.length > 150 ||
    sourceInfo.length > 500 ||
    projectDate.length > 80
  ) {
    throw new Error('Одно из полей превышает допустимую длину')
  }

  const newCover = form.get('image')
  if (newCover && typeof newCover.size === 'number') {
    if (!newCover.type.startsWith('image/')) throw new Error('Можно загрузить только изображение обложки в поле image')
    if (newCover.size > 8 * 1024 * 1024) throw new Error('Обложка не должна превышать 8 МБ')
  }

  project.title = title
  project.description = description
  project.author = author
  project.email = email
  project.author_role = authorRole || null
  project.topic = topic
  project.topic_title = topicTitle(topic)
  project.project_type = projectType
  project.project_date = projectDate || null
  project.source_info = sourceInfo || null
  project.tags = parseTags(field('tags', JSON.stringify(project.tags || [])))
  project.updated_at = nowIso()

  persist()

  return { success: true, id: project.id, message: 'Карточка проекта обновлена' }
}

// Публикует новую обложку. В отличие от сервера файлы не сохраняются на диск,
// поэтому новый URL не появляется — обновляем карточку тем, что есть.
async function editProjectCover(current, id, form) {
  const project = findProject(current, id)
  const newCover = form.get('image')

  if (!newCover || typeof newCover.size !== 'number') {
    return editProject(current, id, form)
  }

  const coverUrl = await fileToDataUrl(newCover, { label: 'обложку' })
  const result = editProject(current, id, form)
  project.image_url = coverUrl
  project.updated_at = nowIso()
  persist()
  return result
}

async function handleAction(current, id, action) {
  if (action === 'permanent') {
    const project = findProject(current, id)
    if (project.status !== 'deleted') {
      throw new Error('Сначала переместите проект в раздел «Удалённые»')
    }
    current.projects = current.projects.filter((item) => Number(item.id) !== Number(id))
    persist()
    return { success: true, id: project.id, message: 'Проект безвозвратно удалён' }
  }

  const status = STATUS_BY_ACTION[action]
  if (!status) throw new Error('Неизвестное действие с проектом')

  const project = current.projects.find((item) => Number(item.id) === Number(id))
  if (!project) throw new Error('Проект не найден')

  project.status = status
  project.updated_at = nowIso()
  persist()

  return { success: true, id: project.id, status }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function standaloneApi(path, options = {}) {
  // Небольшая задержка, чтобы в интерфейсе успевали появиться состояния загрузки
  await delay(30)

  const method = String(options.method || 'GET').toUpperCase()
  const current = readState()

  if (path === '/api/health') {
    return { success: true, message: 'Автономный режим (данные из бандла)' }
  }

  if (path === '/api/auth/me') {
    return current.authenticated
      ? { authenticated: true, username: current.admin.username }
      : { authenticated: false }
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const body = parseBody(options.body)
    const username = String(body.username || '').trim()
    const password = body.password

    if (!username || typeof password !== 'string' || !password) {
      throw new Error('Введите логин и пароль')
    }
    if (username !== current.admin.username || password !== current.admin.password) {
      throw new Error('Неверный логин или пароль')
    }

    current.authenticated = true
    persist()
    return { success: true, authenticated: true, username: current.admin.username }
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    current.authenticated = false
    persist()
    return { success: true }
  }

  if (path === '/api/admin/projects') {
    requireAuth(current)
    return publicList(current)
  }

  const adminMatch = path.match(/^\/api\/admin\/projects\/(\d+)(?:\/([a-z]+))?$/)
  if (adminMatch) {
    requireAuth(current)
    const id = Number(adminMatch[1])
    const action = adminMatch[2]

    if (!action && method === 'PATCH') {
      if (!(options.body instanceof FormData)) throw new Error('Некорректный запрос')
      return editProjectCover(current, id, options.body)
    }
    if (action && method === 'PATCH') {
      return handleAction(current, id, action)
    }
    if (action === 'permanent' && method === 'DELETE') {
      return handleAction(current, id, 'permanent')
    }
    throw new Error('Неизвестный запрос: ' + path)
  }

  if (path === '/api/projects' && method === 'POST') {
    return createProject(current, options.body)
  }

  if (path === '/api/projects') {
    return publicList(current, { onlyApproved: true })
  }

  const singleMatch = path.match(/^\/api\/projects\/(\d+)$/)
  if (singleMatch && method === 'GET') {
    const id = Number(singleMatch[1])
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Некорректный ID проекта')
    const project = current.projects.find(
      (item) => Number(item.id) === id && item.status === 'approved',
    )
    if (!project) throw new Error('Проект не найден или ещё не опубликован')
    return clone(project)
  }

  throw new Error('Неизвестный запрос автономной версии: ' + path)
}
