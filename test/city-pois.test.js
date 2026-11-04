const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectLibrary } = require('../server/projects');

const model = () => import('../app/maps/city-poi-model.js');
const IMG = `img_${'a'.repeat(24)}`;

test('city POIs: twelve icons, a place on the map, references and maps tidied', async () => {
  const M = await model();
  assert.equal(M.CITY_POI_ICONS.length, 12);
  assert.equal(new Set(M.CITY_POI_ICONS.map((i) => i.id)).size, 12, 'icon ids are unique');
  const p = M.normalizeCityPoi({
    city: 'nightcity', name: '  Afterlife ', icon: 'bar', x: 0.4123456, y: 0.5, district: 'watson-development',
    refs: ['char_0123abcd', { id: 'story_0123abcd', note: ' met Rogue here ' }, { id: 'char_0123abcd' }, { id: 'nope' }],
    maps: [{ image: IMG, caption: ' Ground floor ' }, { image: 'evil.svg' }],
    extra: 1,
  });
  assert.equal(p.name, 'Afterlife');
  assert.equal(p.icon, 'bar');
  assert.equal(p.x, 0.41235);
  assert.equal(p.revealed, false, 'hidden unless revealed');
  assert.deepEqual(p.refs, [{ id: 'char_0123abcd', note: '' }, { id: 'story_0123abcd', note: 'met Rogue here' }], 'deduplicated, bad ids dropped');
  assert.deepEqual(p.maps, [{ image: IMG, caption: 'Ground floor' }]);
  assert.equal('extra' in p, false);
  assert.equal(M.normalizeCityPoi({ city: 'nightcity', name: 'x', icon: 'volcano', x: 0, y: 0 }).icon, 'pin', 'unknown icons fall back');
  assert.equal(M.normalizeCityPoi({ city: 'nightcity', name: 'x', x: 0, y: 0, district: '../etc' }).district, null);
  assert.throws(() => M.normalizeCityPoi({ city: 'nightcity', name: '', x: 0, y: 0 }), /needs a name/);
  assert.throws(() => M.normalizeCityPoi({ city: 'nightcity', name: 'x', x: 1.5, y: 0 }), /place on the map/);
  assert.throws(() => M.normalizeCityPoi({ name: 'x', x: 0, y: 0 }), /needs a city/);

  const players = M.forPlayers([{ ...p, revealed: true }, { ...p, id: 'h', revealed: false }]);
  assert.equal(players.length, 1);
  assert.deepEqual(players[0].refs, [], 'players never get the GM references');
  assert.equal(players[0].maps.length, 1, 'but they do get the maps');
  const groups = M.byDistrict([{ district: 'a' }, { district: null }, { district: 'a' }]);
  assert.deepEqual([groups.get('a').length, groups.get('').length], [2, 1]);
});

test('a project stores city POIs per city; players get revealed ones without references', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-cpois-'));
  try {
    const lib = createProjectLibrary(dir);
    const a = await lib.create({ name: 'Night City' });
    const s = await lib.open(a.id);
    const bar = await s.citypois.create({ city: 'nightcity', name: 'Afterlife', icon: 'bar', x: 0.4, y: 0.4, district: 'watson-development', revealed: true, refs: ['char_0123abcd'] });
    const lab = await s.citypois.create({ city: 'nightcity', name: 'Black Lab', icon: 'danger', x: 0.6, y: 0.6 });
    await s.citypois.create({ city: 'elsewhere', name: 'Other city', x: 0.1, y: 0.1 });
    assert.match(bar.id, /^cpoi_[0-9a-f]{8}$/);
    assert.ok(fs.existsSync(path.join(dir, 'projects', a.id, 'citypois', `${lab.id}.json`)));

    assert.deepEqual((await s.citypois.list({ city: 'nightcity' })).map((p) => p.name), ['Afterlife', 'Black Lab']);
    const seen = await s.citypois.list({ city: 'nightcity', view: 'player' });
    assert.deepEqual(seen.map((p) => [p.name, p.refs.length]), [['Afterlife', 0]]);

    const moved = await s.citypois.save(lab.id, { ...lab, district: 'kabuki', revealed: true });
    assert.equal(moved.district, 'kabuki');
    assert.equal(moved.createdAt, lab.createdAt);
    await s.citypois.remove(bar.id);
    await assert.rejects(s.citypois.get(bar.id), (err) => err.status === 404);
    await assert.rejects(s.citypois.get('poi_0123abcd'), (err) => err.status === 404, 'globe ids are not city ids');
    assert.equal((await s.pois.list()).length, 0, 'globe POIs are separate');
    await assert.rejects(s.citypois.create({ city: 'nightcity', name: 'x' }), (err) => err.status === 400);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
