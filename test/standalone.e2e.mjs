// Проверка автономной сборки dist/ в реальном браузере (Headless Edge).
// Запуск: npm run test:offline   (сначала нужен npm run build)
//
// Проверяет именно режим file:// — то, как учитель откроет index.html
// двойным кликом: отрисовка, загрузка картинок, отправка проекта,
// вход в админку, публикация и сохранение после перезагрузки.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const EDGE =
  process.env.EDGE_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PAGE_URL = 'file:///' + path.join(DIST, 'index.html').replace(/\\/g, '/')

const results = []
function check(name, ok, info = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${info ? ` — ${info}` : ''}`)
}

function readData() {
  const file = path.join(ROOT, 'src', 'data', 'standalone-projects.json')
  if (!fs.existsSync(file)) {
    throw new Error('Нет src/data/standalone-projects.json — выполните npm run build')
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function clickByText(page, selector, text) {
  const clicked = await page.evaluate(
    (sel, needle) => {
      const node = [...document.querySelectorAll(sel)].find((element) =>
        (element.textContent || '').includes(needle),
      )
      if (!node) return false
      node.click()
      return true
    },
    selector,
    text,
  )
  if (!clicked) throw new Error(`Не найден элемент «${text}» (${selector})`)
}

async function waitForText(page, text, timeout = 15000) {
  // innerText возвращает текст с учётом text-transform (например, «ЗАЯВКА ОТПРАВЛЕНА»),
  // поэтому сравниваем без учёта регистра
  await page.waitForFunction(
    (needle) => (document.body.innerText || '').toLowerCase().includes(needle.toLowerCase()),
    { timeout },
    text,
  )
}

// Прокручиваем страницу и собираем статистику по картинкам
async function imageStats(page) {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8)
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y)
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    window.scrollTo(0, 0)
  })
  await sleep(1200)
  return page.evaluate(() => {
    const images = [...document.querySelectorAll('img')]
    return {
      total: images.length,
      loaded: images.filter((image) => image.complete && image.naturalWidth > 0).length,
      broken: images.filter((image) => image.complete && image.naturalWidth === 0).length,
      pending: images.filter((image) => !image.complete).length,
    }
  })
}

async function goTo(page, hash) {
  await page.evaluate((value) => {
    window.location.hash = value
  }, hash)
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('dist/index.html не найден — выполните npm run build')
  }

  const data = readData()
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox'],
  })

  const page = await browser.newPage()
  page.setDefaultTimeout(20000)

  const consoleErrors = []
  const pageErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))

  try {
    // 1. Главная страница
    await page.goto(PAGE_URL, { waitUntil: 'load' })
    await page.waitForSelector('#root > *', { timeout: 20000 })
    check('Главная страница отрисовывается с диска', true)

    const homeImages = await imageStats(page)
    check(
      'Картинки на главной загружаются',
      homeImages.loaded > 0 && homeImages.broken === 0,
      `загружено ${homeImages.loaded}, битых ${homeImages.broken}`,
    )

    // 2. Каталог
    await goTo(page, '#/catalog')
    await page.waitForFunction(
      () => document.querySelectorAll('a[href^="#/project/"]').length > 0,
      { timeout: 20000 },
    )
    const cards = await page.evaluate(
      () => new Set([...document.querySelectorAll('a[href^="#/project/"]')].map((a) => a.getAttribute('href'))).size,
    )
    const approved = data.projects.filter((project) => project.status === 'approved').length
    check('Каталог показывает опубликованные проекты', cards === approved, `карточек ${cards}, в базе ${approved}`)

    const catalogImages = await imageStats(page)
    check(
      'Обложки в каталоге не битые',
      catalogImages.loaded > 0 && catalogImages.broken === 0,
      `загружено ${catalogImages.loaded}, битых ${catalogImages.broken}`,
    )

    // 3. Карточка проекта с галереей
    const withGallery = data.projects.find(
      (project) => project.status === 'approved' && Array.isArray(project.gallery) && project.gallery.length > 0,
    )
    if (withGallery) {
      await goTo(page, `#/project/${withGallery.id}`)
      await waitForText(page, withGallery.title.slice(0, 20))
      const detailImages = await imageStats(page)
      check(
        `Карточка проекта #${withGallery.id}: галерея и обложка открываются`,
        detailImages.loaded >= withGallery.gallery.length && detailImages.broken === 0,
        `загружено ${detailImages.loaded}, галереи ${withGallery.gallery.length}, битых ${detailImages.broken}`,
      )
    }

    // 4. Видеопроект (самый тяжёлый файл в сборке)
    const withVideo = data.projects.find(
      (project) => project.status === 'approved' && project.media_url && /\.mp4/i.test(project.media_url),
    )
    if (withVideo) {
      await goTo(page, `#/project/${withVideo.id}`)
      await waitForText(page, withVideo.title.slice(0, 20))
      const videoReady = await page.waitForFunction(
        () => {
          const video = document.querySelector('video')
          return Boolean(video && video.readyState >= 1)
        },
        { timeout: 25000 },
      ).then(() => true).catch(() => false)
      check(`Видеопроект #${withVideo.id}: файл воспроизводится`, videoReady)
    }

    // 5. Вход в админку
    await goTo(page, '#/admin')
    await page.waitForSelector('#admin-password', { timeout: 20000 })
    // Поле логина предзаполнено: подставляем значения через нативный setter,
    // иначе React-состояние не обновится и введётся «adminadmin»
    await page.evaluate(
      (creds) => {
        const set = (selector, value) => {
          const element = document.querySelector(selector)
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, value)
          element.dispatchEvent(new Event('input', { bubbles: true }))
        }
        set('#admin-username', creds.username)
        set('#admin-password', creds.password)
      },
      { username: data.admin.username, password: data.admin.password },
    )
    await clickByText(page, 'button', 'Войти')
    await waitForText(page, 'Управление проектами')
    check('Вход в админку (логин/пароль из сборки)', true)

    await clickByText(page, 'button', 'Все проекты')
    await sleep(300)
    const adminCards = await page.evaluate(
      () =>
        [...document.querySelectorAll('main [data-slot="card"]')].filter((card) =>
          (card.textContent || '').includes('Статус:'),
        ).length,
    )
    check(
      'Админка видит все проекты',
      adminCards === data.projects.length,
      `карточек ${adminCards}, в сборке ${data.projects.length}`,
    )

    // 6. Отправка нового проекта в офлайн-режиме
    const coverFile = path.join(DIST, 'uploads', path.basename(data.projects[0].image_url || ''))
    const newTitle = 'Автономный тест ' + Date.now()

    await goTo(page, '#/create-project')
    await page.waitForSelector('#title', { timeout: 20000 })
    await page.type('#title', newTitle)
    const coverInput = await page.$('input[type="file"]')
    await coverInput.uploadFile(coverFile)
    await clickByText(page, 'button[type="submit"]', 'Следующий шаг')

    await page.waitForSelector('#description', { timeout: 20000 })
    await page.type('#description', 'Проверка отправки проекта без сервера и базы данных.')
    await clickByText(page, 'button[type="submit"]', 'Следующий шаг')

    await page.waitForSelector('#author', { timeout: 20000 })
    await page.type('#author', 'Автор Тест')
    await page.evaluate(() => {
      const box = document.querySelector('input[type="checkbox"]')
      if (box && !box.checked) box.click()
    })
    await clickByText(page, 'button[type="submit"]', 'Отправить админу')
    await waitForText(page, 'заявка отправлена')
    check('Проект отправлен без сервера (сохранён в браузере)', true)

    // 7. Новый проект виден в админке и публикуется
    await goTo(page, '#/admin')
    await waitForText(page, 'Управление проектами')
    await clickByText(page, 'button', 'Все проекты')
    await waitForText(page, newTitle.slice(0, 25))
    const pendingCreated = await page.evaluate((title) => {
      const card = [...document.querySelectorAll('main [data-slot="card"]')].find((node) =>
        (node.textContent || '').includes(title),
      )
      return Boolean(card && card.textContent.includes('На рассмотрении'))
    }, newTitle)
    check('Новый проект появился в админке со статусом «На рассмотрении»', pendingCreated)

    await page.evaluate((title) => {
      const card = [...document.querySelectorAll('main [data-slot="card"]')].find((node) =>
        (node.textContent || '').includes(title),
      )
      const button = [...card.querySelectorAll('button')].find((node) =>
        (node.textContent || '').includes('Одобрить и опубликовать'),
      )
      button.click()
    }, newTitle)
    await sleep(600)
    const published = await page.evaluate((title) => {
      const card = [...document.querySelectorAll('main [data-slot="card"]')].find((node) =>
        (node.textContent || '').includes(title),
      )
      return Boolean(card && card.textContent.includes('Опубликован'))
    }, newTitle)
    check('Проект опубликован из админки', published)

    // 8. Публикация видна в каталоге
    await goTo(page, '#/catalog')
    await waitForText(page, newTitle.slice(0, 25))
    check('Опубликованный проект виден в каталоге', true)

    // 9. Данные пережили перезагрузку страницы
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('#root > *', { timeout: 20000 })
    await goTo(page, '#/catalog')
    await waitForText(page, newTitle.slice(0, 25))
    check('Изменения сохранились после перезагрузки (localStorage)', true)

    // 10. Админка остаётся авторизованной
    await goTo(page, '#/admin')
    await waitForText(page, 'Управление проектами')
    check('Сессия администратора пережила перезагрузку', true)

    // 11. Ошибки в консоли
    check(
      'Нет ошибок в консоли браузера',
      consoleErrors.length === 0 && pageErrors.length === 0,
      [...pageErrors, ...consoleErrors].slice(0, 3).join(' | '),
    )
  } finally {
    await browser.close()
  }

  const failed = results.filter((item) => !item.ok)
  console.log(`\nИтог: ${results.length - failed.length} из ${results.length} проверок пройдено`)
  if (failed.length > 0) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('Ошибка проверки:', error.message)
  process.exitCode = 1
})
