import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../app/maps/globe-math.js';

const frame = { cx: 200, cy: 200, r: 100 };
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('the view centre faces the viewer; the opposite side is hidden', () => {
  for (const view of [{ lon: 0, lat: 0 }, { lon: 139.7, lat: 35.7 }, { lon: -74, lat: 40.7 }, { lon: 120, lat: -60 }]) {
    const c = G.project(view.lon, view.lat, view, frame);
    close(c.x, 200);
    close(c.y, 200);
    close(c.z, 1);
    const anti = G.project(view.lon + 180, -view.lat, view, frame);
    close(anti.z, -1);
  }
  // North is up, east is right.
  const v = { lon: 0, lat: 0 };
  assert.ok(G.project(0, 30, v, frame).y < 200);
  assert.ok(G.project(30, 0, v, frame).x > 200);
});

test('unproject undoes project, and misses off the disc', () => {
  const view = { lon: 37, lat: 21 };
  for (const [lon, lat] of [[37, 21], [60, 40], [10, -5], [80, 70]]) {
    const p = G.project(lon, lat, view, frame);
    assert.ok(p.z > 0);
    const back = G.unproject(p.x, p.y, view, frame);
    close(back.lon, lon, 1e-6);
    close(back.lat, lat, 1e-6);
  }
  assert.equal(G.unproject(0, 0, view, frame), null);
});

test('views wrap longitude and stop short of the poles', () => {
  assert.deepEqual(G.normalizeView({ lon: 190, lat: 95 }), { lon: -170, lat: 89 });
  assert.deepEqual(G.normalizeView({ lon: -540, lat: -120 }), { lon: -180, lat: -89 });
  assert.equal(G.formatLonLat({ lon: -74.006, lat: 40.7128 }), '40.7°N 74.0°W');
});

test('lines break at the horizon; fills are pulled onto it', () => {
  const view = { lon: 0, lat: 0 };
  const equator = [];
  for (let lon = -180; lon <= 180; lon += 10) equator.push([lon, 0]);
  const runs = G.visibleRuns(equator, view, frame);
  assert.equal(runs.length, 1, 'one visible run across the front');
  assert.ok(runs[0].every((p) => p.z >= 0));
  assert.ok(G.visibleRuns(equator, view, frame, { back: true }).length >= 1, 'and the far side, for the faint back lines');
  const ring = G.fillRing([[170, 10], [175, -10], [-170, 0]], view, frame);
  assert.equal(ring, null, 'a ring wholly behind is skipped');
  const half = G.fillRing([[80, 0], [100, 0], [100, 10]], view, frame);
  assert.ok(half.every((p) => Math.hypot(p.x - 200, p.y - 200) <= 100 + 1e-9), 'hidden points sit on the edge');
});

test('fills are clipped at the horizon without chords across the disc', () => {
  const inside = (pts, x, y) => {
    let hit = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  // A cap round the south pole (like Antarctica), seen side-on: land at the bottom, not in the middle.
  const cap = [];
  for (let lon = -180; lon <= 180; lon += 10) cap.push([lon, -60]);
  cap.push([180, -90], [-180, -90]);
  for (const lon of [0, 37, 140, -100]) {
    const view = { lon, lat: 10 };
    const pts = G.fillRing(cap, view, frame);
    assert.ok(pts, `cap visible from ${lon}`);
    assert.ok(inside(pts, 200, 200 + 98), `bottom edge is land from ${lon}`);
    assert.ok(!inside(pts, 200, 200), `centre is sea from ${lon}`);
    assert.ok(!inside(pts, 200, 200 - 90), `top is sea from ${lon}`);
  }
  // The real coastlines, from many angles: every point on or inside the disc, and no long jumps
  // (a jump is a chord cut across the globe, which drew as torn land).
  const topo = JSON.parse(readFileSync(new URL('../app/vendor/land-110m.json', import.meta.url), 'utf8'));
  const rings = G.decodeRings(topo, 'land');
  for (let lat = -80; lat <= 80; lat += 20) {
    for (let lon = -180; lon < 180; lon += 15) {
      for (const ring of rings) {
        const pts = G.fillRing(ring, { lon, lat }, frame);
        if (!pts) continue;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          assert.ok(Math.hypot(a.x - 200, a.y - 200) <= 100 + 1e-6, 'on the disc');
          const both = a.z === 0 && b.z === 0;
          if (both) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 10, `edge arc in small steps at ${lon},${lat}`);
        }
      }
    }
  }
});

test('what the globe fills as land is the land under it, from any angle', () => {
  // Inside test for screen polygons and for lon/lat rings alike.
  const pip = (pts, x, y, X, Y) => {
    let hit = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if ((a[Y] > y) !== (b[Y] > y) && x < ((b[X] - a[X]) * (y - a[Y])) / (b[Y] - a[Y]) + a[X]) hit = !hit;
    }
    return hit;
  };
  const topo = JSON.parse(readFileSync(new URL('../app/vendor/land-110m.json', import.meta.url), 'utf8'));
  const rings = G.decodeRings(topo, 'land');
  const lonLat = rings.map((r) => r.map(([lon, lat]) => ({ lon, lat })));
  const isLand = (lon, lat) => lonLat.reduce((h, r) => h !== pip(r, lon, lat, 'lon', 'lat'), false);
  // Including the angle that drew the sea as land (North America holds the far-side point).
  const views = [{ lon: 68.1, lat: -33.8 }, { lon: -112, lat: 34 }, { lon: 20, lat: 5 }, { lon: 0, lat: -89 }];
  for (let lat = -85; lat <= 85; lat += 34) for (let lon = -180; lon < 180; lon += 40) views.push({ lon, lat });
  for (const view of views) {
    const fills = rings.map((r) => G.fillRing(r, view, frame)).filter(Boolean);
    let miss = 0;
    let n = 0;
    for (let sx = -0.9; sx <= 0.9; sx += 0.15) {
      for (let sy = -0.9; sy <= 0.9; sy += 0.15) {
        const px = 200 + sx * 100;
        const py = 200 + sy * 100;
        const g = G.unproject(px, py, view, frame);
        if (!g || sx * sx + sy * sy > 0.85 || Math.abs(g.lat) > 80) continue;
        n++;
        if (fills.reduce((h, p) => h !== pip(p, px, py, 'x', 'y'), false) !== isLand(g.lon, g.lat)) miss++;
      }
    }
    // Coastline sampling disagrees a little; an inverted fill (sea drawn as land) is most of the disc.
    assert.ok(miss / n < 0.15, `${view.lon},${view.lat}: ${miss}/${n} points wrong`);
  }
});

test('the Earth decodes from the vendored Natural Earth outlines', () => {
  const topo = JSON.parse(readFileSync(new URL('../app/vendor/land-110m.json', import.meta.url), 'utf8'));
  const rings = G.decodeRings(topo, 'land');
  assert.ok(rings.length > 100, `${rings.length} rings`);
  const all = rings.flat();
  assert.ok(all.every(([lon, lat]) => lon >= -180.0001 && lon <= 180.0001 && lat >= -90.0001 && lat <= 90.0001));
  // Some land near London, none in the middle of the Pacific.
  const near = (lon, lat, d) => all.some(([x, y]) => Math.abs(x - lon) < d && Math.abs(y - lat) < d);
  assert.ok(near(0, 51.5, 2), 'Britain');
  assert.ok(!near(-140, 0, 4), 'open Pacific');
  // Rings close on themselves.
  for (const r of rings.slice(0, 20)) assert.deepEqual(r[0].map((v) => +v.toFixed(6)), r.at(-1).map((v) => +v.toFixed(6)));
  assert.ok(G.graticule(15).some((l) => l.kind === 'equator'));
});
