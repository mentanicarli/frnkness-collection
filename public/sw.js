const VERSION = 'v1.4.1';
const STATIC_CACHE = `static-${VERSION}`;
const MEDIA_CACHE = `media-${VERSION}`;
const LYRICS_CACHE = `lyrics-${VERSION}`;
const BASE_PATH = self.location.pathname.replace(/[^/]+$/, '');
const APP_SHELL = [
    BASE_PATH,
    `${BASE_PATH}index.html`,
    `${BASE_PATH}manifest.webmanifest`
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => Promise.resolve())
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            (async () => {
                if (self.registration.navigationPreload) {
                    await self.registration.navigationPreload.enable();
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
    );
    self.clients.claim();
});

function isLyricsRequest(url) {
    return /\/lyrics\/.+\.(txt|lrc)$/i.test(url.pathname);
}

function isMediaRequest(url) {
    return /\/(audio|images)\//i.test(url.pathname);
}

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    const networkPromise = fetch(request)
        .then((response) => {
            if (response && response.ok) {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => undefined);
    return cached || networkPromise;
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // Let browser handle byte-range streaming for audio.
    if (request.headers.has('range')) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            (async () => {
                try {
                    const cache = await caches.open(STATIC_CACHE);
                    const preloadResponse = await event.preloadResponse;
                    if (preloadResponse) {
                        cache.put(request, preloadResponse.clone());
                        return preloadResponse;
                    }
                    const response = await fetch(request);
                    if (response && response.ok) {
                        cache.put(request, response.clone());
                    }
                    return response;
                } catch {
                    return caches.match(`${BASE_PATH}index.html`);
                }
            })()
        );
        return;
    }

    if (isLyricsRequest(url)) {
        event.respondWith(staleWhileRevalidate(request, LYRICS_CACHE));
        return;
    }

    if (isMediaRequest(url)) {
        event.respondWith(staleWhileRevalidate(request, MEDIA_CACHE));
        return;
    }

    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
});
