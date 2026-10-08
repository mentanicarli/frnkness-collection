/* eslint-disable no-restricted-globals */

// vite-plugin-pwa заменяет self.__WB_MANIFEST на реальный манифест сборки
// вида [{url: '...', revision: '...'}, ...] при каждом билде.
// Это позволяет автоматически версионировать кеш без ручного обновления VERSION.
const MANIFEST_ENTRIES = self.__WB_MANIFEST || []

const BASE_PATH = self.location.pathname.replace(/[^/]+$/, '')
const SHELL_URL = `${BASE_PATH}index.html`

// Обложки и прочие картинки. Имя другое, чем у прежнего «media-v1»: старый
// кэш (в нём лежало и аудио, до 100 МБ) при активации удаляется целиком.
const IMAGES_CACHE = 'images-v2'
const LYRICS_CACHE = 'lyrics-v2'
// Шрифты (public/fonts/): имена постоянные, файлы не меняются, а кэш оболочки
// после каждого деплоя обнуляется — поэтому им отдельный.
const FONTS_CACHE = 'fonts-v1'

// Версия кэша оболочки — хеш всех файлов сборки: любая правка кода или
// контента (он вшит в чанки) даёт новое имя кэша и новый service worker.
function hashOf(text) {
    let h = 5381
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
    return (h >>> 0).toString(36)
}
const PRECACHE_URLS = MANIFEST_ENTRIES.map((e) => e.url)
const VERSION = hashOf(MANIFEST_ENTRIES.map((e) => `${e.url}@${e.revision ?? ''}`).join('|')) || 'v1'
const STATIC_CACHE = `static-${VERSION}`

self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(STATIC_CACHE)
            // cache: 'reload' — в обход HTTP-кэша: иначе при установке можно
            // сохранить устаревшую оболочку, которую хостинг ещё держит у себя.
            // По одному файлу: сбой одного не отменяет остальные.
            await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
        })()
    )
    // Новая версия не ждёт закрытия вкладок: страница сама перезагрузится на неё
    // (src/site/updates.ts), когда это безопасно.
    self.skipWaiting()
})

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const keep = [STATIC_CACHE, IMAGES_CACHE, LYRICS_CACHE, FONTS_CACHE]
            const keys = await caches.keys()
            // Всё остальное — старые версии оболочки и прежний media-v1 с аудио.
            await Promise.all(keys.filter((key) => !keep.includes(key)).map((key) => caches.delete(key)))
            await self.clients.claim()
        })()
    )
})

function isLyricsRequest(url) {
    return /\/lyrics\/.+\.(txt|lrc)$/i.test(url.pathname)
}

// Собранные из текстов файлы: разборы и индекс поиска. Меняются вместе с
// текстами при публикации из админки, поэтому идут тем же путём.
function isLyricsDataRequest(url) {
    return /\/(track-notes|lyrics-index)\.json$/i.test(url.pathname)
}

function isImageRequest(url) {
    return /\/images\//i.test(url.pathname)
}

// Хешированные файлы сборки: имя меняется вместе с содержимым.
function isBuildAsset(url) {
    return /\/assets\/[^/]+-[\w-]{8}\.(js|css)$/i.test(url.pathname)
}

// Потолок для кэшей, которые растут от действий пользователя.
const CACHE_LIMITS = {
    [IMAGES_CACHE]: 150,
    [LYRICS_CACHE]: 120
}

async function trimCache(cacheName) {
    const limit = CACHE_LIMITS[cacheName]
    if (!limit) return
    const cache = await caches.open(cacheName)
    const keys = await cache.keys()
    if (keys.length <= limit) return
    // keys() отдаёт записи в порядке добавления — удаляем самые старые.
    await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)))
}

const offlineResponse = () => new Response('', { status: 504, statusText: 'Offline' })

// fetch с потолком ожидания: на плохой связи не висим, а берём кэш.
function fetchWithTimeout(request, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms)
        fetch(request).then(
            (response) => {
                clearTimeout(timer)
                resolve(response)
            },
            (err) => {
                clearTimeout(timer)
                reject(err)
            }
        )
    })
}

// Тексты песен дописываются по ходу жизни сайта, поэтому для них сеть
// идёт первой (при stale-while-revalidate вернувшийся посетитель видел бы
// новый текст только на следующем заходе). Не дольше 4 с: дальше — кэш.
async function networkFirst(request, cacheName, event) {
    const cache = await caches.open(cacheName)
    try {
        const response = await fetchWithTimeout(request, 4000)
        if (response && response.ok) {
            const stored = cache.put(request, response.clone()).then(() => trimCache(cacheName))
            event.waitUntil(stored)
            return response
        }
        const cached = await cache.match(request)
        return cached || response
    } catch {
        const cached = await cache.match(request)
        return cached || offlineResponse()
    }
}

async function staleWhileRevalidate(request, cacheName, event) {
    const cache = await caches.open(cacheName)
    const cached = await cache.match(request)
    const networkPromise = fetch(request)
        .then((response) => {
            if (response && response.ok) {
                event.waitUntil(cache.put(request, response.clone()).then(() => trimCache(cacheName)))
            }
            return response
        })
        .catch(() => undefined)

    if (cached) {
        event.waitUntil(networkPromise)
        return cached
    }

    // Ни кэша, ни сети: возвращаем явный 504 вместо undefined,
    // иначе respondWith роняет запрос с невнятной сетевой ошибкой.
    const response = await networkPromise
    return response || offlineResponse()
}

// Файл сборки с хешем в имени не меняется: из кэша, иначе из сети (и в кэш).
async function cacheFirst(request, cacheName, event) {
    const cache = await caches.open(cacheName)
    const cached = await cache.match(request)
    if (cached) return cached
    try {
        const response = await fetch(request)
        if (response && response.ok) event.waitUntil(cache.put(request, response.clone()))
        return response
    } catch {
        return offlineResponse()
    }
}

// Оболочка сайта (index.html): из кэша сразу, без ожидания сети. Свежесть
// обеспечивает сам service worker: он обновляется при каждом заходе (и при
// возврате в приложение, см. src/site/updates.ts) и подменяет кэш целиком.
async function shell() {
    const cached = await caches.match(SHELL_URL, { cacheName: STATIC_CACHE })
    if (cached) return cached
    try {
        return await fetch(SHELL_URL, { cache: 'no-cache' })
    } catch {
        return Response.error()
    }
}

// Страницы превью (/r/…, /t/…): сеть, но не дольше 4 с; офлайн — оболочка.
async function previewPage(request) {
    try {
        return await fetchWithTimeout(request, 4000)
    } catch {
        return shell()
    }
}

self.addEventListener('fetch', (event) => {
    const { request } = event
    if (request.method !== 'GET') return

    const url = new URL(request.url)
    if (url.origin !== self.location.origin) return

    // Range-запросы (стриминг аудио) — мимо service worker.
    if (request.headers.has('range')) return

    // Админка (admin.html и её чанки admin-*) идёт мимо service worker:
    // её не нужно ни кэшировать, ни подменять офлайн-страницей сайта.
    if (/\/admin\.html$/.test(url.pathname) || /\/assets\/admin-[^/]*$/.test(url.pathname)) return

    // Аудио и PDF с текстами — только сеть, без кэша: файлы тяжёлые, а
    // iOS Safari требует честных ответов на Range-запросы (206), которые
    // service worker не отдаёт. Браузер сам кэширует их и догружает кусками.
    if (/\/(audio|lyrics-books)\//i.test(url.pathname)) return

    if (request.mode === 'navigate') {
        const isShell = url.pathname === BASE_PATH || url.pathname === SHELL_URL
        event.respondWith(isShell ? shell() : previewPage(request))
        return
    }

    if (isLyricsRequest(url) || isLyricsDataRequest(url)) {
        event.respondWith(networkFirst(request, LYRICS_CACHE, event))
        return
    }

    if (isImageRequest(url)) {
        event.respondWith(staleWhileRevalidate(request, IMAGES_CACHE, event))
        return
    }

    if (/\/fonts\/[^/]+\.woff2$/i.test(url.pathname)) {
        event.respondWith(cacheFirst(request, FONTS_CACHE, event))
        return
    }

    if (isBuildAsset(url)) {
        event.respondWith(cacheFirst(request, STATIC_CACHE, event))
        return
    }

    // Остальное — иконки, манифест, favicon, шрифты: из кэша и обновить.
    // Прочие файлы (чужие пути) service worker не трогает.
    if (/\.(png|ico|svg|webmanifest|woff2?|webp)$/i.test(url.pathname)) {
        event.respondWith(staleWhileRevalidate(request, STATIC_CACHE, event))
    }
})
