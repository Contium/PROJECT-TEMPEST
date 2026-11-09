// TEMPEST local host — zero-dependency static server + theme registry + system API.
// Binds to 127.0.0.1 only; this is a single-user desktop tool, not a public service.

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const P = require('../launcher/paths');
const shortcuts = require('../launcher/shortcuts');
const { createProjectLibrary, handleProjects } = require('./projects');
const { createDisplay, handleDisplay } = require('./display');
const { createLan, handleLan } = require('./lan');
const { handlePacks } = require('./packs');
const { installDemos } = require('./demo');
const { createCodex, handleCodex } = require('./codex');
const { createGmLan, handleGmLan } = require('./gm-lan');

const { ROOT, PORT, HOST } = P;
const THEMES_DIR = path.join(ROOT, 'themes');
const VERSION = require('../package.json').version;
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
// v1 keeps its data apart from v0's universes, which stay untouched in DATA_DIR/universes.
// Everything the user makes lives in a project (server/projects.js). The shipped
// demo campaign joins them the first time (server/demo.js).
installDemos({ root: ROOT, v1Dir: path.join(P.DATA_DIR, 'v1') });
const projects = createProjectLibrary(path.join(P.DATA_DIR, 'v1'));
// What the player screen shows: the GM's last push (server/display.js).
const display = createDisplay(path.join(P.DATA_DIR, 'v1', 'display.json'), projects);
// A fight under way puts its turn order on every player screen (Combat › Initiative).
projects.onEncounter = (id, encounter) => display.setTracker(id, encounter);
// What the players know, which each player screen browses on its own (server/codex.js).
const codex = createCodex(projects);
// The player screen on the local network, when the GM shares it (server/lan.js).
const lan = createLan({ file: path.join(P.DATA_DIR, 'v1', 'lan.json'), port: P.LAN_PORT, host: process.env.TEMPEST_LAN_HOST || '0.0.0.0', serveStatic: (req, res, p) => serveStatic(req, res, p), listThemes: () => listThemes(), display, library: projects, codex });
// Folders in the project that are never served (old versions, reference PDFs, built
// binaries, the demo campaign's GM-only files), and the standalone binary itself
// when TEMPEST runs from one.
const PRIVATE_DIRS = ['Archived', 'official_references', 'test', 'server', 'launcher', 'dist', 'demo', 'android', 'tempest.exe', 'tempest'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// Every folder in /themes with a theme.json is an installed theme. Folders starting
// with "_" (e.g. _base) are shared infrastructure, not selectable themes.
async function listThemes() {
  const entries = await fsp.readdir(THEMES_DIR, { withFileTypes: true });
  const themes = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const manifestPath = path.join(THEMES_DIR, entry.name, 'theme.json');
    try {
      const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
      themes.push({
        id: manifest.id || entry.name,
        name: manifest.name || entry.name,
        version: manifest.version || '0.0.0',
        description: manifest.description || '',
        default: Boolean(manifest.default),
        extends: manifest.extends || null,
        path: `/themes/${entry.name}/`,
      });
    } catch (err) {
      console.warn(`[themes] skipped "${entry.name}": ${err.message}`);
    }
  }
  return themes.sort((a, b) => Number(b.default) - Number(a.default) || a.name.localeCompare(b.name));
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const sendJson = (res, status, data) => send(res, status, JSON.stringify(data), MIME['.json']);

async function readJson(req, limit = 2 * 1024 * 1024) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw Object.assign(new Error('Body too large'), { status: 413 });
  }
  return body ? JSON.parse(body) : {};
}

// State-changing requests must come from TEMPEST's own pages: the Host check
// blocks DNS rebinding, the Origin check blocks other sites, and requiring a
// JSON (or, for uploads, image) content type forces a CORS preflight that this
// server never approves.
//
// A remote request (a device paired through "GM on your network", server/gm-lan.js, which
// has already checked its key) is trusted the same way, but for its own address: the Host
// it used, and an Origin from that same address.
function isTrustedMutation(req, { images = false, remote = null } = {}) {
  const allowed = remote ? new Set([remote.host]) : ALLOWED_HOSTS;
  if (!allowed.has(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin && !allowed.has(origin.replace(/^http:\/\//, ''))) return false;
  const type = req.headers['content-type'] || '';
  return /^application\/json\b/.test(type) || (images && /^image\/(png|jpeg|gif|webp)\b/.test(type));
}

async function readRaw(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function serveStatic(req, res, urlPath) {
  if (urlPath === '/favicon.ico') urlPath = '/assets/tempest.ico';
  const rel = decodeURIComponent(urlPath === '/' ? '/app/index.html' : urlPath);
  const filePath = path.resolve(ROOT, '.' + rel);
  if (!filePath.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');
  const top = path.relative(ROOT, filePath).split(path.sep)[0];
  if (top.startsWith('.') || PRIVATE_DIRS.some((d) => d.toLowerCase() === top.toLowerCase())) return send(res, 404, 'Not found');

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return send(res, 404, 'Not found');
  }
  const target = stat.isDirectory() ? path.join(filePath, 'index.html') : filePath;
  const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(target).on('error', () => res.end()).pipe(res);
}

async function handleSystem(req, res, pathname) {
  if (req.method !== 'GET' && !isTrustedMutation(req)) return send(res, 403, 'Forbidden');

  if (pathname === '/api/system/autostart') {
    if (req.method === 'GET') return sendJson(res, 200, shortcuts.getAutostart());
    if (req.method === 'POST') {
      const { enabled, mode } = await readJson(req);
      return sendJson(res, 200, shortcuts.setAutostart(Boolean(enabled), mode));
    }
  }

  if (pathname === '/api/system/shutdown' && req.method === 'POST') {
    sendJson(res, 200, { ok: true });
    console.log('Shutdown requested');
    server.close();
    setTimeout(() => process.exit(0), 200).unref();
    return;
  }

  send(res, 404, 'Not found');
}

// What a paired device (GM on your network) may never do: things that belong to the PC itself.
// Shutting TEMPEST down and autostart (/api/system), the launcher's health check (it names
// the data folder), reading a PDF from a path on the PC's disk (screamsheet import, and the
// list of PDFs found there), and the network sharing settings, this mode's own included.
const REMOTE_STATIC = [/^\/$/, /^\/favicon\.ico$/, /^\/app\//, /^\/src\//, /^\/themes\//, /^\/assets\//];
const PC_ONLY = [/^\/api\/health$/, /^\/api\/system\//, /^\/api\/lan(\/|$)/, /^\/api\/gm-lan(\/|$)/, /^\/api\/packs\/screamsheet\/(import|sources)$/];

/**
 * Every request to the GM server. `remote` is set for a device paired through GM on your
 * network ({ host }: the address it reached TEMPEST at); otherwise it's this PC's own window.
 */
async function handle(req, res, { remote = null } = {}) {
  const { pathname, searchParams } = new URL(req.url, `http://${HOST}`);
  const trusted = (opts = {}) => isTrustedMutation(req, { ...opts, remote });
  try {
    if (remote && PC_ONLY.some((re) => re.test(pathname))) return sendJson(res, 403, { error: 'Only on the PC running TEMPEST' });
    if (pathname === '/api/health') {
      // dataDir lets the launcher spot a TEMPEST server running with someone else's data
      // folder (e.g. a sandboxed copy) and replace it instead of reusing it.
      return sendJson(res, 200, { app: 'tempest', version: VERSION, pid: process.pid, dataDir: P.DATA_DIR });
    }
    if (pathname === '/api/role') return sendJson(res, 200, { role: 'gm', remote: Boolean(remote) });
    if (pathname === '/api/gm-lan' || pathname.startsWith('/api/gm-lan/')) {
      if (req.method !== 'GET' && !trusted()) return send(res, 403, 'Forbidden');
      if (await handleGmLan(gmLan, req, res, pathname, { readJson, sendJson })) return;
      return sendJson(res, 404, { error: 'Not found' });
    }
    if (pathname === '/api/packs/screamsheet' || pathname.startsWith('/api/packs/screamsheet/')) {
      if (req.method !== 'GET' && !trusted()) return send(res, 403, 'Forbidden');
      if (await handlePacks(req, res, pathname.slice('/api/packs/screamsheet'.length), { readJson, sendJson })) return;
      return sendJson(res, 404, { error: 'Not found' });
    }
    if (pathname === '/api/lan' || pathname.startsWith('/api/lan/')) {
      if (req.method !== 'GET' && !trusted()) return send(res, 403, 'Forbidden');
      if (await handleLan(lan, req, res, pathname, { readJson, sendJson })) return;
      return sendJson(res, 404, { error: 'Not found' });
    }
    if (pathname === '/api/themes') {
      return sendJson(res, 200, await listThemes());
    }
    if (pathname.startsWith('/api/system/')) {
      return await handleSystem(req, res, pathname);
    }
    if (pathname === '/api/projects' || pathname.startsWith('/api/projects/')) {
      // Image uploads (…/assets) send raw image bytes; everything else sends JSON.
      const images = /^\/api\/projects\/[^/]+\/assets\/?$/.test(pathname);
      if (req.method !== 'GET' && !trusted({ images })) return send(res, 403, 'Forbidden');
      if (await handleProjects(projects, req, res, pathname.slice('/api/projects'.length), searchParams, { readJson, readRaw, sendJson })) return;
      return sendJson(res, 404, { error: 'Not found' });
    }
    if (pathname === '/api/display' || pathname.startsWith('/api/display/')) {
      if (req.method !== 'GET' && !trusted()) return send(res, 403, 'Forbidden');
      if (await handleDisplay(display, req, res, pathname, { readJson, sendJson })) return;
      return sendJson(res, 404, { error: 'Not found' });
    }
    if (pathname === '/api/codex' || pathname.startsWith('/api/codex/')) {
      if (await handleCodex(codex, req, res, pathname, { sendJson })) return;
      return sendJson(res, 404, { error: 'Not found' });
    }
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
    // A paired device gets the GM window's own files, not the rest of the install folder.
    if (remote && !REMOTE_STATIC.some((re) => re.test(pathname))) return send(res, 404, 'Not found');
    return await serveStatic(req, res, pathname);
  } catch (err) {
    if (err.status === 413) return sendJson(res, 413, { error: 'Request is too large' });
    if (err instanceof SyntaxError) return sendJson(res, 400, { error: 'Request body is not valid JSON' });
    console.error(err);
    send(res, 500, 'Internal error');
  }
}

const server = http.createServer((req, res) => handle(req, res));
// The GM window on the local network, when the GM shares it (server/gm-lan.js): its own port, its own key.
const gmLan = createGmLan({
  file: path.join(P.DATA_DIR, 'v1', 'gm-lan.json'),
  port: Number(process.env.TEMPEST_GM_LAN_PORT) || PORT + 2,
  host: process.env.TEMPEST_LAN_HOST || '0.0.0.0',
  handle,
  serveStatic: (req, res, p) => serveStatic(req, res, p),
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use.` : err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`TEMPEST ${VERSION} running at http://${HOST}:${PORT} (pid ${process.pid})`);
  lan.boot().catch((err) => console.error('[lan]', err));
  gmLan.boot().catch((err) => console.error('[gm-lan]', err));
});
