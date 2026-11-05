import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { normalizePreset } from '../app/forge/preset-model.js';
import { normalizeEntity } from '../app/forge/entity-model.js';
import { normalizePoi } from '../app/maps/poi-model.js';
import { normalizeCityPoi } from '../app/maps/city-poi-model.js';
import { normalizeScreamsheet } from '../app/screamsheets/screamsheet-model.js';
import { normalizeNetwork } from '../app/netrun/network-model.js';

const require = createRequire(import.meta.url);
const { installDemos } = require('../server/demo.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = path.join(ROOT, 'demo', 'projects');
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f)) : []);

test('every file in the shipped demo passes the app\'s own checks', () => {
  const ids = fs.readdirSync(DEMO);
  assert.ok(ids.length >= 1, 'a demo project ships');
  for (const id of ids) {
    const dir = path.join(DEMO, id);
    assert.equal(json(path.join(dir, 'project.json')).id, id);
    assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.tmp')), 'no leftover temp files');
    for (const f of files(path.join(dir, 'presets'))) assert.doesNotThrow(() => normalizePreset(json(f)), f);
    const entities = ['characters', 'stories', 'items', 'netcards'].flatMap((k) => files(path.join(dir, k)));
    for (const f of entities) assert.doesNotThrow(() => normalizeEntity(json(f)), f);
    for (const f of files(path.join(dir, 'pois'))) assert.doesNotThrow(() => normalizePoi(json(f)), f);
    for (const f of files(path.join(dir, 'citypois'))) assert.doesNotThrow(() => normalizeCityPoi(json(f)), f);
    for (const f of files(path.join(dir, 'screamsheets'))) assert.doesNotThrow(() => normalizeScreamsheet(json(f)), f);
    for (const f of files(path.join(dir, 'networks'))) {
      const net = json(f);
      assert.deepEqual(normalizeNetwork(net), net, `${f} is exactly as the app would save it`);
    }

    // Every image an entry uses ships with it, and every link points at something in the project.
    const all = [...entities, ...['citypois', 'screamsheets', 'networks'].flatMap((k) => files(path.join(dir, k)))].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    for (const img of new Set(all.match(/img_[0-9a-f]{24}/g) ?? [])) assert.ok(fs.existsSync(path.join(dir, 'assets', img)), `image ${img} is missing`);
    const known = new Set(entities.map((f) => json(f).id));
    for (const ref of new Set(all.match(/"(char|story|item|ncard)_[0-9a-f]{8}"/g) ?? [])) assert.ok(known.has(ref.slice(1, -1)), `link ${ref} points nowhere`);
  }
});

test('demo projects install once, never overwrite, and stay deleted', () => {
  const v1 = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-demo-'));
  const logs = [];
  try {
    const [id] = fs.readdirSync(DEMO);
    assert.deepEqual(installDemos({ root: ROOT, v1Dir: v1, log: (m) => logs.push(m) }), [id]);
    assert.ok(fs.existsSync(path.join(v1, 'projects', id, 'project.json')));
    assert.deepEqual(json(path.join(v1, 'demo.json')).installed, [id]);

    // Changed by the GM: a second start leaves it alone.
    fs.writeFileSync(path.join(v1, 'projects', id, 'mine.txt'), 'notes');
    assert.deepEqual(installDemos({ root: ROOT, v1Dir: v1, log: () => {} }), []);
    assert.ok(fs.existsSync(path.join(v1, 'projects', id, 'mine.txt')));

    // Deleted by the GM: it doesn't come back.
    fs.rmSync(path.join(v1, 'projects', id), { recursive: true });
    assert.deepEqual(installDemos({ root: ROOT, v1Dir: v1, log: () => {} }), []);
    assert.ok(!fs.existsSync(path.join(v1, 'projects', id)));

    // A data folder that already has a project with that id (before any marker): kept, and marked.
    fs.rmSync(path.join(v1, 'demo.json'));
    fs.mkdirSync(path.join(v1, 'projects', id), { recursive: true });
    fs.writeFileSync(path.join(v1, 'projects', id, 'project.json'), '{"id":"' + id + '","name":"Mine"}');
    assert.deepEqual(installDemos({ root: ROOT, v1Dir: v1, log: () => {} }), []);
    assert.equal(json(path.join(v1, 'projects', id, 'project.json')).name, 'Mine');
    assert.deepEqual(json(path.join(v1, 'demo.json')).installed, [id]);

    // A demo installed by an earlier version (no list of offered files): it gains the folders
    // it never had (Netrunning), once; a file the GM deletes isn't brought back.
    fs.rmSync(path.join(v1, 'projects', id), { recursive: true });
    fs.cpSync(path.join(DEMO, id), path.join(v1, 'projects', id), { recursive: true });
    for (const k of ['netcards', 'networks', path.join('presets', 'netcards')]) fs.rmSync(path.join(v1, 'projects', id, k), { recursive: true, force: true });
    fs.mkdirSync(path.join(v1, 'projects', id, 'networks')); // opening a tab makes the folder, empty
    fs.writeFileSync(path.join(v1, 'demo.json'), JSON.stringify({ installed: [id] }));
    const mine = path.join(v1, 'projects', id, 'project.json');
    fs.writeFileSync(mine, '{"id":"' + id + '","name":"Renamed by the GM"}');
    const said = [];
    assert.deepEqual(installDemos({ root: ROOT, v1Dir: v1, log: (m) => said.push(m) }), [], 'nothing newly installed…');
    assert.match(said.join('\n'), /added \d+ new demo files/, '…but the new files arrive');
    assert.ok(fs.existsSync(path.join(v1, 'projects', id, 'networks', 'net_5ee17007.json')));
    assert.equal(json(mine).name, 'Renamed by the GM', 'files the project had are left alone');
    fs.rmSync(path.join(v1, 'projects', id, 'networks', 'net_5ee17007.json'));
    assert.deepEqual(installDemos({ root: ROOT, v1Dir: v1, log: () => {} }), []);
    assert.ok(!fs.existsSync(path.join(v1, 'projects', id, 'networks', 'net_5ee17007.json')), 'deleted by the GM: stays deleted');

    // TEMPEST_NO_DEMO turns it off.
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-demo-'));
    process.env.TEMPEST_NO_DEMO = '1';
    try {
      assert.deepEqual(installDemos({ root: ROOT, v1Dir: fresh, log: () => {} }), []);
    } finally {
      delete process.env.TEMPEST_NO_DEMO;
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(v1, { recursive: true, force: true });
  }
});
