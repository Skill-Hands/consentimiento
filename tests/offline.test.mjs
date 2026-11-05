import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const workerSource = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

assert.match(html, /<link[^>]+rel=["']manifest["'][^>]+manifest\.webmanifest/i);
assert.match(html, /id=["']offlineStatus["']/);
assert.match(html, /vendor\/jspdf\.umd\.min\.js/);
assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
assert.doesNotMatch(html, /cdnjs\.cloudflare\.com/);
new Script(workerSource, { filename: 'sw.js' });

const cacheMap = new Map();
const cache = {
  async addAll(requests) {
    for (const request of requests) cacheMap.set(request.url, new Response('asset:' + request.url));
  },
  async put(key, response) { cacheMap.set(String(key), response); },
  async match(key) { return cacheMap.get(String(key)); },
};
const listeners = {};
let skipWaiting = false;
const scope = 'https://example.test/consent/';
const self = {
  registration: { scope }, location: new URL(scope), clients: { claim: async () => {} },
  addEventListener(type, fn) { listeners[type] = fn; },
  skipWaiting: async () => { skipWaiting = true; },
};
const caches = {
  open: async () => cache,
  keys: async () => ['consentimiento-shell-v1'],
  delete: async () => true,
};
let online = true;
const fetch = async request => {
  if (!online) throw new TypeError('offline');
  return new Response('latest:' + request.url, { status: 200 });
};
new Script(workerSource).runInNewContext({ self, caches, URL, Request, Response, fetch });

const installWait = [];
listeners.install({ waitUntil: promise => installWait.push(promise) });
await Promise.all(installWait);
assert.equal(skipWaiting, true);
assert.equal(cacheMap.size, 3, 'install should cache page, PDF library and manifest');

const navHandler = listeners.fetch;
const request = (url, mode = 'navigate') => ({ method: 'GET', mode, url });
const runFetch = async req => {
  let responsePromise;
  navHandler({ request: req, respondWith: promise => { responsePromise = promise; } });
  return responsePromise ? await responsePromise : null;
};
const pageUrl = scope + 'index.html';
let response = await runFetch(request(scope));
assert.match(await response.text(), /latest:/, 'online navigation should serve network version');
online = false;
response = await runFetch(request(scope));
assert.match(await response.text(), /latest:/, 'offline navigation should fall back to latest cached shell');

response = await runFetch(request(scope + 'vendor/jspdf.umd.min.js', 'no-cors'));
assert.match(await response.text(), /asset:/, 'PDF library remains available offline');
assert.equal(await runFetch({method:'POST', mode:'cors', url:scope + 'api/consents'}), null, 'POST/API must not be intercepted');
assert.equal(await runFetch(request('https://third-party.test/tracker.js', 'no-cors')), null, 'third-party requests must not be intercepted');
assert.ok(cacheMap.has(pageUrl), 'canonical page is stored for offline fallback');
process.stdout.write('Consentimiento: instalación, navegación offline, jsPDF y límites de caché verificados\n');
