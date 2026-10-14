/* GPTAXI Empresas · Service Worker (offline + push) */
const VERSION = "gptaxi-emp-v1";
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;
const PRECACHE = [
  "./", "./index.html", "./offline.html", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png",
  "./apple-touch-icon.png", "./badge-96.png"
];
// Librerías externas que conviene dejar listas sin conexión
const CDN = [
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(PRECACHE);
    // CDN: si alguna falla, no frena la instalación
    await Promise.all(CDN.map(u => fetch(u, {mode: "cors"}).then(r => r.ok && c.put(u, r)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Nunca cachear datos en vivo (Supabase, geocodificación)
  if (url.hostname.endsWith("supabase.co") || url.hostname === "nominatim.openstreetmap.org") return;

  // Navegación: red primero, luego caché, luego página offline
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        const c = await caches.open(SHELL); c.put("./index.html", net.clone());
        return net;
      } catch (_) {
        return (await caches.match("./index.html")) || (await caches.match("./offline.html"));
      }
    })());
    return;
  }

  // Mosaicos del mapa: caché con tope, se actualizan en segundo plano
  if (url.hostname.endsWith("tile.openstreetmap.org")) {
    e.respondWith((async () => {
      const c = await caches.open(RUNTIME);
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok) { c.put(req, r.clone()); trim(c, 150); } return r; }).catch(() => hit);
      return hit || net;
    })());
    return;
  }

  // Resto (estáticos, fuentes, CDN): caché primero, red de respaldo
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const r = await fetch(req);
      if (r.ok || r.type === "opaque") { const c = await caches.open(RUNTIME); c.put(req, r.clone()); }
      return r;
    } catch (_) { return hit || Response.error(); }
  })());
});

async function trim(cache, max) {
  const keys = await cache.keys();
  if (keys.length > max) { await cache.delete(keys[0]); trim(cache, max); }
}

/* ---------- Push ---------- */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = {body: e.data ? e.data.text() : ""}; }
  const title = d.title || "GPTAXI Empresas";
  const opts = {
    body: d.body || d.message || "Tenés una novedad en tu envío.",
    icon: "icon-192.png",
    badge: "badge-96.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: true,
    lang: "es",
    vibrate: [600, 200, 600, 200, 600, 200, 900],
    data: {url: d.url || "./index.html"}
  };
  e.waitUntil((async () => {
    await self.registration.showNotification(title, opts);
    const all = await self.clients.matchAll({type: "window", includeUncontrolled: true});
    all.forEach(c => c.postMessage({type: "push"}));
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "./index.html", self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({type: "window", includeUncontrolled: true});
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope) && "focus" in c) { c.postMessage({type: "push"}); return c.focus(); }
    }
    return self.clients.openWindow(target);
  })());
});
