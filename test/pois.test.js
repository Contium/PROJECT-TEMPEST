const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectLibrary } = require('../server/projects');

const model = () => import('../app/maps/poi-model.js');

test('POIs: the five types, a place on the globe, hidden unless revealed', async () => {
  const M = await model();
  assert.deepEqual(M.POI_TYPES.map((t) => t.label), ['City', 'Landmark', 'Point of Interest', 'Other', 'Unknown']);
  const p = M.normalizePoi({ name: '  Night City ', type: 'city', lon: -122.123456789, lat: 37.5, description: ' Free City ', extra: 1 });
  assert.deepEqual(p, { ...p, name: 'Night City', type: 'city', lon: -122.12346, lat: 37.5, description: 'Free City', revealed: false });
  assert.equal('extra' in p, false);
  assert.equal(M.normalizePoi({ name: 'x', type: 'volcano', lon: 0, lat: 0 }).type, 'poi', 'unknown types fall back');
  assert.throws(() => M.normalizePoi({ name: '', lon: 0, lat: 0 }), /needs a name/);
  assert.throws(() => M.normalizePoi({ name: 'x', lon: 200, lat: 0 }), /place on the globe/);
  assert.throws(() => M.normalizePoi({ name: 'x', lat: 0 }), /place on the globe/);
  assert.deepEqual(M.forPlayers([{ revealed: true, id: 'a' }, { revealed: false, id: 'b' }]).map((x) => x.id), ['a']);
  assert.deepEqual(p.maps, [], 'no maps unless attached');
});

test('POIs carry attached maps: images only, captions trimmed, each once, at most twelve', async () => {
  const M = await model();
  const img = (c) => `img_${c.repeat(24)}`;
  const p = M.normalizePoi({
    name: 'Arasaka Black Site', lon: 0, lat: 0,
    maps: [{ image: img('a'), caption: '  Level B2  ' }, { image: img('a'), caption: 'again' }, { image: 'evil.svg' }, null, { image: img('b') }],
  });
  assert.deepEqual(p.maps, [{ image: img('a'), caption: 'Level B2' }, { image: img('b'), caption: '' }]);
  const many = Array.from({ length: 20 }, (_, i) => ({ image: `img_${String(i).padStart(24, '0')}` }));
  assert.equal(M.normalizePoi({ name: 'x', lon: 0, lat: 0, maps: many }).maps.length, M.MAX_MAPS);
  assert.deepEqual(M.uniquePois({ maps: { mode: 'planetary' } })[0].maps, []);
});

test('a project stores its POIs; players get only the revealed ones', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-pois-'));
  try {
    const lib = createProjectLibrary(dir);
    const a = await lib.create({ name: 'Night City' });
    const b = await lib.create({ name: 'Elsewhere' });
    const s = await lib.open(a.id);
    const city = await s.pois.create({ name: 'Night City', type: 'city', lon: -122.3, lat: 37.8, revealed: true });
    const lab = await s.pois.create({ name: 'Arasaka Black Site', type: 'unknown', lon: -120, lat: 36 });
    assert.match(city.id, /^poi_[0-9a-f]{8}$/);
    assert.ok(fs.existsSync(path.join(dir, 'projects', a.id, 'pois', `${lab.id}.json`)));

    assert.deepEqual((await s.pois.list()).map((p) => p.name), ['Arasaka Black Site', 'Night City']);
    assert.deepEqual((await s.pois.list({ view: 'player' })).map((p) => p.name), ['Night City']);

    const revealed = await s.pois.save(lab.id, { ...lab, revealed: true, name: 'The Black Site' });
    assert.equal(revealed.createdAt, lab.createdAt);
    assert.equal((await s.pois.list({ view: 'player' })).length, 2, 'revealing shows it to players');

    await s.pois.remove(city.id);
    await assert.rejects(s.pois.get(city.id), (err) => err.status === 404);
    assert.deepEqual(await (await lib.open(b.id)).pois.list(), [], 'POIs are per project');
    await assert.rejects(s.pois.create({ name: '', lon: 0, lat: 0 }), (err) => err.status === 400);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Night City: a unique POI on Planetary and Galactic maps, switched in settings', async () => {
  const M = await model();
  const S = await import('../app/projects/settings-model.js');
  const settings = (maps) => S.normalizeSettings({ maps });
  assert.deepEqual(S.defaultSettings().maps.nightCity, { enabled: true, revealed: true }, 'on and revealed by default');
  for (const mode of ['planetary', 'galactic']) {
    const [nc] = M.uniquePois(settings({ mode }));
    assert.deepEqual([nc.name, nc.type, nc.lat, nc.lon, nc.unique, nc.revealed], ['Night City', 'city', 35.3658, -120.8499, true, true], mode);
  }
  for (const mode of [null, 'planar', 'cartographer']) assert.deepEqual(M.uniquePois(settings({ mode })), [], String(mode));
  assert.deepEqual(M.uniquePois(settings({ mode: 'planetary', nightCity: { enabled: false } })), [], 'turned off');
  assert.equal(M.uniquePois(settings({ mode: 'planetary', nightCity: { revealed: false } }))[0].revealed, false);
  assert.ok(M.isUnique('unique_nightcity'));
});

test('a project lists Night City with its POIs; revealing it is stored in settings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-unique-'));
  try {
    const lib = createProjectLibrary(dir);
    const p = await lib.create({ name: 'Night City', settings: { maps: { mode: 'planetary' } } });
    const s = await lib.open(p.id);
    await s.pois.create({ name: 'Arasaka Tower', type: 'landmark', lon: -120.8, lat: 35.4 });
    assert.deepEqual((await lib.listPois(p.id)).map((x) => x.name), ['Night City', 'Arasaka Tower']);
    assert.deepEqual((await lib.listPois(p.id, { view: 'player' })).map((x) => x.name), ['Night City']);
    assert.equal(fs.readdirSync(path.join(dir, 'projects', p.id, 'pois')).length, 1, 'Night City is not a saved file');

    const hidden = await lib.setUnique(p.id, 'unique_nightcity', { revealed: false, name: 'Renamed?', lon: 0 });
    assert.deepEqual([hidden.name, hidden.lon, hidden.revealed], ['Night City', -120.8499, false], 'only visibility changes');
    assert.equal((await lib.get(p.id)).settings.maps.nightCity.revealed, false);
    assert.deepEqual(await lib.listPois(p.id, { view: 'player' }), []);

    await lib.update(p.id, { settings: { ...(await lib.get(p.id)).settings, maps: { mode: 'cartographer', nightCity: { enabled: true, revealed: false } } } });
    assert.deepEqual((await lib.listPois(p.id)).map((x) => x.name), ['Arasaka Tower'], 'not on other map systems');
    await assert.rejects(lib.setUnique(p.id, 'unique_nightcity', { revealed: true }), (err) => err.status === 409);
    await assert.rejects(lib.setUnique(p.id, 'unique_atlantis', {}), (err) => err.status === 404);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});