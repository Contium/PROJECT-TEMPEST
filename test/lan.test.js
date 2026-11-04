const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectLibrary } = require('../server/projects');
const { createDisplay } = require('../server/display');
const { createLan } = require('../server/lan');

const PORT = 4190 + Math.floor(Math.random() * 50);
// A 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function get(urlPath, { cookie, method = 'GET' } = {}, retry = true) {
  // "New link" restarts the server, closing kept-alive connections: reconnect once, as browsers do.
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, { method, redirect: 'manual', headers: cookie ? { cookie } : {} }).catch((err) => {
    if (retry) return null;
    throw err;
  });
  if (!res) return get(urlPath, { cookie, method }, false);
  return { status: res.status, headers: res.headers, body: method === 'HEAD' ? '' : await res.text() };
}

test('the network player server lets in only key holders, and only to the player screen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-lan-'));
  const lib = createProjectLibrary(dir);
  const display = createDisplay(path.join(dir, 'display.json'), lib);
  const lan = createLan({
    file: path.join(dir, 'lan.json'), port: PORT, display, library: lib, host: '127.0.0.1',
    listThemes: async () => [{ id: 't' }],
    serveStatic: (req, res, p) => (res.writeHead(200, { 'Content-Type': 'text/plain' }), res.end(`static ${p}`)),
  });
  try {
    assert.equal(lan.status().running, false, 'off until turned on');
    let status = await lan.setEnabled(true);
    assert.equal(status.running, true);
    assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'lan.json'), 'utf8')).enabled, 'remembered');
    const key = JSON.parse(fs.readFileSync(path.join(dir, 'lan.json'), 'utf8')).key;

    // No key, wrong key: shut out.
    assert.equal((await get('/')).status, 403);
    assert.equal((await get('/api/display')).status, 403);
    assert.equal((await get('/join?k=nope')).status, 403);
    assert.equal((await get('/app/player.webmanifest')).status, 200, 'icons and the manifest need no key');
    assert.equal((await get('/app/main.js')).status, 403, 'but everything else does');
    // The link sets the cookie and opens the player screen.
    const join = await get(`/join?k=${key}`);
    assert.equal(join.status, 302);
    assert.equal(join.headers.get('location'), '/#/player');
    const cookie = join.headers.get('set-cookie').split(';')[0];
    assert.match(join.headers.get('set-cookie'), /HttpOnly/);
    assert.match(join.headers.get('set-cookie'), /SameSite=Lax/, 'Lax: links opened from a QR app are cross-site visits');

    assert.deepEqual(JSON.parse((await get('/api/role', { cookie })).body), { role: 'player' });
    assert.equal((await get('/app/main.js', { cookie })).body, 'static /app/main.js');
    assert.match((await get('/', { cookie })).body, /<body class="is-player" data-role="player">/, 'the page is the player screen from the start');
    assert.equal((await get('/assets/maps/nightcity/districts.json', { cookie })).status, 200);
    assert.equal(JSON.parse((await get('/api/display', { cookie })).body).mode, 'ambient');
    // Nothing of the GM's: no projects, no server code, no other files, no writes.
    for (const p of ['/api/projects', '/api/lan', '/server/index.js', '/Archived/v0/README.md', '/assets/Night%20City%202045%20Atlas%20Maps/x.jpg', '/test/lan.test.js']) {
      assert.equal((await get(p, { cookie })).status, 404, p);
    }
    assert.equal((await get('/api/display', { cookie, method: 'PUT' })).status, 405);

    // Pictures: only those in what's on screen now.
    const proj = await lib.create({ name: 'P' });
    const stores = await lib.open(proj.id);
    const { id: shown } = await stores.assets.add(PNG);
    const other = (await stores.assets.add(Buffer.concat([PNG, Buffer.from([0])]))).id;
    assert.equal((await get(`/api/projects/${proj.id}/assets/${shown}`, { cookie })).status, 404, 'not on screen yet');
    await display.push({ mode: 'handout', project: proj.id, image: shown, caption: 'Map' });
    assert.equal((await get(`/api/projects/${proj.id}/assets/${shown}`, { cookie })).status, 200);
    assert.equal((await get(`/api/projects/${proj.id}/assets/${other}`, { cookie })).status, 404, 'another picture of the project');

    // Named screens: each sees what was sent to it, and the pictures in it; nobody sees who else is watching.
    assert.equal(JSON.parse((await get('/api/display?screen=Alex', { cookie })).body).mode, 'handout');
    await display.push({ mode: 'handout', project: proj.id, image: other, to: ['Alex'] });
    assert.equal(JSON.parse((await get('/api/display?screen=alex', { cookie })).body).image, other);
    assert.equal(JSON.parse((await get('/api/display?screen=Sam', { cookie })).body).image, shown);
    assert.equal((await get(`/api/projects/${proj.id}/assets/${other}`, { cookie })).status, 200, 'on Alex\'s screen now');
    assert.equal((await get('/api/display/screens', { cookie })).status, 404, 'the list of screens is the GM\'s');

    // A new link shuts out the old one.
    await lan.newLink();
    assert.equal((await get('/api/role', { cookie })).status, 403);
    assert.equal((await get(`/join?k=${key}`)).status, 403);

    status = await lan.setEnabled(false);
    assert.equal(status.running, false);
    await assert.rejects(get('/'), 'stopped');
  } finally {
    await lan.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
