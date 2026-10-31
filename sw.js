const CACHE_NAME = 'meds-v1.5.7';

const ASSETS = [
    '/',
    '/index.html',
    '/app.js',
    '/styles.css',
    '/styles_profile.css',
    '/translations.js',
    '/manifest.json',
    '/peerjs.min.js',
    '/qrcode.min.js',
    '/favicon.ico',
    '/favicon.png',
    '/sounds/alarm_01.mp3',
    '/sounds/alarm_02.mp3',
    '/sounds/alarm_03.mp3',
    '/sounds/alarm_04.mp3',
    '/sounds/alarm_05.mp3',
    '/sounds/alarm_06.mp3',
    '/sounds/alarm_07.mp3',
    '/sounds/alarm_08.mp3',
    '/sounds/alarm_09.mp3',
    '/sounds/alarm_10.mp3',
];

// Install: cache all assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate: remove old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Fetch: cache-first for same-origin, network-only for external
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return; // let PeerJS/external calls pass through

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => {
                // For navigation requests, fall back to index.html
                if (event.request.mode === 'navigate') {
                    return caches.match('/index.html');
                }
            });
        })
    );
});
