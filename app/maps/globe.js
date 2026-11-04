// The interactive globe: a 3D Earth drawn on a <canvas> as holographic line art
// in the theme's colours (red wireframe and cyan accents in Cyberpunk RED).
//
//   drag            spin it (it keeps turning a little when let go)
//   wheel / pinch   zoom
//   double-click    fly to that spot
//   keys            arrows spin, + / − zoom, Space starts/stops the slow spin, 0 resets
//   click           (not a drag) picks a marker, or a point on the globe
//
// Layers, back to front: atmosphere glow, ocean disc with scanlines, the far
// side's graticule and coasts showing faintly through, the near graticule
// (equator and prime meridian picked out), land as a dot-matrix fill, glowing
// coastlines, then the HUD rim (degree ticks, a sweeping scan arc) and the
// cursor marker. Effects "off" (or reduced motion) drops the glow and animation.

import { project, unproject, normalizeView, visibleRuns, fillRing, graticule } from './globe-math.js';

const DEG = 180 / Math.PI;
const HOME = { lon: 10, lat: 22 }; // Europe and Africa facing the viewer
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 6;
const SPIN = 4; // degrees per second when spinning on its own

/**
 * createGlobe(canvas, { rings, markers, onClick, onChange })
 *   rings     land outlines: [[lon, lat]…][]
 *   markers   () → [{ id, lon, lat, type, name, revealed, selected?, pending?, unique? }], read every frame
 *             type: city | landmark | poi | other | unknown (its glyph); hidden ones draw dimmed and dashed
 *   onClick   ({ lon, lat } | null, markerId | null) for a click that wasn't a drag
 *   onChange  ({ view, zoom, cursor, spinning }) after anything the HUD shows changes
 * Returns { setView, zoomBy, setZoom, getView, reset, toggleSpin, refreshColors, destroy }.
 */
export function createGlobe(canvas, { rings, markers = () => [], onClick = () => {}, onChange = () => {} }) {
  const ctx = canvas.getContext('2d');
  const lines = graticule(15, 3);
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const calm = () => document.documentElement.dataset.effects === 'off';

  let view = { ...HOME };
  let zoom = 1;
  let spinning = !still();
  let velocity = { lon: 0, lat: 0 }; // degrees per frame, after a drag
  let flight = null; // { from, to, start, ms } while flying to a point
  let cursor = null; // lon/lat under the pointer
  let cursorPx = null;
  let colors = {};
  let dotPattern = null;
  let size = { w: 0, h: 0, dpr: 1 };
  let raf = 0;
  let last = performance.now();

  const frame = () => {
    const r = Math.min(size.w, size.h) * 0.4 * zoom;
    return { cx: size.w / 2, cy: size.h / 2, r };
  };
  const emit = () => onChange({ view: { ...view }, zoom, cursor, spinning });

  // --- colours from the theme ---------------------------------------------------------

  function refreshColors() {
    const css = getComputedStyle(canvas);
    const read = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    colors = {
      line: read('--tp-primary', '#f75049'),
      accent: read('--tp-interactive', '#5ef6ff'),
      ocean: read('--tp-surface', '#12121e'),
      deep: read('--tp-bg', '#0e0e17'),
      text: read('--tp-text-muted', '#a8716d'),
      heading: read('--tp-text-heading', '#f75049'),
      font: read('--tp-font-display', 'sans-serif'),
    };
    // Dot-matrix land: a tiny tile with one dot, in the line colour.
    const tile = document.createElement('canvas');
    tile.width = tile.height = 4 * size.dpr;
    const t = tile.getContext('2d');
    t.fillStyle = colors.line;
    t.beginPath();
    t.arc(tile.width / 2, tile.height / 2, 0.75 * size.dpr, 0, Math.PI * 2);
    t.fill();
    dotPattern = ctx.createPattern(tile, 'repeat');
  }

  function resize() {
    const box = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = { w: box.width, h: box.height, dpr };
    canvas.width = Math.max(1, Math.round(box.width * dpr));
    canvas.height = Math.max(1, Math.round(box.height * dpr));
    refreshColors();
  }

  // --- drawing ----------------------------------------------------------------------------

  const path = (runs) => {
    ctx.beginPath();
    for (const run of runs) {
      ctx.moveTo(run[0].x, run[0].y);
      for (let i = 1; i < run.length; i++) ctx.lineTo(run[i].x, run[i].y);
    }
  };
  const stroke = (runs, color, width, alpha) => {
    path(runs);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.stroke();
  };

  function draw(now) {
    const f = frame();
    const { cx, cy, r } = f;
    const fx = !calm();
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.globalAlpha = 1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Atmosphere: a glow just outside the disc.
    if (fx) {
      const glow = ctx.createRadialGradient(cx, cy, r * 0.92, cx, cy, r * 1.3);
      glow.addColorStop(0, colors.line);
      glow.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ocean: a dark disc, lit slightly from the upper left.
    const sea = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    sea.addColorStop(0, colors.ocean);
    sea.addColorStop(1, colors.deep);
    ctx.globalAlpha = 1;
    ctx.fillStyle = sea;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // The far side, showing through the hologram.
    for (const l of lines) stroke(visibleRuns(l.points, view, f, { back: true }), colors.line, 0.6, 0.05);
    for (const ring of rings) stroke(visibleRuns(ring, view, f, { back: true }), colors.line, 0.8, 0.1);

    // Near graticule, equator and prime meridian picked out.
    for (const l of lines) {
      const key = l.kind === 'equator' || l.kind === 'prime';
      stroke(visibleRuns(l.points, view, f), key ? colors.accent : colors.line, key ? 1 : 0.6, key ? 0.45 : 0.18);
    }

    // Land: dot-matrix fill under a faint wash.
    ctx.beginPath();
    for (const ring of rings) {
      const pts = fillRing(ring, view, f);
      if (!pts) continue;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
    }
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = colors.line;
    ctx.fill('evenodd');
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = dotPattern;
    ctx.fill('evenodd');

    // Coastlines: a wide faint stroke under a thin bright one reads as a glow.
    const coasts = rings.flatMap((ring) => visibleRuns(ring, view, f));
    if (fx) stroke(coasts, colors.line, 4, 0.18);
    stroke(coasts, colors.line, 1.2, 0.95);

    // Scanlines drifting down the disc.
    if (fx) {
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = colors.deep;
      const off = (now / 60) % 4;
      for (let y = cy - r + off; y < cy + r; y += 4) ctx.fillRect(cx - r, y, r * 2, 1.5);
    }
    ctx.restore();

    // HUD rim: the disc's edge, ticks every 10°, a sweeping scan arc.
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let a = 0; a < 360; a += 10) {
      const t = (a * Math.PI) / 180;
      const long = a % 30 === 0;
      const r1 = r + 6;
      const r2 = r + (long ? 16 : 10);
      ctx.moveTo(cx + Math.cos(t) * r1, cy + Math.sin(t) * r1);
      ctx.lineTo(cx + Math.cos(t) * r2, cy + Math.sin(t) * r2);
    }
    ctx.stroke();
    if (fx && !still()) {
      const a = (now / 2400) % (Math.PI * 2);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 22, a, a + 0.6);
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 22, a + Math.PI, a + Math.PI + 0.25);
      ctx.stroke();
    }

    drawMarkers(f, now, fx);

    // Centre crosshair.
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      ctx.moveTo(cx + dx * 6, cy + dy * 6);
      ctx.lineTo(cx + dx * 14, cy + dy * 14);
    }
    ctx.stroke();

    // The point under the cursor.
    if (cursor && cursorPx) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cursorPx.x, cursorPx.y, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(cursorPx.x, cursorPx.y, 10 + (fx ? Math.sin(now / 200) * 2 : 0), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // --- markers ----------------------------------------------------------------------------

  /** Markers facing the viewer, projected: [{ marker, x, y }]. */
  function visibleMarkers(f) {
    const out = [];
    for (const m of markers()) {
      const p = project(m.lon, m.lat, view, f);
      if (p.z > 0.02) out.push({ marker: m, x: p.x, y: p.y, z: p.z });
    }
    return out;
  }

  /** A type's glyph, centred on (x, y), size s. */
  function glyph(type, x, y, s) {
    ctx.beginPath();
    if (type === 'city') ctx.rect(x - s, y - s, s * 2, s * 2);
    else if (type === 'landmark') {
      ctx.moveTo(x, y - s * 1.2);
      ctx.lineTo(x + s * 1.1, y + s * 0.9);
      ctx.lineTo(x - s * 1.1, y + s * 0.9);
      ctx.closePath();
    } else if (type === 'poi') {
      ctx.moveTo(x, y - s * 1.3);
      ctx.lineTo(x + s * 1.3, y);
      ctx.lineTo(x, y + s * 1.3);
      ctx.lineTo(x - s * 1.3, y);
      ctx.closePath();
    } else ctx.arc(x, y, s, 0, Math.PI * 2);
  }

  function drawMarkers(f, now, fx) {
    const pulse = fx && !still() ? (Math.sin(now / 260) + 1) / 2 : 0.5;
    const list = visibleMarkers(f).sort((a, b) => a.z - b.z);
    ctx.textBaseline = 'middle';
    for (const { marker: m, x, y, z } of list) {
      const hidden = !m.revealed && !m.pending;
      const color = hidden ? colors.line : colors.accent;
      const s = (m.selected || m.pending ? 6 : 4.5) * (0.7 + z * 0.3);
      // Selection / placing: a pulsing ring.
      if (m.selected || m.pending) {
        ctx.globalAlpha = 0.35 + pulse * 0.4;
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1.5;
        ctx.setLineDash(m.pending ? [3, 3] : []);
        ctx.beginPath();
        ctx.arc(x, y, s + 7 + pulse * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // The glyph: dark inside, outlined in the marker's colour (dashed while hidden).
      ctx.globalAlpha = hidden ? 0.45 : 0.8;
      glyph(m.type, x, y, s);
      ctx.fillStyle = colors.deep;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.setLineDash(hidden ? [2, 2] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      if (m.type === 'unknown') {
        ctx.fillStyle = color;
        ctx.font = `700 ${Math.round(s * 1.6)}px ${colors.font}`;
        ctx.textAlign = 'center';
        ctx.fillText('?', x, y + 0.5);
      } else if (!hidden) {
        ctx.globalAlpha = 0.9;
        glyph(m.type, x, y, s * 0.45);
        ctx.fillStyle = color;
        ctx.fill();
      }
      // Unique POIs (Night City) wear a second, rotated frame.
      if (m.unique) {
        ctx.globalAlpha = hidden ? 0.45 : 0.9;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.setLineDash(hidden ? [2, 2] : []);
        const u = s * 2.1;
        ctx.beginPath();
        ctx.moveTo(x, y - u);
        ctx.lineTo(x + u, y);
        ctx.lineTo(x, y + u);
        ctx.lineTo(x - u, y);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Name label, when the globe is big enough to read it.
      if (m.name && (zoom >= 0.9 || m.selected)) {
        ctx.globalAlpha = hidden ? 0.55 : 0.95;
        ctx.font = `600 ${m.selected ? 13 : 11}px ${colors.font}`;
        ctx.textAlign = 'left';
        ctx.lineWidth = 3;
        ctx.strokeStyle = colors.deep;
        ctx.strokeText(m.name, x + s + 6, y);
        ctx.fillStyle = m.selected ? colors.accent : hidden ? colors.text : colors.heading;
        ctx.fillText(m.name, x + s + 6, y);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** The marker nearest a screen point (within reach), or null. */
  function markerAt(px, py) {
    let best = null;
    for (const v of visibleMarkers(frame())) {
      const d = Math.hypot(v.x - px, v.y - py);
      if (d <= 12 && (!best || d < best.d)) best = { id: v.marker.id, d };
    }
    return best?.id ?? null;
  }

  // --- motion -----------------------------------------------------------------------------

  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(now - last, 100);
    last = now;
    if (document.hidden) return;
    let moved = false;
    if (flight) {
      const t = Math.min(1, (now - flight.start) / flight.ms);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      const dLon = ((((flight.to.lon - flight.from.lon) % 360) + 540) % 360) - 180; // the short way round
      view = normalizeView({ lon: flight.from.lon + dLon * e, lat: flight.from.lat + (flight.to.lat - flight.from.lat) * e });
      if (t >= 1) flight = null;
      moved = true;
    } else if (!dragging && (Math.abs(velocity.lon) > 0.01 || Math.abs(velocity.lat) > 0.01)) {
      view = normalizeView({ lon: view.lon + velocity.lon, lat: view.lat + velocity.lat });
      velocity = { lon: velocity.lon * 0.93, lat: velocity.lat * 0.93 };
      moved = true;
    } else if (spinning && !dragging) {
      view = normalizeView({ lon: view.lon + (SPIN * dt) / 1000, lat: view.lat });
      moved = true;
    }
    if (moved && cursorPx) cursor = unproject(cursorPx.x, cursorPx.y, view, frame());
    draw(now);
    if (moved) emit();
  }

  // --- input ------------------------------------------------------------------------------

  const pointers = new Map();
  let dragging = false;
  let pinch = null;
  const local = (e) => {
    const box = canvas.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  let press = null; // where and when the last press began, to tell a click from a drag
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    press = pointers.size === 1 ? { ...local(e), at: performance.now(), moved: 0 } : null;
    flight = null;
    velocity = { lon: 0, lat: 0 };
    dragging = true;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    cursorPx = p;
    cursor = unproject(p.x, p.y, view, frame());
    const prev = pointers.get(e.pointerId);
    if (prev) {
      pointers.set(e.pointerId, p);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        setZoom(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
      } else if (pointers.size === 1) {
        if (press) press.moved = Math.max(press.moved, Math.hypot(p.x - press.x, p.y - press.y));
        // Dragging turns the globe under the pointer: degrees per pixel at the disc's scale.
        const { r } = frame();
        const dLon = (-(p.x - prev.x) / r) * DEG;
        const dLat = ((p.y - prev.y) / r) * DEG;
        view = normalizeView({ lon: view.lon + dLon, lat: view.lat + dLat });
        velocity = { lon: dLon, lat: dLat };
      }
    }
    emit();
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) dragging = false;
    // A short press that barely moved is a click: pick a marker, or the point under it.
    if (e.type === 'pointerup' && press && !pointers.size && press.moved < 5 && performance.now() - press.at < 500) {
      const p = local(e);
      velocity = { lon: 0, lat: 0 };
      const id = markerAt(p.x, p.y);
      onClick(id ? null : unproject(p.x, p.y, view, frame()), id);
    }
    if (!pointers.size) press = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => {
    if (pointers.size) return;
    cursor = null;
    cursorPx = null;
    emit();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(zoom * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => {
    const p = local(e);
    const target = unproject(p.x, p.y, view, frame());
    if (target) flyTo(target);
  });
  canvas.addEventListener('keydown', (e) => {
    const step = 10 / zoom;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) {
      e.preventDefault();
      flyTo({ lon: view.lon + moves[e.key][0], lat: view.lat + moves[e.key][1] }, 250);
    } else if (e.key === '+' || e.key === '=') setZoom(zoom * 1.25);
    else if (e.key === '-' || e.key === '_') setZoom(zoom / 1.25);
    else if (e.key === ' ') {
      e.preventDefault();
      toggleSpin();
    } else if (e.key === '0') reset();
  });

  function setZoom(z) {
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    if (cursorPx) cursor = unproject(cursorPx.x, cursorPx.y, view, frame());
    emit();
  }
  function flyTo(target, ms = 900) {
    flight = { from: { ...view }, to: normalizeView(target), start: performance.now(), ms: still() ? 1 : ms };
    velocity = { lon: 0, lat: 0 };
  }
  function toggleSpin(on = !spinning) {
    spinning = on;
    emit();
  }
  function reset() {
    flyTo(HOME);
    zoom = 1;
    emit();
  }

  const observer = new ResizeObserver(() => resize());
  observer.observe(canvas);
  resize();
  raf = requestAnimationFrame(tick);
  emit();

  return {
    setView: (v) => flyTo(v),
    zoomBy: (factor) => setZoom(zoom * factor),
    setZoom,
    getView: () => ({ view: { ...view }, zoom }),
    reset,
    toggleSpin,
    refreshColors,
    destroy() {
      cancelAnimationFrame(raf);
      observer.disconnect();
    },
  };
}
