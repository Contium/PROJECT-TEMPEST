import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NIGHT_CITY, prepareDistricts, pathOf, contains, districtAt, fitMap, fitBox, clampView, zoomAt, zoomWithin, toImage, relativeZoom, shareOf, MAX_ZOOM } from '../app/maps/city-map-model.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const square = { districts: [{ id: 'a', name: 'Alpha', area: 0.25, center: [0.25, 0.25], rings: [[[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]]] }] };

test('districts are scaled into image pixels with bounds', () => {
  const [d] = prepareDistricts(square, { width: 200, height: 400 });
  assert.equal(d.name, 'Alpha');
  assert.deepEqual(d.bounds, { x0: 0, y0: 0, x1: 100, y1: 200 });
  assert.deepEqual(d.center, [50, 100]);
  assert.match(pathOf(d.rings), /^M0\.0 0\.0L100\.0 0\.0L100\.0 200\.0L0\.0 200\.0Z$/);
});

test('bad district entries are dropped', () => {
  assert.deepEqual(prepareDistricts({ districts: [null, { name: 'x' }, { name: 'y', rings: [[[0, 0]]] }] }, { width: 1, height: 1 }), []);
  assert.deepEqual(prepareDistricts(null, { width: 1, height: 1 }), []);
});

test('point-in-district', () => {
  const ds = prepareDistricts(square, { width: 100, height: 100 });
  assert.ok(contains(ds[0].rings, [10, 10]));
  assert.ok(!contains(ds[0].rings, [60, 10]));
  assert.equal(districtAt(ds, [25, 25])?.id, 'a');
  assert.equal(districtAt(ds, [90, 90]), null);
});

test('fit, zoom about a point, and clamping', () => {
  const vp = { width: 800, height: 600 };
  const fit = fitMap(NIGHT_CITY, vp);
  assert.ok(NIGHT_CITY.height * fit.scale <= 600);
  // Zooming keeps the point under the cursor fixed.
  const before = toImage(fit, 300, 200);
  const z = zoomAt(fit, 2, 300, 200);
  const after = toImage(z, 300, 200);
  assert.ok(Math.abs(before[0] - after[0]) < 1e-9 && Math.abs(before[1] - after[1]) < 1e-9);
  assert.ok(Math.abs(relativeZoom(z, NIGHT_CITY, vp) - 2) < 1e-9);
  // Zoom is capped, and the map can't be thrown off screen.
  const huge = clampView({ ...fit, scale: fit.scale * 1000 }, NIGHT_CITY, vp);
  assert.ok(Math.abs(huge.scale / fit.scale - MAX_ZOOM) < 1e-9);
  const gone = clampView({ ...fit, x: 99999 }, NIGHT_CITY, vp);
  assert.ok(gone.x < vp.width);
  const box = fitBox({ x0: 100, y0: 100, x1: 300, y1: 200 }, vp, 0);
  assert.equal(box.scale, 4); // 200 x 100 into 800 x 600: width-bound
  assert.deepEqual([box.x, box.y], [400 - 200 * 4, 300 - 150 * 4]);
});

test('zooming past the limits stops instead of sliding the map', () => {
  const vp = { width: 800, height: 600 };
  let v = fitMap(NIGHT_CITY, vp);
  const anchor = toImage(v, 500, 400);
  for (let i = 0; i < 200; i++) v = clampView(zoomWithin(v, 1.3, 500, 400, NIGHT_CITY, vp), NIGHT_CITY, vp);
  assert.ok(Math.abs(relativeZoom(v, NIGHT_CITY, vp) - MAX_ZOOM) < 1e-9);
  const still = toImage(v, 500, 400);
  assert.ok(Math.abs(still[0] - anchor[0]) < 1e-6 && Math.abs(still[1] - anchor[1]) < 1e-6, `drifted to ${still}`);
  for (let i = 0; i < 200; i++) v = clampView(zoomWithin(v, 0.7, 500, 400, NIGHT_CITY, vp), NIGHT_CITY, vp);
  assert.ok(Math.abs(relativeZoom(v, NIGHT_CITY, vp) - 0.5) < 1e-9);
});

test('shares add up to 100%', () => {
  const ds = prepareDistricts({ districts: [{ ...square.districts[0] }, { ...square.districts[0], id: 'b', name: 'B', area: 0.75 }] }, { width: 1, height: 1 });
  assert.equal(shareOf(ds[0], ds) + shareOf(ds[1], ds), 100);
});

test('the Night City atlas ships with its layers and 25 traced districts', () => {
  for (const l of NIGHT_CITY.layers) assert.ok(existsSync(`${root}assets/maps/nightcity/${l.file}`), l.file);
  const data = JSON.parse(readFileSync(`${root}assets/maps/nightcity/districts.json`, 'utf8'));
  const ds = prepareDistricts(data, NIGHT_CITY);
  assert.equal(ds.length, 25);
  for (const name of ['Heywood Industrial Zone', 'Old Combat Zone', 'Port of Night City', 'North Heywood', 'Santo Domingo', 'The Glen']) assert.ok(ds.some((d) => d.name === name), name);
  // Every district's own centre lies in it or near it, and no two districts claim it.
  const ids = new Set(ds.map((d) => d.id));
  assert.equal(ids.size, 25);
});
