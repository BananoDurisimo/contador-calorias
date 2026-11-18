// Service worker del Contador de Calorías.
// - Red primero para los archivos de la app: siempre recibes la última versión si hay internet.
// - Si no hay internet, sirve la copia guardada (la app abre y funciona con la base local).
// - La librería de Supabase (CDN) se guarda la primera vez y luego se sirve desde caché.
// - Las llamadas a la API de Supabase nunca se guardan en caché.
const VERSION = 'v7';
const CACHE = `cc-${VERSION}`;
const CDN_CACHE = 'cc-cdn';

const SHELL = [
  './',
  './index.html',
  `./css/styles.css?v=7`,
  `./js/app.js?v=7`,
  `./js/db-local.js?v=7`,
  `./js/db-supabase.js?v=7`,
  `./js/plan.js?v=7`,
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/shortcut-96.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('cc-') && k !== CACHE && k !== CDN_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true }));
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // API de Supabase: siempre a la red, sin caché.
  if (url.hostname.endsWith('.supabase.co')) return;

  // Librería de Supabase desde el CDN.
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }
  event.respondWith(networkFirst(request));
});
