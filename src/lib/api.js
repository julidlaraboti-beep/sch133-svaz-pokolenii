
import { isStandalone, standaloneApi } from './standalone'

export async function api(path, options = {}) {
  // Открытие dist/index.html с диска (file://): сеть недоступна,
  // работаем на данных, вшитых в бандл, и localStorage (см. standalone.js)
  if (isStandalone()) {
    return standaloneApi(path, options)
  }

  const response = await fetch(path, {
    credentials: 'include',
    ...options,
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : null;

  if (!response.ok) {
    throw new Error(data?.message || 'Ошибка запроса');
  }

  return data;
}
