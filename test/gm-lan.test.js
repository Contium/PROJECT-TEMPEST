// GM on your network (server/gm-lan.js + server/index.js): a paired device runs the GM
// window from another machine. Tested against a real TEMPEST process with a throwaway data
// folder: pairing, the key, request forgery, and what stays on the PC.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const KEY = 'gmkeygmkeygmkeygmkeygmkeygmkeygmkey0123';

/** One HTTP request: { status, headers, body }. */
function request(port, pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (Date.now() > end) throw err;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}

test('a paired device runs the GM window; everything else is kept out', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-gmlan-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const gm = port + 2;
  fs.mkdirSync(path.join(dir, 'v1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'v1', 'gm-lan.json'), JSON.stringify({ enabled: true, key: KEY, port: gm }));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, TEMPEST_PORT: String(port), TEMPEST_DATA_DIR: dir, TEMPEST_NO_DEMO: '1', TEMPEST_LAN_HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  try {
    await until(() => request(gm, '/favicon.ico').then((r) => assert.notEqual(r.status, undefined)));
    const host = `127.0.0.1:${gm}`;

    // Not paired: nothing.
    assert.equal((await request(gm, '/')).status, 403);
    assert.equal((await request(gm, '/api/projects')).status, 403);
    assert.equal((await request(gm, '/gm?k=wrong-key')).status, 403);
    assert.equal((await request(gm, '/', { headers: { cookie: 'tempest_gm=nope' } })).status, 403);

    // Pairing sets the cookie and opens the GM window.
    const paired = await request(gm, `/gm?k=${KEY}`);
    assert.equal(paired.status, 302);
    assert.equal(paired.headers.location, '/');
    assert.match(paired.headers['set-cookie'][0], /^tempest_gm=.+; Path=\/; HttpOnly; SameSite=Lax/);
    const cookie = paired.headers['set-cookie'][0].split(';')[0];
    const as = (extra = {}) => ({ cookie, host, ...extra });

    assert.equal((await request(gm, '/', { headers: as() })).status, 200, 'the GM window');
    assert.equal((await request(gm, '/app/main.js', { headers: as() })).status, 200);
    assert.deepEqual(JSON.parse((await request(gm, '/api/role', { headers: as() })).body), { role: 'gm', remote: true });
    assert.deepEqual(JSON.parse((await request(port, '/api/role')).body), { role: 'gm', remote: false }, 'the PC\'s own window');

    // It can change the campaign, from the GM window at its own address…
    const made = await request(gm, '/api/projects', { method: 'POST', headers: as({ 'content-type': 'application/json', origin: `http://${host}` }), body: { name: 'From the tablet' } });
    assert.equal(made.status, 201);
    // …but not from another site, nor without JSON (a form post), nor through another Host.
    assert.equal((await request(gm, '/api/projects', { method: 'POST', headers: as({ 'content-type': 'application/json', origin: 'http://evil.example' }), body: { name: 'x' } })).status, 403);
    assert.equal((await request(gm, '/api/projects', { method: 'POST', headers: as({ 'content-type': 'text/plain' }), body: '{"name":"x"}' })).status, 403);
    // Another name for this PC (DNS rebinding) isn't this server at all, cookie or not.
    assert.equal((await request(gm, '/api/projects', { method: 'POST', headers: as({ host: 'evil.example', 'content-type': 'application/json' }), body: { name: 'x' } })).status, 421);
    assert.equal((await request(gm, `/gm?k=${KEY}`, { headers: { host: `evil.example:${gm}` } })).status, 421);

    // What belongs to the PC stays there.
    for (const [method, p] of [['POST', '/api/system/shutdown'], ['GET', '/api/system/autostart'], ['GET', '/api/health'], ['GET', '/api/lan'], ['PUT', '/api/lan'], ['GET', '/api/gm-lan'], ['POST', '/api/gm-lan/new-key'], ['GET', '/api/packs/screamsheet/sources'], ['POST', '/api/packs/screamsheet/import']]) {
      const r = await request(gm, p, { method, headers: as({ 'content-type': 'application/json', origin: `http://${host}` }), body: method === 'GET' ? undefined : {} });
      assert.equal(r.status, 403, `${method} ${p}`);
    }
    assert.equal((await request(port, '/api/health')).status, 200, 'still running: the shutdown never happened');
    // And only the GM window's own files, not the install folder.
    for (const p of ['/README.md', '/package.json', '/scripts/build-binaries.js', '/server/index.js']) assert.equal((await request(gm, p, { headers: as() })).status, 404, p);

    // New key (on the PC only) signs the device out.
    const fresh = await request(port, '/api/gm-lan/new-key', { method: 'POST', headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json' }, body: {} });
    assert.equal(fresh.status, 200);
    await until(async () => assert.equal((await request(gm, '/api/role', { headers: as() })).status, 403));
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
