// The GM window on the local network: lets the GM run TEMPEST from a tablet or phone
// (the TEMPEST Companion app, or any browser) while TEMPEST itself runs on this PC.
// Off until the GM turns it on in Project settings; separate from the player screen's
// sharing (server/lan.js), on its own port, with its own key.
//
// A device pairs through the link (or QR code) in Project settings, on the PC only,
//   http://<this PC's address>:<port>/gm?k=<key>
// which sets a cookie holding the key and opens the GM window. Every other request needs
// that cookie, then goes to the GM server's own handler (server/index.js) as a *remote*
// request: its writes must come from the GM window at that same address, and the PC-only
// parts are refused there (shutting TEMPEST down, autostart, importing PDFs from the PC's
// disk, and these network settings themselves). "New key" signs every paired device out.
//
// Plain http: like the player screen, the key travels unencrypted on the local network, so
// it's for networks you trust (home Wi-Fi, not a café's). Settings: <data>/v1/gm-lan.json.

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const { addresses } = require('./lan');

const COOKIE = 'tempest_gm';
const KEY = /^[A-Za-z0-9_-]{32,86}$/;
const newKey = () => crypto.randomBytes(24).toString('base64url');
const PUBLIC = ['/favicon.ico', '/assets/tempest.ico', '/assets/tempest-256.png'];

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const cookieOf = (req) => (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === COOKIE)?.[1] ?? '';

const page = (title, text) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0f14;color:#e8e6e3;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:1rem}h1{font-size:1.4rem;letter-spacing:.08em;text-transform:uppercase;color:#f75049}</style></head>
<body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;

/**
 * createGmLan({ file, port, host?, handle, serveStatic })
 *   handle(req, res, { remote })   the GM server's request handler
 *   serveStatic(req, res, path)    its static files (for the icons)
 */
function createGmLan({ file, port, host = '0.0.0.0', handle, serveStatic }) {
  let settings = { enabled: false, key: newKey(), port };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    settings = { enabled: saved.enabled === true, key: KEY.test(saved.key ?? '') ? saved.key : settings.key, port: Number.isInteger(saved.port) ? saved.port : port };
  } catch {
    /* first run: off */
  }
  let server = null;
  let error = null;
  const devices = new Map(); // address -> { address, agent, seenAt }

  const save = async () => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
    await fsp.rename(tmp, file);
  };
  const send = (res, status, body, type = 'text/html; charset=utf-8', extra = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', ...extra });
    res.end(body);
  };

  /** The addresses this PC answers on, with this mode's port: the only Host a request may name. */
  const hosts = () => new Set(['127.0.0.1', 'localhost', ...addresses().map((a) => a.address)].map((a) => `${a}:${settings.port}`));

  async function onRequest(req, res) {
    const { pathname, searchParams } = new URL(req.url, 'http://gm.local');
    // Another name for this PC (DNS rebinding, a stray proxy): not this server.
    if (!hosts().has(req.headers.host ?? '')) return send(res, 421, page('Wrong address', 'Open TEMPEST at this PC\'s own address, from the link in Project settings › GM on your network.'));
    // Pairing: the link with the key sets the cookie, then opens the GM window.
    if (pathname === '/gm') {
      if (!same(searchParams.get('k') ?? '', settings.key)) {
        return send(res, 403, page('Link expired', 'This GM link is no longer valid. Open TEMPEST on the PC: Project settings › GM on your network shows the current one.'));
      }
      return send(res, 302, '', 'text/plain', {
        'Set-Cookie': `${COOKIE}=${settings.key}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
        Location: '/',
      });
    }
    if (PUBLIC.includes(pathname)) return serveStatic(req, res, pathname);
    if (!same(cookieOf(req), settings.key)) {
      return send(res, 403, page('TEMPEST · GM', 'Pair this device first: on the PC, open TEMPEST › Project settings › GM on your network, and scan its QR code (or open its link here).'));
    }
    const address = req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? '?';
    devices.set(address, { address, agent: req.headers['user-agent'] ?? '', seenAt: Date.now() });
    // A remote request: writes must come from the GM window at this same address (see index.js).
    return handle(req, res, { remote: { host: req.headers.host ?? '' } });
  }

  function start() {
    if (server) return Promise.resolve();
    error = null;
    return new Promise((resolve) => {
      const s = http.createServer((req, res) => {
        onRequest(req, res).catch((err) => {
          console.error('[gm-lan]', err);
          if (!res.headersSent) send(res, 500, 'Internal error', 'text/plain');
        });
      });
      s.on('error', (err) => {
        error = err.code === 'EADDRINUSE' ? `Port ${settings.port} is already in use on this PC.` : err.message;
        server = null;
        resolve();
      });
      s.listen(settings.port, host, () => {
        server = s;
        console.log(`[gm-lan] GM window shared on port ${settings.port}`);
        resolve();
      });
    });
  }
  function stop() {
    if (!server) return Promise.resolve();
    const s = server;
    server = null;
    return new Promise((resolve) => {
      s.close(() => resolve());
      s.closeAllConnections?.();
    });
  }

  return {
    /** What Project settings shows (on the PC only). */
    status() {
      const now = Date.now();
      return {
        enabled: settings.enabled,
        running: Boolean(server),
        error,
        port: settings.port,
        links: server ? addresses().map((a) => ({ ...a, url: `http://${a.address}:${settings.port}/gm?k=${settings.key}` })) : [],
        devices: [...devices.values()].filter((d) => now - d.seenAt < 10 * 60 * 1000).map(({ address, agent, seenAt }) => ({ address, agent, seenAt: new Date(seenAt).toISOString() })),
      };
    },
    async setEnabled(on) {
      settings.enabled = Boolean(on);
      await save();
      if (settings.enabled) await start();
      else await stop();
      return this.status();
    },
    /** A new key: every paired device is signed out and needs the new link. */
    async newKey() {
      settings.key = newKey();
      devices.clear();
      await save();
      if (server) {
        await stop();
        await start();
      }
      return this.status();
    },
    async boot() {
      if (settings.enabled) await start();
    },
    stop,
  };
}

/** /api/gm-lan on the GM server (the PC's own window only; index.js refuses it remotely). */
async function handleGmLan(gmLan, req, res, pathname, { readJson, sendJson }) {
  if (pathname === '/api/gm-lan' && req.method === 'GET') return sendJson(res, 200, gmLan.status()), true;
  if (pathname === '/api/gm-lan' && req.method === 'PUT') return sendJson(res, 200, await gmLan.setEnabled((await readJson(req)).enabled === true)), true;
  if (pathname === '/api/gm-lan/new-key' && req.method === 'POST') return sendJson(res, 200, await gmLan.newKey()), true;
  return false;
}

module.exports = { createGmLan, handleGmLan };
