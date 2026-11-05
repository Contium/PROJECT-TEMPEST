// Atlas (#/atlas): the Cartographer map system. Shown as a section of its own
// while the open project's map system is Cartographer (Project settings).
//
// #/atlas is the gallery of charts: the GM's own maps of lands, cities and
// dungeons, uploaded as images. #/atlas/<chart id> opens one: drag to pan,
// scroll to zoom. "+ Pin" (or Shift+click) marks a place; "+ Region" outlines an
// area corner by corner; a pin can lead to another chart (drill down from a land
// to a city to a dungeon). Fog of war covers the chart for players until the GM
// lifts it with the brush, or by revealing a region set to lift it.
//
// Players never get the map itself while fog is on: after every change the GM's
// browser bakes a players' copy with the fog painted in (fog.js), and that is
// all a push or the Codex ever carries.

import { el, toast, toastError, confirmDialog } from '../ui.js';
import { placesApi, uploadImage, imageUrl } from '../api.js';
import { createBoard, marker, svgEl } from './board.js';
import { CHART_KINDS, PIN_ICONS, MAX_REGION_POINTS, MAX_FOG_OPS, chartKind, pinIcon, playerChart, playerImageOf, chartCard, fogKey } from './chart-model.js';
import { boundsOf, colorOf } from './place-model.js';
import { drawFog, bakeChart } from './fog.js';
import { mapsEditor } from './attached-maps.js';
import { placeCardView } from './place-card.js';
import { push, revealAndPush, pushButton } from '../push/push.js';
import { visField, kindField, colorField, nameField, descField, editorForm, row, viewAsField, listTabs, searchBox, sideHead, seg, visBadge } from './place-kit.js';

const chartsApi = placesApi('charts');
const pinsApi = placesApi('pins');
const regionsApi = placesApi('regions');
const MAP_EDGE = 4096; // uploaded charts keep this much detail
const FOG_EDGE = 1400; // the GM's fog overlay, drawn at most this big

const SVG = 'http://www.w3.org/2000/svg';
const pinGlyph = (id) => {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'cm-icon');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', pinIcon(id).d);
  s.append(p);
  return s;
};

/**
 * Draw a chart's regions and pins on a board (space = the image in pixels).
 *   data  { width, height, pins, regions }   pins/regions in 0..1
 *   opts  { selected, hover, onPin(id), onRegion(id), pending: { pin } | { corners, cursor } }
 */
export function drawChart(board, data, opts = {}) {
  const { width: w, height: h } = data;
  const areas = svgEl('g', { class: 'ct-regions' });
  const out = [];
  const lit = (id) => opts.selected === id || opts.hover === id;
  for (const r of data.regions) {
    areas.append(svgEl('polygon', { points: r.points.map(([x, y]) => `${x * w},${y * h}`).join(' '), class: `gx-sector ct-region ${r.revealed === false ? 'is-hidden' : ''} ${lit(r.id) ? 'is-lit' : ''}`, style: `--c:${colorOf(r.color).hex}` }));
    const b = boundsOf(r.points);
    out.push({ node: marker({ id: r.id, glyph: '⬚', name: r.name, named: true, cls: `gx-sectormark ${r.revealed === false ? 'is-hidden' : ''} ${lit(r.id) ? 'is-current' : ''}`, title: `${r.name} (region${r.revealed === false ? ', hidden' : ''})`, onClick: opts.onRegion ? () => opts.onRegion(r.id) : null }), x: ((b.x0 + b.x1) / 2) * w, y: ((b.y0 + b.y1) / 2) * h });
  }
  const p = opts.pending;
  if (p?.corners?.length) {
    const pts = p.cursor ? [...p.corners, [p.cursor.x / w, p.cursor.y / h]] : p.corners;
    areas.append(svgEl('polyline', { points: pts.map(([x, y]) => `${x * w},${y * h}`).join(' '), class: 'gx-sector gx-sector--pending' }));
    p.corners.forEach(([x, y], i) => out.push({ node: marker({ id: `__corner${i}`, glyph: i === 0 ? '◆' : '•', name: '', cls: 'gx-corner', title: i === 0 ? 'Click to close the outline' : 'Corner', onClick: i === 0 ? opts.onCloseRegion : null }), x: x * w, y: y * h }));
  }
  for (const pin of data.pins) {
    const node = el('button', {
      type: 'button',
      class: `cm-marker ${pin.revealed === false ? 'is-hidden' : ''} ${lit(pin.id) ? 'is-current' : ''} ${opts.named ? 'scr-marker' : ''} ${pin.link ? 'has-link' : ''}`,
      'data-id': pin.id,
      ...(opts.drag ? { 'data-drag': pin.id } : {}),
      title: `${pin.name}${pin.revealed === false ? ' (hidden)' : ''}${pin.link ? ' · leads to another map' : ''}`,
      'aria-label': `${pin.name}, ${pinIcon(pin.icon).label}`,
      onClick: (e) => (e.stopPropagation(), opts.onPin?.(pin.id)),
    }, pinGlyph(pin.icon), el('span', { class: 'cm-marker__name' }, pin.name));
    out.push({ node, x: pin.x * w, y: pin.y * h });
  }
  if (p?.pin) out.push({ node: el('span', { class: 'cm-marker is-pending is-current' }, pinGlyph(p.pin.icon), el('span', { class: 'cm-marker__name' }, p.pin.name || 'New pin')), x: p.pin.x * w, y: p.pin.y * h });
  board.svg.replaceChildren(areas);
  board.setMarkers(out);
}

export async function mount(root, ctx) {
  return ctx.item ? chartView(root, ctx) : gallery(root, ctx);
}

// --- the gallery -------------------------------------------------------------------------------

async function gallery(root, { project }) {
  document.title = 'TEMPEST · Atlas';
  const grid = el('div', { class: 'ct-grid' }, el('p', { class: 'tp-deco' }, 'Unrolling the maps…'));
  const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true, onChange: (e) => add(e.target.files[0]) });
  const addBtn = el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary', onClick: () => fileInput.click() }, '+ New chart');
  root.replaceChildren(el('div', { class: 'ct-gallery' },
    el('div', { class: 'cv-bar' },
      el('p', { class: 'tp-muted ct-lead' }, 'Your own maps of lands, cities and dungeons. Upload one, then mark it with pins and regions, and lift the fog of war as your players explore.'),
      el('span', { class: 'app-row' }, addBtn, fileInput)),
    grid));

  let charts = [];
  let counts = new Map();
  try {
    const [list, pins] = await Promise.all([chartsApi.list(), pinsApi.list()]);
    charts = list;
    for (const p of pins) counts.set(p.chart, (counts.get(p.chart) ?? 0) + 1);
  } catch (err) {
    grid.replaceChildren(el('p', { class: 'app-error' }, err.message));
    return {};
  }

  async function add(file) {
    if (!file) return;
    addBtn.disabled = true;
    addBtn.textContent = 'Uploading…';
    try {
      const { id } = await uploadImage(file, { maxEdge: MAP_EDGE });
      const img = await loadImage(imageUrl(id));
      const made = await chartsApi.create({ name: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 80) || 'New chart', kind: 'land', image: id, width: img.naturalWidth, height: img.naturalHeight, revealed: false, fog: true });
      toast(`Added "${made.name}": it's hidden from players, under fog, until you reveal it`, { tone: 'success' });
      location.hash = `#/atlas/${made.id}`;
    } catch (err) {
      toastError(err);
      addBtn.disabled = false;
      addBtn.textContent = '+ New chart';
    }
  }

  function render() {
    grid.replaceChildren(...(charts.length
      ? charts.map((c) => el('a', { class: 'tp-frame tp-panel ct-card', href: `#/atlas/${c.id}` },
          el('img', { class: 'ct-card__img', src: imageUrl(c.image), alt: '', loading: 'lazy' }),
          el('span', { class: 'ct-card__text' },
            el('span', { class: 'tp-label' }, `${chartKind(c.kind).glyph} ${chartKind(c.kind).label}`),
            el('span', { class: 'tp-h3 ct-card__name' }, c.name),
            el('span', { class: 'app-row' }, visBadge(c.revealed), c.fog ? el('span', { class: 'tp-badge' }, 'Fog of war') : null, el('span', { class: 'tp-dim' }, `${counts.get(c.id) ?? 0} pins`)))))
      : [el('article', { class: 'tp-frame tp-panel app-placeholder' },
          el('div', { class: 'tp-panel__body' },
            el('p', { class: 'tp-h3' }, 'No charts yet'),
            el('p', { class: 'tp-muted' }, 'Upload a map image (PNG, JPEG or WebP, up to 10 MB) to start your atlas.')))]));
  }
  render();
  return {};
}

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Couldn\'t load that map image'));
  img.src = src;
});

// --- one chart ---------------------------------------------------------------------------------

async function chartView(root, { engine, item: chartId }) {
  const s = {
    chart: null,
    charts: [],
    pins: [],
    regions: [],
    viewAs: 'gm',
    tool: null, // 'pin' | 'region' | 'fog'
    brush: { clear: true, size: 0.04 },
    corners: [], // the region being drawn, 0..1
    redrawing: null,
    cursor: null,
    draft: null, // { kind: 'pin' | 'region' | 'chart', item }
    viewing: null,
    tab: 'pins',
    query: '',
    hover: null,
    baking: false,
  };
  const back = el('a', { class: 'app-link', href: '#/atlas' }, '← Atlas');
  root.replaceChildren(el('p', { class: 'tp-deco' }, 'Unrolling the map…'));
  try {
    [s.charts, s.pins, s.regions] = await Promise.all([chartsApi.list(), pinsApi.list({ chart: chartId }), regionsApi.list({ chart: chartId })]);
  } catch (err) {
    root.replaceChildren(el('p', { class: 'app-error' }, err.message));
    return {};
  }
  s.chart = s.charts.find((c) => c.id === chartId);
  if (!s.chart) {
    root.replaceChildren(el('article', { class: 'tp-frame tp-panel app-placeholder' },
      el('div', { class: 'tp-panel__body' }, el('p', { class: 'tp-h3' }, 'No such chart'), el('p', { class: 'tp-muted' }, 'It may have been deleted.'), back)));
    return {};
  }
  const W = () => s.chart.width;
  const H = () => s.chart.height;

  // --- the stage -------------------------------------------------------------------------------

  const img = el('img', { class: 'cm-img', alt: s.chart.name, draggable: 'false' });
  const fogCanvas = el('canvas', { class: 'ct-fog' });
  const covered = el('p', { class: 'ct-covered tp-label', hidden: true }, 'Players see only fog here until the players\' copy is drawn.');
  const readout = { pins: el('span', { class: 'wv-value tp-mono' }, '0'), fog: el('span', { class: 'wv-value' }, '—'), zoom: el('span', { class: 'wv-value tp-mono' }, '1.0×') };
  const toolBtn = (tool, label) => el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => setTool(s.tool === tool ? null : tool) }, label);
  const tools = { pin: toolBtn('pin', '+ Pin'), region: toolBtn('region', '+ Region'), fog: toolBtn('fog', 'Fog brush') };
  const brushHost = el('div', { class: 'ct-brush' });
  const viewHost = el('div');
  const hud = el('div', { class: 'wv-hud' },
    el('div', { class: 'wv-readouts' },
      el('div', { class: 'wv-readout' }, el('span', { class: 'tp-label' }, 'Pins'), readout.pins),
      el('div', { class: 'wv-readout' }, el('span', { class: 'tp-label' }, 'Fog'), readout.fog),
      el('div', { class: 'wv-readout' }, el('span', { class: 'tp-label' }, 'Zoom'), readout.zoom)),
    el('div', { class: 'wv-controls' },
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', 'aria-label': 'Zoom in', onClick: () => board.zoomBy(1.3) }, '+'),
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', 'aria-label': 'Zoom out', onClick: () => board.zoomBy(1 / 1.3) }, '−'),
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive', onClick: () => board.home() }, 'Fit')),
    el('div', { class: 'wv-controls pl-tools' }, tools.pin, tools.region, tools.fog),
    brushHost,
    el('div', { class: 'wv-controls' }, pushButton('Push view', pushView, { title: 'Show this chart on the player screen as you see it now: fog, revealed pins and regions' })),
    viewHost);
  const side = el('aside', { class: 'wv-side cm-side', 'aria-label': 'Pins and regions' });
  const help = el('p', { class: 'wv-help tp-dim' }, '+ Pin or Shift+click to mark a place · + Region, then its corners · Fog brush: drag to lift or lay fog · drag to pan · scroll to zoom');

  let fogTimer = 0;
  const board = createBoard({
    space: { x0: 0, y0: 0, x1: W(), y1: H() },
    zoom: [0.5, 12],
    label: `${s.chart.name}. + Pin or Shift+click marks a place; + Region then its corners outlines an area; the fog brush lifts or lays fog where you drag. Drag to pan, scroll to zoom; arrow keys, + and −, 0 to fit.`,
    home: () => null,
    reserve: () => side.offsetWidth + 24,
    onTap: (pt, e) => {
      if (s.viewAs !== 'gm' || !inside(pt)) return;
      if (s.tool === 'region') return addCorner(pt);
      if (s.tool === 'fog') return paint(pt, true);
      if (s.tool === 'pin' || e.shiftKey || s.moving) return placeAt(pt);
      if (s.draft && !s.draft.item.id) return;
      if (s.draft || s.viewing) closeEditor();
    },
    onDrag: (pt) => {
      if (s.viewAs !== 'gm' || s.tool !== 'fog') return null;
      paint(pt);
      return { move: (q) => paint(q), end: () => scheduleFogSave() };
    },
    onDoubleTap: () => {
      if (s.tool !== 'region') return s.tool === 'fog';
      finishRegion();
      return true;
    },
    onMove: (pt) => {
      if (s.tool === 'region' && s.corners.length) {
        s.cursor = pt;
        draw();
      }
    },
    onMarkerDrag: (id, pt) => {
      const p = s.pins.find((x) => x.id === id);
      if (!p || !inside(pt)) return;
      Object.assign(p, { x: pt.x / W(), y: pt.y / H() });
      if (s.draft?.item.id === id) Object.assign(s.draft.item, { x: p.x, y: p.y });
      draw();
    },
    onMarkerDrop: async (id) => {
      const p = s.pins.find((x) => x.id === id);
      if (!p) return;
      try {
        const saved = await pinsApi.save(p);
        s.pins = s.pins.map((x) => (x.id === saved.id ? saved : x));
      } catch (err) {
        toastError(err);
      }
    },
    onView: () => (readout.zoom.textContent = `${board.zoomLevel().toFixed(1)}×`),
  });
  board.raster.append(img, fogCanvas);
  const inside = (pt) => pt.x >= 0 && pt.y >= 0 && pt.x <= W() && pt.y <= H();

  const title = el('h2', { class: 'tp-panel__title' });
  const badges = el('span', { class: 'app-row' });
  root.replaceChildren(el('div', { class: 'cm' },
    el('div', { class: 'cv-bar' }, back, badges),
    el('section', { class: 'tp-frame tp-panel cm-panel', 'aria-label': `${s.chart.name} chart` },
      el('header', { class: 'tp-panel__head' }, title,
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => open('chart', s.chart) }, 'Chart details')),
      el('div', { class: 'cm-frame ct-frame' }, board.stage, hud, side, help, covered))));

  // --- fog ------------------------------------------------------------------------------------

  /** Redraw the GM's fog overlay (and, in the players' view, show what they get). */
  function drawFogLayer() {
    const players = s.viewAs === 'players';
    const shownImage = players ? playerImageOf(s.chart, s.regions) : s.chart.image;
    const src = shownImage ? imageUrl(shownImage) : '';
    if (img.getAttribute('src') !== src) {
      if (src) img.src = src;
      else img.removeAttribute('src');
    }
    img.hidden = !shownImage;
    // Over the map: the fog itself (GM: see-through), or nothing when players get a clean or baked copy.
    const fogShown = s.chart.fog && (!players || !shownImage);
    fogCanvas.hidden = !fogShown;
    covered.hidden = !(players && s.chart.fog && !shownImage);
    if (!fogShown) return;
    const scale = Math.min(1, FOG_EDGE / Math.max(W(), H()));
    const w = Math.max(1, Math.round(W() * scale));
    const h = Math.max(1, Math.round(H() * scale));
    if (fogCanvas.width !== w || fogCanvas.height !== h) Object.assign(fogCanvas, { width: w, height: h });
    drawFog(fogCanvas.getContext('2d'), w, h, s.chart, s.regions);
  }
  for (const node of [img, fogCanvas]) {
    node.style.width = `${W()}px`;
    node.style.height = `${H()}px`;
  }

  let fogFrame = 0;
  let lastPaint = null;
  function paint(pt, single = false) {
    const x = pt.x / W();
    const y = pt.y / H();
    if (x < -0.05 || y < -0.05 || x > 1.05 || y > 1.05) return;
    const r = s.brush.size;
    const side = Math.max(W(), H());
    const gap = r * side * 0.35; // dabs this far apart (image pixels) make a smooth stroke
    const dist = lastPaint && !single ? Math.hypot((x - lastPaint[0]) * W(), (y - lastPaint[1]) * H()) : Infinity;
    if (dist < gap) return;
    // A fast stroke: fill in the dabs between the last one and here.
    const steps = Number.isFinite(dist) ? Math.min(40, Math.ceil(dist / gap)) : 1;
    const from = Number.isFinite(dist) ? lastPaint : [x, y];
    const dabs = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = from[0] + (x - from[0]) * t;
      const py = from[1] + (y - from[1]) * t;
      dabs.push([s.brush.clear ? 1 : 0, Math.min(1, Math.max(0, px)), Math.min(1, Math.max(0, py)), r]);
    }
    if ((s.chart.ops?.length ?? 0) + dabs.length > MAX_FOG_OPS) return toast('That\'s as much fog painting as a chart can keep: use Clear all or Cover all and start again');
    lastPaint = [x, y];
    s.chart.ops = [...(s.chart.ops ?? []), ...dabs];
    fogFrame ||= requestAnimationFrame(() => ((fogFrame = 0), drawFogLayer(), renderReadouts()));
    if (single) scheduleFogSave();
  }
  let fogPending = false;
  function scheduleFogSave() {
    lastPaint = null;
    fogPending = true;
    clearTimeout(fogTimer);
    fogTimer = setTimeout(saveFog, 500);
  }
  async function saveFog() {
    fogPending = false;
    try {
      const saved = await chartsApi.save(s.chart);
      // Strokes painted while this was on its way stay.
      s.chart = { ...saved, ops: s.chart.ops.length > saved.ops.length ? s.chart.ops : saved.ops };
      await ensureBaked();
    } catch (err) {
      toastError(err);
    }
  }
  async function setFog(patch, note) {
    try {
      s.chart = await chartsApi.save({ ...s.chart, ...patch });
      if (note) toast(note);
      drawFogLayer();
      render();
      await ensureBaked();
    } catch (err) {
      toastError(err);
    }
  }

  /** Bake the players' copy again if the fog changed since the last one (and fog is on). */
  let bakeAgain = false;
  async function ensureBaked() {
    if (!s.chart.fog) return renderReadouts();
    const key = fogKey(s.chart, s.regions);
    if (s.chart.bakedKey === key && s.chart.playerImage) return renderReadouts();
    if (s.baking) {
      bakeAgain = true;
      return;
    }
    s.baking = true;
    renderReadouts();
    try {
      const source = await loadImage(imageUrl(s.chart.image));
      const blob = await bakeChart(s.chart, s.regions, source);
      const { id } = await uploadImage(blob, { maxEdge: MAP_EDGE });
      // Saved against the chart as it is now on the server, so a stroke made meanwhile isn't lost.
      const saved = await chartsApi.save({ ...s.chart, playerImage: id, bakedKey: key });
      s.chart = { ...saved, ops: s.chart.ops };
    } catch (err) {
      toastError(err);
    } finally {
      s.baking = false;
      renderReadouts();
      if (bakeAgain) {
        bakeAgain = false;
        ensureBaked();
      }
      if (s.viewAs === 'players') drawFogLayer();
    }
  }

  function renderBrush() {
    if (s.tool !== 'fog') return brushHost.replaceChildren();
    brushHost.replaceChildren(el('div', { class: 'wv-readouts ct-brush__panel' },
      seg('Brush', [[true, 'Lift fog'], [false, 'Lay fog']], s.brush.clear, (v) => ((s.brush.clear = v), renderBrush())),
      el('label', { class: 'ct-brush__size' }, el('span', { class: 'tp-label' }, 'Size'),
        el('input', { type: 'range', min: 0.01, max: 0.2, step: 0.005, value: s.brush.size, 'aria-label': 'Brush size', onInput: (e) => (s.brush.size = Number(e.target.value)) })),
      el('span', { class: 'wv-controls' },
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => wipe(true) }, 'Clear all'),
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => wipe(false) }, 'Cover all'))));
  }
  async function wipe(clear) {
    const ok = await confirmDialog({
      title: clear ? 'Lift all the fog?' : 'Cover the whole map?',
      body: clear ? 'The whole chart shows to players (once it\'s revealed). The fog stays on, so you can lay some back.' : 'Fog covers the whole chart again for players. Regions set to lift fog still show where revealed.',
      confirmLabel: clear ? 'Lift all' : 'Cover all',
    });
    if (!ok) return;
    setFog({ ops: clear ? [[1, 0.5, 0.5, 0.5], [1, 0.15, 0.15, 0.5], [1, 0.85, 0.15, 0.5], [1, 0.15, 0.85, 0.5], [1, 0.85, 0.85, 0.5]] : [] });
  }

  // --- what the board shows --------------------------------------------------------------------

  const player = () => playerChart(s.chart, s.pins, s.regions, s.charts);
  const shown = () => {
    if (s.viewAs !== 'players') return { width: W(), height: H(), pins: s.pins, regions: s.regions };
    const p = player();
    return { width: W(), height: H(), pins: p?.pins ?? [], regions: p?.regions ?? [] };
  };
  const pinOf = (id) => s.pins.find((x) => x.id === id);
  const regionOf = (id) => s.regions.find((x) => x.id === id);

  function draw() {
    const data = shown();
    if (s.draft?.item.id && s.draft.kind !== 'chart') {
      const d = s.draft.item;
      const key = s.draft.kind === 'pin' ? 'pins' : 'regions';
      data[key] = data[key].map((x) => (x.id === d.id ? { ...x, ...d } : x));
    }
    if (s.draft?.kind === 'region' && !s.draft.item.id) data.regions = [...data.regions, { ...s.draft.item, id: '__newregion', name: s.draft.item.name || 'New region' }];
    drawChart(board, data, {
      selected: s.draft?.item.id ?? s.viewing ?? (s.draft?.kind === 'region' ? '__newregion' : null),
      hover: s.hover,
      drag: s.viewAs === 'gm' && !s.tool,
      onPin: (id) => (s.tool === 'region' ? addCorner({ x: pinOf(id).x * W(), y: pinOf(id).y * H() }) : open('pin', pinOf(id))),
      onRegion: (id) => id !== '__newregion' && open('region', regionOf(id)),
      onCloseRegion: finishRegion,
      pending: s.draft?.kind === 'pin' && !s.draft.item.id ? { pin: s.draft.item } : s.corners.length ? { corners: s.corners, cursor: s.cursor } : null,
    });
  }
  function renderReadouts() {
    const data = shown();
    readout.pins.textContent = s.viewAs === 'players' ? `${data.pins.length} known` : `${s.pins.length} (${s.pins.filter((p) => p.revealed).length} revealed)`;
    readout.fog.textContent = !s.chart.fog ? 'Off' : s.baking ? 'Drawing players\' copy…' : playerImageOf(s.chart, s.regions) ? 'On · players\' copy ready' : 'On · players\' copy out of date';
    title.textContent = `${chartKind(s.chart.kind).glyph} ${s.chart.name}`;
    badges.replaceChildren(el('span', { class: 'tp-badge tp-badge--interactive' }, `${chartKind(s.chart.kind).label} map`), visBadge(s.chart.revealed), s.chart.fog ? el('span', { class: 'tp-badge' }, 'Fog of war') : null);
  }

  // --- tools -----------------------------------------------------------------------------------

  function setTool(tool) {
    s.tool = s.viewAs === 'gm' ? tool : null;
    s.corners = [];
    s.cursor = null;
    s.moving = false;
    if (tool === 'fog' && !s.chart.fog) setFog({ fog: true }, 'Fog of war is on for this chart');
    render();
  }
  function placeAt(pt) {
    const x = pt.x / W();
    const y = pt.y / H();
    if (s.moving && s.draft?.kind === 'pin') {
      Object.assign(s.draft.item, { x, y });
      s.moving = false;
      return render();
    }
    s.viewing = null;
    const keep = s.draft?.kind === 'pin' && !s.draft.item.id ? s.draft.item : null;
    s.draft = { kind: 'pin', item: keep ? { ...keep, x, y } : { chart: s.chart.id, name: '', icon: 'pin', description: '', revealed: false, x, y, link: null, maps: [] } };
    s.tool = null;
    render();
    side.querySelector('[name="name"]')?.focus();
  }
  function addCorner(pt) {
    if (s.corners.length >= MAX_REGION_POINTS) return toast(`A region can have up to ${MAX_REGION_POINTS} corners`);
    s.corners = [...s.corners, [pt.x / W(), pt.y / H()]];
    render();
  }
  function finishRegion() {
    if (s.corners.length < 3) return toast('A region needs at least three corners');
    s.draft = { kind: 'region', item: s.redrawing ? { ...s.redrawing, points: s.corners } : { chart: s.chart.id, name: '', color: 'amber', points: s.corners, lift: true, description: '', revealed: false, maps: [] } };
    s.redrawing = null;
    s.tool = null;
    s.corners = [];
    s.cursor = null;
    render();
    side.querySelector('[name="name"]')?.focus();
  }

  // --- editing ---------------------------------------------------------------------------------

  const API = { pin: pinsApi, region: regionsApi, chart: chartsApi };
  const LIST = { pin: 'pins', region: 'regions' };
  function open(kind, item) {
    if (!item) return;
    if (s.viewAs === 'players') return view(item.id);
    s.draft = { kind, item: { maps: [], ...structuredClone(item) } };
    s.viewing = null;
    s.tool = null;
    s.corners = [];
    s.moving = false;
    render();
  }
  function view(id) {
    s.viewing = id;
    s.draft = null;
    render();
  }
  function closeEditor() {
    s.draft = null;
    s.viewing = null;
    s.moving = false;
    render();
  }
  function store(kind, saved) {
    if (kind === 'chart') {
      s.chart = { ...saved };
      s.charts = s.charts.map((c) => (c.id === saved.id ? saved : c));
      return;
    }
    const key = LIST[kind];
    s[key] = s[key].some((x) => x.id === saved.id) ? s[key].map((x) => (x.id === saved.id ? saved : x)) : [...s[key], saved].sort((a, b) => a.name.localeCompare(b.name));
  }
  async function saveDraft() {
    const { kind, item } = s.draft;
    try {
      // The chart's details never carry the fog: that's saved as it's painted.
      const body = kind === 'chart' ? { ...s.chart, ...item, ops: s.chart.ops, playerImage: s.chart.playerImage, bakedKey: s.chart.bakedKey } : item;
      const saved = item.id ? await API[kind].save(body) : await API[kind].create(body);
      store(kind, saved);
      toast(item.id ? `Saved "${saved.name}"` : `Added "${saved.name}"`, { tone: 'success' });
      s.draft = null;
      render();
      drawFogLayer();
      ensureBaked();
    } catch (err) {
      toastError(err);
    }
  }
  async function setRevealed(kind, item, revealed) {
    const saved = await API[kind].save({ ...item, revealed });
    store(kind, saved);
    if (s.draft?.item.id === saved.id) s.draft.item.revealed = saved.revealed;
    drawFogLayer();
    ensureBaked();
    return saved;
  }
  const toggle = (kind) => async (item) => {
    try {
      const saved = await setRevealed(kind, item, !item.revealed);
      toast(saved.revealed ? `"${saved.name}" is revealed to players` : `"${saved.name}" is hidden from players`);
      render();
    } catch (err) {
      toastError(err);
    }
  };
  async function remove(kind, item) {
    const body = kind === 'chart'
      ? `This chart will be removed for good, with its ${s.pins.length} pin${s.pins.length === 1 ? '' : 's'} and ${s.regions.length} region${s.regions.length === 1 ? '' : 's'}. Pins on other charts that lead here stop doing so.`
      : `This ${kind} will be removed from the chart for good.`;
    if (!(await confirmDialog({ title: `Delete "${item.name}"?`, body, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await API[kind].remove(item.id);
      toast(`Deleted "${item.name}"`);
      if (kind === 'chart') return void (location.hash = '#/atlas');
      s[LIST[kind]] = s[LIST[kind]].filter((x) => x.id !== item.id);
      s.draft = null;
      render();
      drawFogLayer();
      ensureBaked();
    } catch (err) {
      toastError(err);
    }
  }

  // --- pushing ---------------------------------------------------------------------------------

  async function pushView() {
    if (!s.chart.revealed) {
      const ok = await confirmDialog({ title: `Reveal "${s.chart.name}"?`, body: 'This chart is hidden from players. Pushing it reveals it to them first (under its fog of war).', confirmLabel: 'Reveal & push' });
      if (!ok) return;
      try {
        await setRevealed('chart', s.chart, true);
        render();
      } catch (err) {
        return toastError(err);
      }
    }
    await ensureBaked();
    const b = board.visibleBox();
    const focus = s.draft && s.draft.kind !== 'chart' ? s.draft.item.id : s.viewing;
    push({ mode: 'chart', id: s.chart.id, box: { x0: b.x0 / W(), y0: b.y0 / H(), x1: b.x1 / W(), y1: b.y1 / H() }, focus: focus ?? null });
  }
  function pushPlace(kind, item) {
    if (kind !== 'chart' && !s.chart.revealed) return toastError(new Error(`Players can't see anything on this chart until it's revealed: reveal "${s.chart.name}" first (Chart details)`));
    return revealAndPush(item, async () => {
      await setRevealed(kind, item, true);
      render();
    }, { mode: 'place', id: item.id });
  }
  const pushMap = (d) => (m) => push({ mode: 'handout', image: m.image, caption: m.caption || d.name });

  // --- side panel ------------------------------------------------------------------------------

  const actions = (kind, d) => (d.id ? [
    el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => remove(kind, kind === 'chart' ? s.chart : (kind === 'pin' ? pinOf : regionOf)(d.id)) }, kind === 'chart' ? 'Delete chart' : 'Delete'),
    pushButton('Push', () => pushPlace(kind, kind === 'chart' ? s.chart : (kind === 'pin' ? pinOf : regionOf)(d.id)), { title: 'Show this (as saved) on the player screen, as a card', ghost: true }),
  ] : []);

  function chartEditor(d) {
    return editorForm({
      title: 'Chart details',
      close: closeEditor,
      save: saveDraft,
      fields: [
        nameField(d, { placeholder: 'e.g. The Sunken Keep' }),
        kindField('Kind', CHART_KINDS, d, render),
        descField(d, 'What players know of this place… (optional)'),
        visField(d, render, { shownNote: 'Players can see this chart, under its fog of war.', hiddenNote: 'Only you can see this chart (and everything on it) until you reveal it.' }),
        el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Fog of war'),
          seg('Fog of war', [[true, 'On'], [false, 'Off']], d.fog, (v) => ((d.fog = v), render())),
          el('span', { class: 'tp-dim wv-note' }, d.fog ? 'Players see only what you lift with the fog brush or by revealing regions.' : 'Players see the whole map.')),
        el('p', { class: 'tp-dim wv-note' }, `${W()} × ${H()} px`),
        mapsEditor(d.maps, render, { push: pushMap(d) }),
      ],
      left: actions('chart', d),
    });
  }

  function pinEditor(d) {
    const isNew = !d.id;
    const others = s.charts.filter((c) => c.id !== s.chart.id);
    const linked = s.charts.find((c) => c.id === d.link);
    return editorForm({
      title: isNew ? 'New pin' : 'Edit pin',
      close: closeEditor,
      save: saveDraft,
      isNew,
      saveLabel: isNew ? 'Place pin' : 'Save',
      fields: [
        nameField(d, { placeholder: 'e.g. The Drowned Rat', onInput: draw }),
        el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, `Icon: ${pinIcon(d.icon).label}`),
          el('div', { class: 'cm-icons', role: 'radiogroup', 'aria-label': 'Icon' },
            PIN_ICONS.map((ic) => el('button', {
              type: 'button', role: 'radio', class: `cm-icon-pick ${d.icon === ic.id ? 'is-on' : ''}`, 'aria-checked': String(d.icon === ic.id), title: ic.label, 'aria-label': ic.label,
              onClick: () => ((d.icon = ic.id), render()),
            }, pinGlyph(ic.id))))),
        descField(d, 'What it is, who is there… (optional)'),
        visField(d, render, {
          shownNote: s.chart.revealed ? 'Players can see this pin.' : 'Revealed, but players see it only once the chart is revealed.',
          hiddenNote: 'Only you can see this pin until you reveal it.',
        }),
        el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Leads to'),
          el('select', { class: 'tp-select', onChange: (e) => ((d.link = e.target.value || null), render()) },
            el('option', { value: '', selected: !d.link }, 'Nowhere (just a place)'),
            others.map((c) => el('option', { value: c.id, selected: d.link === c.id }, `${chartKind(c.kind).glyph} ${c.name}${c.revealed ? '' : ' (hidden)'}`))),
          linked ? el('a', { class: 'app-link', href: `#/atlas/${linked.id}` }, `Open ${linked.name} →`) : el('span', { class: 'tp-dim wv-note' }, others.length ? 'A city on a land map, a dungeon in a city…' : 'Add more charts to the Atlas to link them.')),
        el('div', { class: 'wv-where' },
          el('button', { type: 'button', class: `tp-frame tp-btn tp-btn--sm ${s.moving ? 'tp-btn--interactive' : 'tp-btn--ghost'}`, onClick: () => ((s.moving = !s.moving), render()) }, s.moving ? 'Click the map…' : 'Move'),
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => board.center(d.x * W(), d.y * H(), 3) }, 'Centre on it')),
        mapsEditor(d.maps, render, { push: pushMap(d) }),
      ],
      left: actions('pin', d),
    });
  }

  function regionEditor(d) {
    const isNew = !d.id;
    return editorForm({
      title: isNew ? 'New region' : 'Edit region',
      close: closeEditor,
      save: saveDraft,
      isNew,
      saveLabel: isNew ? 'Add region' : 'Save',
      fields: [
        nameField(d, { placeholder: 'e.g. The Flooded Halls', onInput: draw }),
        colorField(d, render),
        descField(d, 'What players know of it… (optional)'),
        visField(d, render, {
          shownNote: s.chart.revealed ? 'Players can see this region.' : 'Revealed, but players see it only once the chart is revealed.',
          hiddenNote: 'Only you can see this region until you reveal it.',
        }),
        el('label', { class: 'pl-check' },
          el('input', { type: 'checkbox', checked: d.lift, onChange: (e) => ((d.lift = e.target.checked), render()) }),
          el('span', {}, 'Lifts the fog', el('span', { class: 'tp-dim wv-note' }, ' (once revealed, players see the map inside it)'))),
        el('div', { class: 'wv-where' },
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => zoomTo(d) }, 'Zoom to'),
          isNew ? null : el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => ((s.redrawing = structuredClone(d)), (s.draft = null), (s.tool = 'region'), (s.corners = []), render()) }, 'Redraw outline')),
        mapsEditor(d.maps, render, { push: pushMap(d) }),
      ],
      left: actions('region', d),
    });
  }
  const zoomTo = (r) => {
    const b = boundsOf(r.points);
    board.fit({ x0: b.x0 * W(), y0: b.y0 * H(), x1: b.x1 * W(), y1: b.y1 * H() });
    board.touch();
  };

  function playersCard(id) {
    const card = chartCard(id, s.charts, s.pins, s.regions);
    if (!card) return listPanel();
    const pin = pinOf(id);
    const linked = pin?.link && s.charts.find((c) => c.id === pin.link && c.revealed);
    return el('div', { class: 'wv-editor' },
      sideHead(card.name, closeEditor),
      placeCardView(card, { panel: false, push: pushMap(card) }),
      linked ? el('a', { class: 'tp-frame tp-btn tp-btn--primary wv-citymap', href: `#/atlas/${linked.id}` }, `Open ${linked.name}`) : null);
  }

  function listPanel() {
    const gm = s.viewAs === 'gm';
    const data = shown();
    const q = s.query.trim().toLowerCase();
    const match = (x) => !q || x.name.toLowerCase().includes(q);
    const pins = (gm ? s.pins : s.pins.filter((p) => data.pins.some((x) => x.id === p.id))).filter(match);
    const regions = (gm ? s.regions : s.regions.filter((r) => data.regions.some((x) => x.id === r.id))).filter(match);
    const tabs = listTabs([['pins', `Pins (${gm ? s.pins.length : data.pins.length})`], ['regions', `Regions (${gm ? s.regions.length : data.regions.length})`]], s.tab, (t) => ((s.tab = t), render()));
    const search = searchBox(s.query, 'Find…', (v) => {
      s.query = v;
      const next = listPanel();
      side.replaceChildren(next);
      const box = next.querySelector('input[type="search"]');
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    });
    const linkName = (p) => s.charts.find((c) => c.id === p.link)?.name;
    const body = s.tab === 'pins'
      ? (pins.length
          ? el('ul', { class: 'wv-items' }, pins.map((p) => row({ item: p, g: '⌖', sub: `${pinIcon(p.icon).label}${linkName(p) ? ` · to ${linkName(p)}` : ''}`, onPick: () => (board.center(p.x * W(), p.y * H()), open('pin', p)), toggle: toggle('pin'), gm, hover: setHover })))
          : el('p', { class: 'tp-dim wv-note' }, s.pins.length ? 'Nothing matches.' : gm ? 'No pins yet. Use “+ Pin” or Shift+click the map.' : 'No pins revealed yet.'))
      : (regions.length
          ? el('ul', { class: 'wv-items' }, regions.map((r) => row({ item: r, g: '⬚', sub: `Region${r.lift ? ' · lifts the fog' : ''}`, onPick: () => (zoomTo(r), open('region', r)), toggle: toggle('region'), gm, hover: setHover })))
          : el('p', { class: 'tp-dim wv-note' }, s.regions.length ? 'Nothing matches.' : gm ? 'No regions yet. Use “+ Region”, click its corners, then click the first corner (or double-click) to close it.' : 'No regions revealed yet.'));
    const note = gm
      ? (s.chart.revealed ? 'Players see revealed pins and regions, and the map where the fog is lifted.' : 'This chart is hidden: players see nothing of it until you reveal it (Chart details).')
      : (s.chart.revealed ? `Showing what players see: ${data.pins.length} of ${s.pins.length} pins.` : 'Players can\'t see this chart: it\'s hidden.');
    return el('div', { class: 'wv-list' }, tabs, el('p', { class: 'tp-dim wv-note' }, note), search, body);
  }

  function setHover(id) {
    if (s.hover === id) return;
    s.hover = id;
    draw();
  }

  function renderHud() {
    const gm = s.viewAs === 'gm';
    const labels = {
      pin: s.tool === 'pin' ? 'Click the map… (Esc)' : '+ Pin',
      region: s.tool === 'region' ? (s.corners.length >= 3 ? `${s.corners.length} corners: click the first to close` : 'Click the corners… (Esc)') : '+ Region',
      fog: s.tool === 'fog' ? 'Fog brush: on (Esc)' : 'Fog brush',
    };
    for (const [tool, b] of Object.entries(tools)) {
      b.hidden = !gm;
      b.textContent = labels[tool];
      b.classList.toggle('tp-btn--interactive', s.tool === tool);
      b.setAttribute('aria-pressed', String(s.tool === tool));
    }
    renderBrush();
    board.stage.classList.toggle('is-placing', s.tool === 'pin' || s.tool === 'region' || s.moving);
    board.stage.classList.toggle('is-painting', s.tool === 'fog');
    board.stage.style.setProperty('--ct-brush', `${s.brush.size * Math.max(W(), H()) * (board.view?.scale ?? 1) * 2}px`);
    viewHost.replaceChildren(viewAsField(s.viewAs, (v) => {
      s.viewAs = v;
      s.draft = null;
      s.viewing = null;
      setTool(null);
      drawFogLayer();
    }));
  }

  function render() {
    renderHud();
    draw();
    renderReadouts();
    const d = s.draft && s.viewAs === 'gm' ? s.draft : null;
    const editors = { pin: pinEditor, region: regionEditor, chart: chartEditor };
    const key = d ? `edit:${d.kind}:${d.item.id ?? 'new'}` : s.viewing ? `card:${s.viewing}` : `list:${s.tab}`;
    const keep = side.dataset.panel === key ? side.scrollTop : 0;
    side.replaceChildren(d ? editors[d.kind](d.item) : s.viewing ? playersCard(s.viewing) : listPanel());
    side.dataset.panel = key;
    side.scrollTop = keep;
    board.stage.parentElement?.classList.toggle('is-players', s.viewAs === 'players');
  }

  const onKey = (e) => {
    if (document.querySelector('dialog[open]') || e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'Enter' && s.tool === 'region') return finishRegion();
    if (e.key === 'Backspace' && s.tool === 'region' && s.corners.length) {
      s.corners = s.corners.slice(0, -1);
      return render();
    }
    if (e.key !== 'Escape') return;
    if (s.tool || s.moving) {
      s.redrawing = null;
      setTool(null);
    } else if (s.draft || s.viewing) closeEditor();
  };
  document.addEventListener('keydown', onKey);
  const brushSize = board.onChange(() => board.stage.style.setProperty('--ct-brush', `${s.brush.size * Math.max(W(), H()) * board.view.scale * 2}px`));
  const onTheme = () => requestAnimationFrame(() => board.redraw());
  engine?.addEventListener('change', onTheme);
  document.title = `TEMPEST · ${s.chart.name}`;

  drawFogLayer();
  render();
  board.home();
  ensureBaked(); // a copy out of date (say, a region revealed elsewhere) is drawn again now

  return {
    unmount() {
      clearTimeout(fogTimer);
      if (fogPending) saveFog(); // strokes not saved yet still are (and baked)
      brushSize();
      board.destroy();
      document.removeEventListener('keydown', onKey);
      engine?.removeEventListener('change', onTheme);
    },
  };
}
