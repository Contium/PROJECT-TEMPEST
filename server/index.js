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

const { ROOT, PORT, HOST } = P;
const THEMES_DIR = path.join(ROOT, 'themes');
const VERSION = require('../package.json').version;
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
// v1 keeps its data apart from v0's universes, which stay untouched in DATA_DIR/universes.
// Everything the user makes lives in a project (server/projects.js).
const projects = createProjectLibrary(path.join(P.DATA_DIR, 'v1'));
// What the player screen shows: the GM's last push (server/display.js).
const display = createDisplay(path.join(P.DATA_DIR, 'v1', 'display.json'), projects);
// The player screen on the local network, when the GM shares it (server/lan.js).
const lan = createLan({ file: path.join(P.DATA_DIR, 'v1', 'lan.json'), port: P.LAN_PORT, host: process.env.TEMPEST_LAN_HOST || '0.0.0.0', serveStatic: (req, res, p) => serveStatic(req, res, p), listThemes: () => listThemes(), display, library: projects });
// Folders in the project that are never served (old versions, reference PDFs, built
// binaries), and the standalone binary itself when TEMPEST runs from one.
const PRIVATE_DIRS = ['Archived', 'official_references', 'test', 'server', 'launcher', 'dist', 'tempest.exe', 'tempest'];

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
function isTrustedMutation(req, { images = false } = {}) {
  if (!ALLOWED_HOSTS.has(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin && !ALLOWED_HOSTS.has(origin.replace(/^http:\/\//, ''))) return false;
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

const server = http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, `http://${HOST}`);
  try {
    if (pathname === '/api/health') {
      // dataDir lets the launcher spot a TEMPEST server running with someone else's data
      // folder (e.g. a sandboxed copy) and replace it instead of reusing it.
      return sendJson(res, 200, { app: 'tempest', version: VERSION, pid: process.pid, dataDir: P.DATA_DIR });
    }
    if (pathname === '/api/role') return sendJson(res, 200, { role: 'gm' });
    if (pathname === '/api/packs/screamsheet' || pathname.startsWith('/api/packs/screamsheet/')) {
      if (req.method !== 'GET' && !isTrustedMutation(req)) return send(res, 403, 'Forbidden');
      if (await handlePacks(req, res, pathname.slice('/api/packs/screamsheet'.length), { readJson, sendJson })) return;
      return sendJson(res, 404, { error: 'Not found' });
    }
    if (pathname === '/api/lan' || pathname.startsWith('/api/lan/')) {
      if (req.method !== 'GET' && !isTrustedMutation(req)) return send(res, 403, 'Forbidden');
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
      if (req.method !== 'GET' && !isTrustedMutation(req, { images })) return send(res, 403, 'Forbidden');
      if (await handleProjects(projects, req, res, pathname.slice('/api/projects'.length), searchParams, { readJson, readRaw, sendJson })) return;
      return sendJson(res, 404, { error: 'Not found' });
    }
    if (pathname === '/api/display' || pathname.startsWith('/api/display/')) {
      if (req.method !== 'GET' && !isTrustedMutation(req)) return send(res, 403, 'Forbidden');
      if (await handleDisplay(display, req, res, pathname, { readJson, sendJson })) return;
      return sendJson(res, 404, { error: 'Not found' });
    }
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
    return await serveStatic(req, res, pathname);
  } catch (err) {
    if (err.status === 413) return sendJson(res, 413, { error: 'Request is too large' });
    if (err instanceof SyntaxError) return sendJson(res, 400, { error: 'Request body is not valid JSON' });
    console.error(err);
    send(res, 500, 'Internal error');
  }
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use.` : err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`TEMPEST ${VERSION} running at http://${HOST}:${PORT} (pid ${process.pid})`);
  lan.boot().catch((err) => console.error('[lan]', err));
});
