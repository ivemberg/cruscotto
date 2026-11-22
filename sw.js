// Guscio dell'app in cache per aprirla anche offline; i dati cifrati in d/ dalla rete, con l'ultima copia come riserva.
const VERSIONE = 'cruscotto-2';
const GUSCIO = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icone/180.png', 'icone/192.png', 'icone/512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSIONE).then((c) => c.addAll(GUSCIO)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== VERSIONE).map((x) => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Prima la rete, poi la cache: per i dati e per il guscio, così gli aggiornamenti arrivano subito.
  e.respondWith((async () => {
    const cache = await caches.open(VERSIONE);
    const chiave = url.pathname.includes('/d/') ? url.origin + url.pathname : e.request;
    try {
      const r = await fetch(e.request);
      if (r.ok) cache.put(chiave, r.clone());
      return r;
    } catch {
      return (await cache.match(chiave, { ignoreSearch: true })) || Response.error();
    }
  })());
});
