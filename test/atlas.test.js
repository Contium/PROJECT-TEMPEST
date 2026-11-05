// The Planar, Cartographer and Galactic map systems: their checks, the players'
// copies (nothing hidden, never a chart's map under fog), pushes and the Codex.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectLibrary, handleProjects } = require('../server/projects');
const { createDisplay } = require('../server/display');
const { createCodex } = require('../server/codex');

const models = async () => ({
  P: await import('../app/maps/planar-model.js'),
  C: await import('../app/maps/chart-model.js'),
  G: await import('../app/maps/galactic-model.js'),
  S: await import('../app/projects/settings-model.js'),
  M: await import('../app/push/push-model.js'),
  X: await import('../app/sections.js'),
});

async function withProject(mode, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-atlas-'));
  try {
    const library = createProjectLibrary(dir);
    const project = await library.create({ name: 'Atlas', settings: { maps: { mode } } });
    const stores = await library.open(project.id);
    await fn({ library, project, stores, dir, display: createDisplay(path.join(dir, 'display.json'), library), codex: createCodex(library) });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const IMG = (n) => `img_${String(n).repeat(24).slice(0, 24)}`;

test('every map system is ready and has a section of its own', async () => {
  const { S, X } = await models();
  assert.ok(S.MAP_MODES.every((m) => m.ready));
  const ids = (mode) => X.visibleSections({ settings: { maps: { mode } } }).map((s) => s.id).filter((id) => ['worldview', 'planes', 'atlas', 'starmap'].includes(id));
  assert.deepEqual(ids('planar'), ['planes']);
  assert.deepEqual(ids('planetary'), ['worldview']);
  assert.deepEqual(ids('cartographer'), ['atlas']);
  assert.deepEqual(ids('galactic'), ['starmap']);
  assert.deepEqual(ids(null), []);
  assert.equal(X.resolve('/atlas/chart_0a1b2c3d').item, 'chart_0a1b2c3d', 'a chart opens by id');
  assert.equal(X.resolve('/starmap/nightcity').item, 'nightcity', 'Night City\'s City Map from the star map');
  // Night City's place on the star map is kept with the settings.
  const s = S.normalizeSettings({ maps: { mode: 'galactic', nightCity: { galactic: { x: 120.04, y: -40 } } } });
  assert.deepEqual(s.maps.nightCity.galactic, { x: 120, y: -40 });
  assert.equal(S.normalizeSettings({ maps: { nightCity: { galactic: { x: 'far' } } } }).maps.nightCity.galactic, undefined);
});

test('Planar: ways show only between planes players know; hints give nothing else away', async () => {
  const { P } = await models();
  assert.throws(() => P.normalizePlane({ name: '', x: 0, y: 0 }), /needs a name/);
  assert.throws(() => P.normalizeWay({ name: 'Loop', from: 'plane_00000001', to: 'plane_00000001' }), /another plane/);
  const plane = (id, revealed, x = 0, y = 0) => ({ ...P.normalizePlane({ name: id, x, y, revealed, description: `${id} secrets` }), id });
  const planes = [plane('plane_0000000a', true), plane('plane_0000000b', true, 100, 0), plane('plane_0000000c', false, 0, 100)];
  const way = (id, from, to, extra) => ({ ...P.normalizeWay({ name: id, from, to, ...extra }), id });
  const ways = [
    way('way_00000001', 'plane_0000000a', 'plane_0000000b', { revealed: true }),
    way('way_00000002', 'plane_0000000a', 'plane_0000000c', { revealed: true }), // its far end is hidden
    way('way_00000003', 'plane_0000000a', 'plane_0000000c', { hint: true, oneWay: true }),
    way('way_00000004', 'plane_0000000a', 'plane_0000000b', { hint: true }), // both ends known: no "?"
  ];
  const g = P.playerPlanar(planes, ways);
  assert.deepEqual(g.planes.map((p) => p.id), ['plane_0000000a', 'plane_0000000b']);
  assert.deepEqual(g.ways.map((w) => w.id), ['way_00000001']);
  assert.deepEqual(g.hints, [{ id: 'way_00000003', at: 'plane_0000000a', angle: 1.57, inbound: false }]);
  const text = JSON.stringify(g);
  assert.ok(!text.includes('plane_0000000c') && !text.includes('secrets'), 'no hidden plane, no descriptions');
  assert.equal(P.planarCard('way_00000001', planes, ways).where, 'Between plane_0000000a and plane_0000000b');
  assert.equal(P.planarCard('way_00000002', planes, ways), null);
  assert.equal(P.planarCard('plane_0000000c', planes, ways), null);
});

test('Cartographer: players never get the map under fog, only an up-to-date baked copy', async () => {
  const { C } = await models();
  assert.throws(() => C.normalizeChart({ name: 'Blank', width: 10, height: 10 }), /map image/);
  const chart = { ...C.normalizeChart({ name: 'The Sunken Keep', kind: 'dungeon', image: IMG(1), width: 2000, height: 1000, revealed: true, ops: [[1, 0.5, 0.5, 0.1], [7, 0, 0, 0.1], [0, 2, 0, 0.1]] }), id: 'chart_0000000a' };
  assert.equal(chart.fog, true, 'fog of war is on by default');
  assert.deepEqual(chart.ops, [[1, 0.5, 0.5, 0.1]], 'only well-formed brush strokes are kept');
  const regions = [{ ...C.normalizeRegion({ chart: chart.id, name: 'Flooded hall', points: [[0, 0], [0.2, 0], [0.2, 0.2]], revealed: true }), id: 'region_00000001' }];
  const pins = [
    { ...C.normalizePin({ chart: chart.id, name: 'Altar', x: 0.4, y: 0.4, revealed: true, link: 'chart_0000000b' }), id: 'pin_00000001' },
    { ...C.normalizePin({ chart: chart.id, name: 'Trapdoor', x: 0.1, y: 0.9 }), id: 'pin_00000002' },
  ];
  let shown = C.playerChart(chart, pins, regions);
  assert.equal(shown.image, null, 'nothing baked yet: covered');
  assert.equal(shown.covered, true);
  assert.deepEqual(shown.pins.map((p) => [p.name, p.link]), [['Altar', null]], 'a link to a hidden chart is dropped');
  const baked = { ...chart, playerImage: IMG(2), bakedKey: C.fogKey(chart, regions) };
  assert.equal(C.playerChart(baked, pins, regions).image, IMG(2));
  assert.ok(!JSON.stringify(C.playerChart(baked, pins, regions)).includes(IMG(1)), 'never the GM\'s map');
  // Revealing another region changes the fog: the old copy is out of date until baked again.
  const more = [...regions, { ...C.normalizeRegion({ chart: chart.id, name: 'Crypt', points: [[0.5, 0.5], [0.9, 0.5], [0.9, 0.9]], revealed: true }), id: 'region_00000002' }];
  assert.equal(C.playerChart(baked, pins, more).image, null);
  assert.equal(C.playerChart({ ...chart, fog: false }, pins, regions).image, IMG(1), 'without fog, the map itself');
  assert.equal(C.playerChart({ ...chart, revealed: false }, pins, regions), null);
  assert.equal(C.chartCard('pin_00000002', [chart], pins, regions), null);
  assert.equal(C.chartCard('pin_00000001', [chart], pins, regions).where, 'On The Sunken Keep');
});

test('Galactic: lanes need both ends known; Night City is a unique, movable place', async () => {
  const { G } = await models();
  const settings = { maps: { mode: 'galactic', nightCity: { enabled: true, revealed: true, galactic: { x: 50, y: 60 } } } };
  const [nc] = G.uniqueStars(settings);
  assert.deepEqual([nc.id, nc.x, nc.y, nc.unique], ['unique_nightcity', 50, 60, true]);
  assert.deepEqual(G.uniqueStars({ maps: { mode: 'planetary' } }), [], 'only on a star map');
  const star = (id, revealed, x, y) => ({ ...G.normalizeStar({ name: id, x, y, revealed }), id });
  const stars = [nc, star('star_00000001', true, 0, 0), star('star_00000002', false, 300, 0)];
  const lanes = [
    { ...G.normalizeLane({ name: 'Old Run', from: 'unique_nightcity', to: 'star_00000001', revealed: true, travel: '3 days' }), id: 'lane_00000001' },
    { ...G.normalizeLane({ name: 'Smugglers', from: 'star_00000001', to: 'star_00000002', revealed: true }), id: 'lane_00000002' },
  ];
  const sectors = [{ ...G.normalizeSector({ name: 'Core', points: [[-100, -100], [100, -100], [100, 100], [-100, 100]], revealed: true }), id: 'sector_00000001' }];
  assert.throws(() => G.normalizeSector({ name: 'Line', points: [[0, 0], [1, 1]] }), /three corners/);
  const map = G.playerStarmap(stars, lanes, sectors);
  assert.deepEqual(map.lanes.map((l) => l.id), ['lane_00000001']);
  assert.ok(!JSON.stringify(map).includes('star_00000002'));
  assert.equal(G.galacticCard('star_00000001', stars, lanes, sectors).where, 'Core sector');
  assert.equal(G.galacticCard('lane_00000001', stars, lanes, sectors).where, 'Night City ⇄ star_00000001 · 3 days');
  assert.equal(G.galacticCard('lane_00000002', stars, lanes, sectors), null);
});

test('push requests for the new maps are checked', async () => {
  const { M } = await models();
  const p = { project: 'proj_0000000a' };
  assert.deepEqual(M.normalizePushRequest({ ...p, mode: 'planes', box: { x0: 0, y0: 0, x1: 10, y1: 10 }, focus: 'plane_0000000a' }), { mode: 'planes', ...p, box: { x0: 0, y0: 0, x1: 10, y1: 10 }, focus: 'plane_0000000a' });
  assert.equal(M.normalizePushRequest({ ...p, mode: 'starmap', box: { x0: 5, y0: 0, x1: 1, y1: 10 } }).box, null, 'a box must have some size');
  assert.throws(() => M.normalizePushRequest({ ...p, mode: 'chart', id: 'nope' }), /No such chart/);
  assert.throws(() => M.normalizePushRequest({ ...p, mode: 'place', id: 'char_0000000a' }), /No such place/);
  assert.equal(M.pushKind('starmap'), 'map');
  assert.equal(M.pushKind('place'), 'entity');
});

test('the stores, pushes and the Codex of a Planar project', async () => {
  await withProject('planar', async ({ library, project, stores, display, codex }) => {
    const a = await stores.planes.create({ name: 'Material Plane', kind: 'material', x: 0, y: 0, revealed: true });
    const b = await stores.planes.create({ name: 'The Feywild', kind: 'outer', x: 200, y: 0, revealed: true, description: 'Bright and strange.' });
    const c = await stores.planes.create({ name: 'Shadowfell', kind: 'outer', x: 0, y: 200 });
    assert.match(a.id, /^plane_[0-9a-f]{8}$/);
    const w = await stores.ways.create({ name: 'Fairy ring', kind: 'portal', from: a.id, to: b.id, revealed: true });
    await stores.ways.create({ name: 'Shadow door', kind: 'rift', from: a.id, to: c.id, hint: true });
    await assert.rejects(stores.ways.create({ name: 'Bad', from: a.id, to: a.id }), /another plane/);

    const shown = await display.push({ mode: 'planes', project: project.id, focus: c.id });
    assert.deepEqual(shown.graph.planes.map((p) => p.name).sort(), ['Material Plane', 'The Feywild']);
    assert.equal(shown.focus, null, 'a hidden plane is never lit');
    assert.equal(shown.graph.hints.length, 1);
    assert.ok(!JSON.stringify(shown).includes('Shadow'));
    await assert.rejects(display.push({ mode: 'place', project: project.id, id: c.id }), /hidden from players/);
    await assert.rejects(display.push({ mode: 'place', project: project.id, id: 'plane_ffffffff' }), /No such place/);
    assert.equal((await display.push({ mode: 'place', project: project.id, id: w.id })).place.label, 'Portal');

    const all = await codex.list();
    assert.deepEqual(all.entries.filter((x) => x.group === 'places').map((x) => x.title).sort(), ['Fairy ring', 'Material Plane', 'The Feywild']);
    assert.equal((await codex.entry(b.id)).place.description, 'Bright and strange.');
    await assert.rejects(codex.entry(c.id), /Not in the Codex/);

    // Deleting a plane takes its ways with it (through the route, as the GM window does).
    const res = {};
    const helpers = { readJson: async () => ({}), sendJson: (r, status, data) => Object.assign(r, { status, data }) };
    await handleProjects(library, { method: 'DELETE' }, res, `/${project.id}/planes/${a.id}`, new URLSearchParams(), helpers);
    assert.equal(res.status, 200);
    assert.deepEqual(await stores.ways.list(), []);
  });
});

test('a Cartographer chart pushes its baked copy; pins follow their chart', async () => {
  const { C } = await models();
  await withProject('cartographer', async ({ project, stores, display, codex }) => {
    const chart = await stores.charts.create({ name: 'Greywater', kind: 'city', image: IMG(3), width: 800, height: 600, revealed: true });
    const pin = await stores.pins.create({ chart: chart.id, name: 'The Drowned Rat', icon: 'bar', x: 0.5, y: 0.5, revealed: true });
    let shown = await display.push({ mode: 'chart', project: project.id, id: chart.id, focus: pin.id });
    assert.equal(shown.chart.covered, true);
    assert.equal(shown.focus, pin.id);
    assert.ok(!JSON.stringify(shown).includes(IMG(3)), 'the GM\'s map stays home');
    await stores.charts.save(chart.id, { ...chart, playerImage: IMG(4), bakedKey: C.fogKey(chart, []) });
    shown = await display.push({ mode: 'chart', project: project.id, id: chart.id });
    assert.equal(shown.chart.image, IMG(4));
    const entries = (await codex.list()).entries.filter((x) => x.group === 'places');
    assert.deepEqual(entries.map((x) => [x.title, x.image]).sort(), [['Greywater', IMG(4)], ['The Drowned Rat', null]]);
    // Hide the chart: its pins leave the Codex with it.
    await stores.charts.save(chart.id, { ...chart, revealed: false });
    assert.deepEqual((await codex.list()).entries.filter((x) => x.group === 'places'), []);
    await assert.rejects(display.push({ mode: 'chart', project: project.id, id: chart.id }), /hidden from players/);
  });
});

test('a Galactic project keeps Night City on its star map, movable from there', async () => {
  await withProject('galactic', async ({ library, project, stores, display, codex }) => {
    let list = await library.listStars(project.id);
    assert.deepEqual(list.map((s) => s.id), ['unique_nightcity']);
    const moved = await library.setUniqueStar(project.id, 'unique_nightcity', { x: 400, y: -20 });
    assert.deepEqual([moved.x, moved.y, moved.revealed], [400, -20, true]);
    const sol = await stores.stars.create({ name: 'Sol', kind: 'star', x: 380, y: 0, revealed: true });
    await stores.lanes.create({ name: 'Home run', from: sol.id, to: 'unique_nightcity', revealed: true });
    const shown = await display.push({ mode: 'starmap', project: project.id, focus: 'unique_nightcity' });
    assert.equal(shown.map.lanes.length, 1);
    assert.equal(shown.focus, 'unique_nightcity');
    const places = (await codex.list()).entries.filter((x) => x.group === 'places').map((x) => x.title).sort();
    assert.deepEqual(places, ['Home run', 'Night City', 'Sol'], 'Night City once, as a place on the star map');
    assert.equal((await codex.entry('unique_nightcity')).place.label, 'Unique Settlement');
    await library.setUniqueStar(project.id, 'unique_nightcity', { revealed: false });
    list = await library.listStars(project.id, { view: 'player' });
    assert.deepEqual(list.map((s) => s.name), ['Sol']);
  });
});
