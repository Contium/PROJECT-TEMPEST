// The player screen on the local network: a second, read-only server that other
// devices (phones, tablets, a TV's browser) can reach. Off until the GM turns it
// on in Project settings; the GM's own server stays on 127.0.0.1.
//
// A device gets in through the link (or QR code) in Project settings,
//   http://<this PC's address>:<port>/join?k=<key>
// which sets a cookie holding the key and opens the player screen. Every other
// request needs that cookie. "New link" changes the key, which shuts out every
// device that used the old one.
//
// What the network can read (GET only):
//   the player screen's page, scripts, themes and built-in maps (/, /app, /src, /themes, /assets/maps)
//   /api/role, /api/themes, /api/display, /api/display/stream (each ?screen=<name>)
//   /api/projects/:p/assets/:id  only the pictures in what's on a screen right now
// (Not /api/display/screens: who else is watching is the GM's business.)
// Nothing else: no projects, entries, presets, settings, or writes of any kind.
//
// Settings are kept in <data>/v1/lan.json: { enabled, key, port }.

const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');

const COOKIE = 'tempest_player';
const KEY = /^[A-Za-z0-9_-]{16,64}$/;
const ASSET_IN_DISPLAY = /img_[0-9a-f]{24}/g;
// Icons and the Home Screen manifest: browsers fetch these without cookies, and they hold nothing private.
const PUBLIC = ['/favicon.ico', '/assets/tempest.ico', '/assets/tempest-256.png', '/app/player.webmanifest'];
const STATIC = [/^\/$/, /^\/favicon\.ico$/, /^\/assets\/tempest\.ico$/, /^\/assets\/tempest-256\.png$/, /^\/app\//, /^\/src\//, /^\/themes\//, /^\/assets\/maps\//];

const newKey = () => crypto.randomBytes(18).toString('base64url');

/** This PC's IPv4 addresses on the network, likeliest first (real adapters before virtual ones). */
function addresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      const virtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|Docker|Tailscale|ZeroTier|Hamachi|vpn/i.test(name);
      const privateRange = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      out.push({ name, address: a.address, rank: (virtual ? 2 : 0) + (privateRange ? 0 : 1) });
    }
  }
  return out.sort((x, y) => x.rank - y.rank || x.name.localeCompare(y.name)).map(({ name, address }) => ({ name, address }));
}

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
 * createLan({ file, port, serveStatic, listThemes, display, library, host? })
 *   serveStatic(req, res, pathname)  the GM server's static file handler
 *   listThemes()                     installed themes
 *   display                          server/display.js (get, subscribe)
 *   library                          projects (for reading on-screen pictures)
 *   host                             where to listen: every interface by default (tests use 127.0.0.1)
 */
function createLan({ file, port, serveStatic, listThemes, display, library, host = '0.0.0.0' }) {
  let settings = { enabled: false, key: newKey(), port };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    settings = { enabled: saved.enabled === true, key: KEY.test(saved.key ?? '') ? saved.key : settings.key, port: Number.isInteger(saved.port) ? saved.port : port };
  } catch {
    /* first run: off */
  }
  let server = null;
  let error = null;

  const save = async () => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
    await fsp.rename(tmp, file);
  };

  const send = (res, status, body, type = 'text/html; charset=utf-8', extra = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra });
    res.end(body);
  };
  const json = (res, status, data) => send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');

  async function handle(req, res) {
    const { pathname, searchParams } = new URL(req.url, 'http://player.local');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Read only', 'text/plain', { Allow: 'GET' });

    // The way in: a link with the key sets the cookie, then opens the player screen.
    if (pathname === '/join') {
      if (!same(searchParams.get('k') ?? '', settings.key)) return send(res, 403, page('Link expired', 'This player screen link is no longer valid. Ask your GM for the new one (the QR code in TEMPEST\'s Project settings).'));
      return send(res, 302, '', 'text/plain', {
        // Lax, not Strict: a link opened from a camera or QR app is a cross-site visit, and browsers
        // refuse to store (or send) a Strict cookie there. Everything here is read-only GET anyway.
        'Set-Cookie': `${COOKIE}=${settings.key}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
        Location: '/#/player',
      });
    }
    if (PUBLIC.includes(pathname)) return serveStatic(req, res, pathname);
    if (!same(cookieOf(req), settings.key)) {
      return send(res, 403, page('TEMPEST player screen', 'Open the player screen from the link or QR code your GM shares (TEMPEST › Project settings › Player screen on your network).'));
    }

    if (pathname === '/api/role') return json(res, 200, { role: 'player' });
    if (pathname === '/api/themes') return json(res, 200, await listThemes());
    if (pathname === '/api/display') return json(res, 200, display.get(searchParams.get('screen')));
    if (pathname === '/api/display/stream') return display.subscribe(req, res, searchParams.get('screen'));
    const asset = pathname.match(/^\/api\/projects\/(proj_[0-9a-f]{8})\/assets\/(img_[0-9a-f]{24})$/);
    if (asset) {
      // Only pictures that are part of what's on a screen now (everyone's, or one screen's own).
      const ok = display.current().some((now) => now.projectId === asset[1] && (JSON.stringify(now).match(ASSET_IN_DISPLAY) ?? []).includes(asset[2]));
      if (!ok) return json(res, 404, { error: 'Not found' });
      const { mime, data } = await (await library.open(asset[1])).assets.get(asset[2]);
      return send(res, 200, data, mime, { 'Cache-Control': 'private, max-age=3600' });
    }
    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
    // The page itself, marked as the player screen from the start: even before (or without)
    // its scripts, it never shows the GM's controls.
    if (pathname === '/') {
      const html = await fsp.readFile(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
      return send(res, 200, html.replace('<body>', '<body class="is-player" data-role="player">'));
    }
    if (STATIC.some((r) => r.test(pathname))) return serveStatic(req, res, pathname);
    return send(res, 404, 'Not found', 'text/plain');
  }

  function start() {
    if (server) return Promise.resolve();
    error = null;
    return new Promise((resolve) => {
      const s = http.createServer((req, res) => {
        // A short log of what devices asked for (the key hidden), for "it doesn't load" questions.
        const started = Date.now();
        res.on('finish', () => remember(req, res.statusCode, Date.now() - started));
        res.on('close', () => !res.writableFinished && remember(req, res.statusCode, Date.now() - started, 'closed'));
        handle(req, res).catch((err) => {
          if (err.status === 404) return json(res, 404, { error: 'Not found' });
          console.error('[lan]', err);
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
        console.log(`[lan] player screen shared on port ${settings.port}`);
        resolve();
      });
    });
  }

  const recent = []; // the last requests: { at, from, method, path, status, ms, note, agent }
  function remember(req, status, ms, note = '') {
    const path = req.url.replace(/([?&]k=)[^&]+/, '$1…');
    recent.push({ at: new Date().toISOString(), from: req.socket.remoteAddress?.replace(/^::ffff:/, ''), method: req.method, path, status, ms, note, agent: req.headers['user-agent'] ?? '' });
    if (recent.length > 200) recent.splice(0, recent.length - 200);
  }

  function stop() {
    if (!server) return Promise.resolve();
    const s = server;
    server = null;
    return new Promise((resolve) => {
      s.close(() => resolve());
      s.closeAllConnections?.(); // event streams stay open otherwise
    });
  }

  return {
    /** The last requests devices made (newest last). */
    log: () => recent.slice(),
    /** What Project settings shows. */
    status() {
      const list = addresses();
      return {
        enabled: settings.enabled,
        running: Boolean(server),
        error,
        port: settings.port,
        links: server ? list.map((a) => ({ ...a, url: `http://${a.address}:${settings.port}/join?k=${settings.key}` })) : [],
      };
    },
    async setEnabled(on) {
      settings.enabled = Boolean(on);
      await save();
      if (settings.enabled) await start();
      else await stop();
      return this.status();
    },
    /** A new key: devices using the old link are shut out (they reload into "Link expired"). */
    async newLink() {
      settings.key = newKey();
      await save();
      if (server) {
        await stop();
        await start();
      }
      return this.status();
    },
    /** Start sharing again after a restart if it was on. */
    async boot() {
      if (settings.enabled) await start();
    },
    stop,
  };
}

async function handleLan(lan, req, res, pathname, { readJson, sendJson }) {
  if (pathname === '/api/lan' && req.method === 'GET') return sendJson(res, 200, lan.status()), true;
  if (pathname === '/api/lan' && req.method === 'PUT') {
    const body = await readJson(req);
    return sendJson(res, 200, await lan.setEnabled(body.enabled === true)), true;
  }
  if (pathname === '/api/lan/log' && req.method === 'GET') return sendJson(res, 200, lan.log()), true;
  if (pathname === '/api/lan/new-link' && req.method === 'POST') return sendJson(res, 200, await lan.newLink()), true;
  return false;
}

module.exports = { createLan, handleLan, addresses };
