// Globe maths for the World View: decoding the Earth's outlines (TopoJSON) and
// projecting longitude/latitude onto a rotatable sphere. Pure functions (no DOM),
// tested in Node.
//
// The view is an orthographic projection: the globe as seen from far away, with
// a rotation { lon, lat } putting that point at the centre of the disc. Points on
// the far side are "hidden" (z < 0); the renderer draws them faintly or not at all.

const RAD = Math.PI / 180;

/**
 * Decode a TopoJSON topology's object into rings of [lon, lat] points.
 * Handles quantized, delta-encoded arcs and reversed arc references (~i).
 */
export function decodeRings(topology, objectName) {
  const { scale = [1, 1], translate = [0, 0] } = topology.transform ?? {};
  const quantized = Boolean(topology.transform);
  const arcs = topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      if (!quantized) return [dx, dy];
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
  const arcPoints = (i) => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());
  const ring = (indexes) => {
    const out = [];
    indexes.forEach((i, n) => {
      const pts = arcPoints(i);
      out.push(...(n ? pts.slice(1) : pts)); // consecutive arcs share an end point
    });
    return out;
  };
  const rings = [];
  const walk = (g) => {
    if (!g) return;
    if (g.type === 'GeometryCollection') g.geometries.forEach(walk);
    else if (g.type === 'Polygon') g.arcs.forEach((r) => rings.push(ring(r)));
    else if (g.type === 'MultiPolygon') g.arcs.forEach((poly) => poly.forEach((r) => rings.push(ring(r))));
  };
  walk(topology.objects[objectName]);
  return rings;
}

/** A longitude/latitude (degrees) as a unit vector: x east, y north, z towards 0°N 0°E. */
export function toVector(lon, lat) {
  const l = lon * RAD;
  const p = lat * RAD;
  return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)];
}

/**
 * Rotate a unit vector so the view's centre { lon, lat } faces the viewer.
 * Returns [x, y, z]: x right, y up, z towards the viewer (z < 0: far side).
 */
export function rotate([x, y, z], view) {
  const l = -view.lon * RAD;
  const p = view.lat * RAD;
  // Spin about the polar axis so the centre longitude comes round to the front…
  const x1 = x * Math.cos(l) + z * Math.sin(l);
  const z1 = -x * Math.sin(l) + z * Math.cos(l);
  // …then tilt so the centre latitude comes level.
  const y2 = y * Math.cos(p) - z1 * Math.sin(p);
  const z2 = y * Math.sin(p) + z1 * Math.cos(p);
  return [x1, y2, z2];
}

/** Project lon/lat onto the screen: { x, y, z } with the globe's centre at (cx, cy) and radius r. */
export function project(lon, lat, view, { cx, cy, r }) {
  const [x, y, z] = rotate(toVector(lon, lat), view);
  return { x: cx + x * r, y: cy - y * r, z };
}

/**
 * The inverse: which lon/lat is under a screen point, or null if it's off the globe.
 */
export function unproject(px, py, view, { cx, cy, r }) {
  const x = (px - cx) / r;
  const y = -(py - cy) / r;
  const d = x * x + y * y;
  if (d > 1) return null;
  const z = Math.sqrt(1 - d);
  // Undo the tilt, then the spin.
  const p = view.lat * RAD;
  const y1 = y * Math.cos(p) + z * Math.sin(p);
  const z1 = -y * Math.sin(p) + z * Math.cos(p);
  const l = -view.lon * RAD;
  const x0 = x * Math.cos(l) - z1 * Math.sin(l);
  const z0 = x * Math.sin(l) + z1 * Math.cos(l);
  return { lon: Math.atan2(x0, z0) / RAD, lat: Math.asin(Math.max(-1, Math.min(1, y1))) / RAD };
}

/** Keep a view sensible: longitude wrapped to −180…180, latitude clamped short of the poles. */
export function normalizeView({ lon, lat }) {
  return { lon: ((((lon + 180) % 360) + 360) % 360) - 180, lat: Math.max(-89, Math.min(89, lat)) };
}

/**
 * Split a line of [lon, lat] points into the runs that face the viewer
 * (projected), so lines disappear cleanly over the horizon.
 */
export function visibleRuns(points, view, frame, { back = false } = {}) {
  const runs = [];
  let run = [];
  for (const [lon, lat] of points) {
    const p = project(lon, lat, view, frame);
    if ((p.z >= 0) !== back) run.push(p);
    else if (run.length) {
      if (run.length > 1) runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/**
 * Project a closed ring for filling, clipped to the near side: where the ring
 * goes over the horizon it's cut at the exact crossing, and the stretch out of
 * sight is replaced by an arc along the disc's edge from where it left to where
 * it came back (following the way the hidden part winds, so land around a pole
 * still closes properly). Returns null when the whole ring is out of sight.
 *
 * (Pulling each hidden point onto the edge on its own makes long chords straight
 * across the disc at some angles, which showed as torn land while dragging.)
 */
export function fillRing(points, view, frame) {
  const n = points.length;
  if (n < 3) return null;
  const v = points.map(([lon, lat]) => rotate(toVector(lon, lat), view));
  const start = v.findIndex((p) => p[2] >= 0);
  if (start < 0) return null;
  const { cx, cy, r } = frame;
  const out = [];
  const put = (x, y, z) => out.push({ x: cx + x * r, y: cy - y * r, z });
  const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  const STEP = Math.PI / 72; // 2.5° of arc along the edge
  // Where the edge a→b meets the horizon (z = 0), on the unit circle.
  const crossing = (a, b) => {
    const t = a[2] / (a[2] - b[2]);
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    const d = Math.hypot(x, y) || 1;
    return [x / d, y / d];
  };
  // First pass: the visible points, and for each stretch out of sight an arc token
  // { from, sweep, to } recording how far round the edge its hidden coast wound.
  const parts = [];
  let arc = null;
  let prev = 0;
  for (let k = 0; k <= n; k++) {
    const i = (start + k) % n;
    const p = v[i];
    const q = v[(i + n - 1) % n];
    if (k > 0 && (q[2] >= 0) !== (p[2] >= 0)) {
      const [x, y] = crossing(q, p);
      const at = Math.atan2(y, x);
      if (p[2] < 0) {
        parts.push([x, y, 0]); // going out of sight
        arc = { from: at, sweep: 0 };
        prev = at;
      } else {
        arc.sweep += wrap(at - prev); // back in sight
        parts.push(arc, [x, y, 0]);
        arc = null;
      }
    }
    if (k === n) break; // back at the start, which is already in
    if (p[2] >= 0) parts.push(p);
    else if (arc && (p[0] || p[1])) {
      const at = Math.atan2(p[1], p[0]);
      arc.sweep += wrap(at - prev);
      prev = at;
    }
  }
  // A ring that goes round the point straight through the globe (its far-side centre) winds
  // once round the disc's centre as seen from the front. Land is on the right of its
  // coast (Natural Earth's rings run clockwise), so winding anticlockwise (+1) means the
  // land holds that far point, not the near one: its hidden coast circling the far side
  // isn't land along the whole edge, so one full turn comes off the widest arc.
  let turn = 0;
  for (let i = 0; i < n; i++) {
    const a = v[i];
    const b = v[(i + 1) % n];
    if ((a[0] || a[1]) && (b[0] || b[1])) turn += wrap(Math.atan2(b[1], b[0]) - Math.atan2(a[1], a[0]));
  }
  const winds = Math.round(turn / (2 * Math.PI));
  const arcs = parts.filter((x) => !Array.isArray(x));
  if (winds > 0 && arcs.length) {
    const widest = arcs.reduce((m, x) => (x.sweep > m.sweep ? x : m));
    widest.sweep -= 2 * Math.PI * winds;
  }
  for (const x of parts) {
    if (Array.isArray(x)) {
      put(x[0], x[1], x[2]);
      continue;
    }
    const steps = Math.floor(Math.abs(x.sweep) / STEP);
    for (let s = 1; s <= steps; s++) {
      const a = x.from + (x.sweep * s) / (steps + 1);
      put(Math.cos(a), Math.sin(a), 0);
    }
  }
  return out;
}

/** Graticule lines every `step` degrees: meridians and parallels, as [lon, lat] polylines. */
export function graticule(step = 15, detail = 3) {
  const lines = [];
  for (let lon = -180; lon < 180; lon += step) {
    const line = [];
    for (let lat = -90; lat <= 90; lat += detail) line.push([lon, lat]);
    lines.push({ kind: lon === 0 ? 'prime' : 'meridian', points: line });
  }
  for (let lat = -90 + step; lat < 90; lat += step) {
    const line = [];
    for (let lon = -180; lon <= 180; lon += detail) line.push([lon, lat]);
    lines.push({ kind: lat === 0 ? 'equator' : 'parallel', points: line });
  }
  return lines;
}

/** "12.3°N 45.6°E" */
export function formatLonLat({ lon, lat }) {
  const f = (v, pos, neg) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? pos : neg}`;
  return `${f(lat, 'N', 'S')} ${f(lon, 'E', 'W')}`;
}
