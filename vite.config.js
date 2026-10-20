import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// dist/index.html должен открываться двойным кликом (file://).
// Такой режим отличается от обычного сайта:
//  - внешние ES-модули (<script type="module" src="...">) браузер не грузит (CORS);
//  - атрибут crossorigin тоже ломает подгрузку файлов с диска;
//  - fetch() и IndexedDB недоступны, поэтому данные проектов вшиваются в бандл,
//    а настройки хранятся в localStorage (см. src/lib/standalone.js).
// Поэтому бандл собирается как обычный классический скрипт, а пути к ассетам
// делаем относительными (base: './').
function fileProtocolHtml() {
  return {
    name: 'file-protocol-html',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        // В dev-сервере модули работают штатно (http://), не трогаем
        if (context && context.server) return html

        return html
          .replace(/\s+crossorigin(?:="[^"]*")?/g, '')
          // type="module" сам по себе отложенный (defer): он выполняется после
          // разметки, где уже есть <div id="root">. Убирая модуль, ставим defer
          // явно, иначе React выполнится в<head> и не найдёт корневой элемент.
          .replace(/\s+type="module"/g, ' defer')
      },
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), fileProtocolHtml()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
    },
  },
  // npm run preview: собранная версия на http — как dev, проксируем на API
  preview: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
    },
  },
  build: {
    // es2019: чтобы старые браузеры (школьные ПК) понимали optional chaining и пр.
    target: 'es2019',
    // preloading модулей на file:// не нужен и добавляет лишние теги
    modulePreload: false,
    rollupOptions: {
      output: {
        // Обычный классический скрипт вместо ES-модуля — работает с диска
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
  },
})
