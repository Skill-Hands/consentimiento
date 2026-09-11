const CACHE='mi-peso-public-v1';
const SHELL=['/','/app.css','/app.js','/manifest.webmanifest','/icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||new URL(r.url).pathname.startsWith('/api/'))return;e.respondWith(fetch(r).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(r,copy));return resp;}).catch(()=>caches.match(r).then(x=>x||caches.match('/'))));});