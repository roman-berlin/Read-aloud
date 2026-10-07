// Service worker: makes Read Aloud installable and usable offline.
// The app shell and pdf.js are precached on install. Online, the shell is fetched
// network-first (so an edit shows up on the next reload without bumping a version);
// pdf.js under vendor/ is cache-first because it only changes with its folder.
const CACHE = 'read-aloud-v2'; // bump when icons or vendor files change so installed apps refetch them
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const fromCache = () =>
    caches.match(request, { ignoreSearch: true }).then((hit) => hit || (request.mode === 'navigate' ? caches.match('./index.html') : undefined));
  const fromNetwork = () =>
    fetch(request).then((res) => {
      if (res.ok) caches.open(CACHE).then((cache) => cache.put(request, res.clone()));
      return res;
    });

  if (url.pathname.includes('/vendor/')) {
    event.respondWith(fromCache().then((hit) => hit || fromNetwork()));
  } else {
    event.respondWith(fromNetwork().catch(() => fromCache().then((hit) => hit || Response.error())));
  }
});
