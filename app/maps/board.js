// The pan-and-zoom board the Planar, Cartographer and Galactic map systems draw
// on, in the GM window and on the player screen.
//
// Three layers over one stage, all in the same world coordinates:
//   raster   pictures (a chart's map, its fog), an HTML layer moved with a CSS transform
//   svg      lines and outlines; its viewBox follows the view, so strokes stay crisp
//   markers  HTML markers (names, glyphs), placed at their screen positions
// The view is { x, y, scale }: world point (wx, wy) sits at screen (x + wx·scale, y + wy·scale).
//
// createBoard(opts) → board
//   space        { x0, y0, x1, y1 }: the world (the raster layer covers it; panning keeps some of it on screen)
//   home()       the box "Fit" frames (what's on the board), or null for the whole space
//   reserve()    screen pixels on the right that a side panel covers (Fit frames the rest)
//   zoom         [min, max] scale, as multiples of the scale that fits the whole space
//   interactive  false: no panning or zooming (the player screen); the board keeps `home()` framed
//   onTap(pt, event)               a click on the board (not on a marker), pt in world units
//   onMove(pt | null, event)       the pointer moved over the board (null: it left)
//   onDrag(pt, event)              a press on the board; return { move(pt), end(pt) } to take the drag
//                                  (painting, drawing) instead of panning
//   onDoubleTap(pt, event)         return true to keep the double-click from zooming
//   onView(view)                   after every change of view
// Markers with data-drag="<id>" can be dragged: opts.onMarkerDrag(id, pt) while moving,
// opts.onMarkerDrop(id, pt) on release (a press without movement is an ordinary click).

import { el } from '../ui.js';
import { fitBox, zoomAt } from './city-map-model.js';

const SVG = 'http://www.w3.org/2000/svg';
export const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  return node;
};
const widthOf = (b) => Math.max(b.x1 - b.x0, 1e-9);
const heightOf = (b) => Math.max(b.y1 - b.y0, 1e-9);

export function createBoard(opts) {
  let space = opts.space;
  const [minZoom, maxZoom] = opts.zoom ?? [0.5, 12];
  const interactive = opts.interactive !== false;
  const raster = el('div', { class: 'cm-world bd-raster' });
  const svg = svgEl('svg', { class: 'bd-svg', preserveAspectRatio: 'none' });
  const markers = el('div', { class: 'cm-markers bd-markers' });
  const tip = el('div', { class: 'cm-tip', role: 'status', 'aria-live': 'polite', hidden: true });
  const stage = el('div', { class: `cm-stage bd-stage ${opts.className ?? ''} ${interactive ? '' : 'is-static'}`, tabindex: interactive ? 0 : -1, 'aria-label': opts.label ?? 'Map' }, raster, svg, markers, tip);
  const listeners = new Set();
  let view = null;
  let touched = false; // until the GM pans or zooms, a resize re-frames
  let placed = []; // [{ node, x, y }]

  const viewport = () => ({ width: stage.clientWidth || 1, height: stage.clientHeight || 1 });
  const fitScale = () => fitBox(space, viewport(), 0).scale;
  const clampScale = (s) => Math.min(Math.max(s, fitScale() * minZoom), fitScale() * maxZoom);

  function sizeRaster() {
    raster.style.width = `${widthOf(space)}px`;
    raster.style.height = `${heightOf(space)}px`;
  }
  function apply() {
    if (!view) return;
    const { width, height } = viewport();
    if (interactive) {
      // Keep some of the world on screen.
      const m = 60;
      const left = view.x + space.x0 * view.scale;
      const right = view.x + space.x1 * view.scale;
      const top = view.y + space.y0 * view.scale;
      const bottom = view.y + space.y1 * view.scale;
      if (right < m) view.x += m - right;
      if (left > width - m) view.x -= left - (width - m);
      if (bottom < m) view.y += m - bottom;
      if (top > height - m) view.y -= top - (height - m);
    }
    const { x, y, scale } = view;
    raster.style.transform = `translate(${x + space.x0 * scale}px, ${y + space.y0 * scale}px) scale(${scale})`;
    svg.setAttribute('viewBox', `${-x / scale} ${-y / scale} ${width / scale} ${height / scale}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    for (const m of placed) m.node.style.transform = `translate(${x + m.x * scale}px, ${y + m.y * scale}px)`;
    stage.style.setProperty('--bd-scale', scale);
    for (const fn of listeners) fn(view);
    opts.onView?.(view);
  }
  let frameReq = 0;
  const later = () => (frameReq ||= requestAnimationFrame(() => ((frameReq = 0), apply())));

  /** Frame a box (world units), with padding in screen pixels. */
  function fit(box = opts.home?.() ?? space, pad = 40) {
    const b = box && widthOf(box) > 1e-6 ? box : space;
    // A single point (or a tiny box) gets some room around it.
    const min = widthOf(space) / 200;
    const grown = widthOf(b) < min && heightOf(b) < min
      ? { x0: (b.x0 + b.x1) / 2 - min / 2, x1: (b.x0 + b.x1) / 2 + min / 2, y0: (b.y0 + b.y1) / 2 - min / 2, y1: (b.y0 + b.y1) / 2 + min / 2 }
      : b;
    // The part of the stage a side panel doesn't cover (on wide screens).
    const { width: full, height } = viewport();
    const width = full > 760 ? full - Math.min(opts.reserve?.() ?? 0, full / 2) : full;
    const v = fitBox(grown, { width, height }, pad);
    const scale = clampScale(v.scale);
    view = { scale, x: width / 2 - ((grown.x0 + grown.x1) / 2) * scale, y: height / 2 - ((grown.y0 + grown.y1) / 2) * scale };
    apply();
  }
  const home = () => ((touched = false), fit());
  function zoomBy(f, sx = viewport().width / 2, sy = viewport().height / 2) {
    if (!view) return;
    const scale = clampScale(view.scale * f);
    view = zoomAt(view, scale / view.scale, sx, sy);
    touched = true;
    apply();
  }
  /** Bring a world point to the middle of the screen, zooming in to at least `zoom` × the fit scale. */
  function center(x, y, zoom = 0) {
    if (!view) return;
    const { width, height } = viewport();
    const scale = clampScale(Math.max(view.scale, fitScale() * zoom));
    view = { scale, x: width / 2 - x * scale, y: height / 2 - y * scale };
    touched = true;
    apply();
  }
  const toWorld = (clientX, clientY) => {
    const r = stage.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.scale, y: (clientY - r.top - view.y) / view.scale };
  };
  /** What's on screen now, in world units. */
  const visibleBox = () => {
    const { width, height } = viewport();
    return { x0: -view.x / view.scale, y0: -view.y / view.scale, x1: (width - view.x) / view.scale, y1: (height - view.y) / view.scale };
  };

  /** Show these markers: [{ node, x, y }] (world units). */
  function setMarkers(list) {
    placed = list;
    markers.replaceChildren(...list.map((m) => m.node));
    apply();
  }

  function showTip(text, e) {
    if (!text) return (tip.hidden = true);
    const r = stage.getBoundingClientRect();
    tip.textContent = text;
    tip.hidden = false;
    tip.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 14}px)`;
  }

  // --- pointer, wheel and keys ------------------------------------------------------------------

  let drag = null; // { id, sx, sy, vx, vy, moved, marker?, tool? }
  if (interactive) {
    stage.addEventListener('dragstart', (e) => e.preventDefault());
    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !view) return;
      const markerNode = e.target.closest?.('[data-drag]');
      const pt = toWorld(e.clientX, e.clientY);
      // A marker that isn't draggable is a plain button: let it take its own click.
      if (!markerNode && e.target.closest?.('.cm-marker, button, a')) return;
      e.preventDefault();
      stage.focus({ preventScroll: true });
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, marker: markerNode?.dataset.drag ?? null, node: markerNode };
      if (!drag.marker) drag.tool = opts.onDrag?.(pt, e) ?? null;
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      const pt = view ? toWorld(e.clientX, e.clientY) : null;
      if (drag && drag.id === e.pointerId) {
        const dx = e.clientX - drag.sx;
        const dy = e.clientY - drag.sy;
        if (!drag.moved && Math.hypot(dx, dy) > 4) {
          drag.moved = true;
          stage.classList.add('is-dragging');
          tip.hidden = true;
        }
        if (drag.moved) {
          if (drag.tool) drag.tool.move?.(pt, e);
          else if (drag.marker) opts.onMarkerDrag?.(drag.marker, pt, e);
          else {
            touched = true;
            view = { ...view, x: drag.vx + dx, y: drag.vy + dy };
            later();
          }
        }
        return;
      }
      opts.onMove?.(pt, e);
    });
    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag;
      drag = null;
      stage.classList.remove('is-dragging');
      const pt = toWorld(e.clientX, e.clientY);
      if (d.tool) return d.tool.end?.(pt, e, d.moved);
      if (d.marker) {
        if (d.moved) opts.onMarkerDrop?.(d.marker, pt, e);
        else if (e.type === 'pointerup') d.node.click();
        return;
      }
      if (!d.moved && e.type === 'pointerup') opts.onTap?.(pt, e);
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('pointerleave', () => {
      if (!drag) {
        tip.hidden = true;
        opts.onMove?.(null);
      }
    });
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    stage.addEventListener('dblclick', (e) => {
      if (e.target.closest?.('.cm-marker') || opts.onDoubleTap?.(toWorld(e.clientX, e.clientY), e)) return;
      const r = stage.getBoundingClientRect();
      zoomBy(2, e.clientX - r.left, e.clientY - r.top);
    });
    stage.addEventListener('keydown', (e) => {
      if (e.target !== stage) return;
      const pan = 60;
      const moves = { ArrowLeft: [pan, 0], ArrowRight: [-pan, 0], ArrowUp: [0, pan], ArrowDown: [0, -pan] };
      if (moves[e.key]) {
        touched = true;
        view = { ...view, x: view.x + moves[e.key][0], y: view.y + moves[e.key][1] };
        apply();
      } else if (e.key === '+' || e.key === '=') zoomBy(1.3);
      else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.3);
      else if (e.key === '0') home();
      else return;
      e.preventDefault();
    });
  }

  // Frame once the stage has a size; keep it framed (or in bounds) as the window changes.
  const resize = new ResizeObserver(() => (view && touched ? apply() : fit(opts.frame?.() ?? undefined)));
  resize.observe(stage);
  sizeRaster();

  return {
    stage, raster, svg, markers,
    get view() { return view; },
    fit, home, zoomBy, center, toWorld, visibleBox, setMarkers, showTip,
    /** The zoom as a multiple of the scale that fits the whole space (a chart: the whole map). */
    zoomLevel: () => (view ? view.scale / fitScale() : 1),
    /** Keep a view the GM chose: the next resizes keep it rather than re-framing. */
    touch: () => (touched = true),
    setSpace(next) {
      space = next;
      sizeRaster();
      apply();
    },
    redraw: apply,
    onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    destroy() {
      resize.disconnect();
      cancelAnimationFrame(frameReq);
      listeners.clear();
    },
  };
}

/** A marker: a glyph chip with a name beside it (shown on hover, or always with `named`). */
export function marker({ id, glyph, name, cls = '', title, drag = false, named = false, onClick }) {
  return el('button', {
    type: 'button',
    class: `cm-marker bd-marker ${named ? 'is-named' : ''} ${cls}`,
    'data-id': id,
    ...(drag ? { 'data-drag': id } : {}),
    title: title ?? name,
    'aria-label': title ?? name,
    onClick: (e) => (e.stopPropagation(), onClick?.(e)),
  }, el('span', { class: 'bd-glyph', 'aria-hidden': 'true' }, glyph), name ? el('span', { class: 'cm-marker__name' }, name) : null);
}
