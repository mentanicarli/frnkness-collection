/* eslint-disable no-restricted-globals */

// vite-plugin-pwa заменяет self.__WB_MANIFEST на реальный манифест сборки
// вида [{url: '...', revision: '...'}, ...] при каждом билде.
// Это позволяет автоматически версионировать кеш без ручного обновления VERSION.
const MANIFEST_ENTRIES = self.__WB_MANIFEST || []

const BASE_PATH = self.location.pathname.replace(/[^/]+$/, '')
const MEDIA_CACHE = 'media-v1'
const LYRICS_CACHE = 'lyrics-v1'

// Версия кеша автоматически выводится из хешей файлов сборки.
const _rev = MANIFEST_ENTRIES.find(e => e.revision)?.revision ?? ''
const VERSION = _rev ? _rev.slice(0, 8) : 'v1'
const STATIC_CACHE = `static-${VERSION}`

const PRECACHE_URLS = MANIFEST_ENTRIES.map(e => e.url)

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => Promise.resolve()))
    )
    self.skipWaiting()
})

self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            (async () => {
                if (self.registration.navigationPreload) {
                    await self.registration.navigationPreload.enable()
                }
            })(),
            caches.keys().then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => ![STATIC_CACHE, MEDIA_CACHE, LYRICS_CACHE].includes(key))
                        .map((key) => caches.delete(key))
                )
            )
        ])
    )
    self.clients.claim()
})

function isLyricsRequest(url) {
    return /\/lyrics\/.+\.(txt|lrc)$/i.test(url.pathname)
}

function isMediaRequest(url) {
    return /\/(audio|images)\//i.test(url.pathname)
}

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName)
    const cached = await cache.match(request)
    const networkPromise = fetch(request)
        .then((response) => {
            if (response && response.ok) cache.put(request, response.clone())
            return response
        })
        .catch(() => undefined)
    return cached || networkPromise
}

self.addEventListener('fetch', (event) => {
    const { request } = event
    if (request.method !== 'GET') return

    const url = new URL(request.url)
    if (url.origin !== self.location.origin) return

    // Байт-рейндж запросы (стриминг аудио) — пропускаем мимо кеша.
    if (request.headers.has('range')) return

    if (request.mode === 'navigate') {
        event.respondWith(
            (async () => {
                try {
                    const cache = await caches.open(STATIC_CACHE)
                    const preloadResponse = await event.preloadResponse
                    if (preloadResponse) {
                        cache.put(request, preloadResponse.clone())
                        return preloadResponse
                    }
                    const response = await fetch(request)
                    if (response && response.ok) cache.put(request, response.clone())
                    return response
                } catch {
                    return caches.match(`${BASE_PATH}index.html`)
                }
            })()
        )
        return
    }

    if (isLyricsRequest(url)) {
        event.respondWith(staleWhileRevalidate(request, LYRICS_CACHE))
        return
    }

    if (isMediaRequest(url)) {
        event.respondWith(staleWhileRevalidate(request, MEDIA_CACHE))
        return
    }

    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE))
})
