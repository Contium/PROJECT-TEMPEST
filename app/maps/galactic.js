// Star Map (#/starmap): the Galactic map system. Shown as a section of its own
// while the open project's map system is Galactic (Project settings).
//
// A top-down star map: star systems (stars, planets, stations, settlements,
// anomalies, nebulae), the lanes between them (hyperlanes, jump routes,
// wormholes) and named sectors drawn as tinted outlines. "+ System" (or
// Shift+click) places a system, "+ Lane" then two systems joins them, "+ Sector"
// draws an outline corner by corner. Drag a system to move it. Everything is
// hidden from players until revealed; a lane shows to players once both its ends
// are revealed too. Night City is built in (Project settings): it can be moved,
// revealed or hidden here, and opens its City Map (#/starmap/nightcity).

import { el, toast, toastError, confirmDialog } from '../ui.js';
import { placesApi } from '../api.js';
import { createBoard, marker, svgEl } from './board.js';
import { STAR_KINDS, LANE_KINDS, GALAXY, MAX_SECTOR_POINTS, starKind, laneKind, playerStarmap, galacticCard, sectorAt } from './galactic-model.js';
import { boundsOf, colorOf } from './place-model.js';
import { mapsEditor } from './attached-maps.js';
import { placeCardView } from './place-card.js';
import * as cityMap from './city-map.js';
import { push, revealAndPush, pushButton } from '../push/push.js';
import { visField, kindField, colorField, nameField, descField, editorForm, row, viewAsField, listTabs, searchBox, sideHead, seg, glyph } from './place-kit.js';

const starsApi = placesApi('stars');
const lanesApi = placesApi('lanes');
const sectorsApi = placesApi('sectors');
const SPACE = { x0: -GALAXY, y0: -GALAXY, x1: GALAXY, y1: GALAXY };
const ly = (n) => `${Math.round(n).toLocaleString()}`;

/** The box around what's on the map; a default patch when it's empty. */
export function starmapBox(data) {
  const b = boundsOf([...data.stars.map((x) => [x.x, x.y]), ...data.sectors.flatMap((x) => x.points)]);
  return b ? { x0: b.x0 - 150, y0: b.y0 - 120, x1: b.x1 + 150, y1: b.y1 + 150 } : { x0: -800, y0: -500, x1: 800, y1: 500 };
}

const centroid = (points) => {
  const b = boundsOf(points);
  return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
};

/**
 * Draw sectors, lanes and systems on a board.
 *   data  { stars, lanes, sectors }  (the GM's own, or playerStarmap()'s)
 *   opts  { selected, hover, onStar(id), onLane(id), onSector(id), drag, pending: { star } | { from, to } | { points, cursor } }
 */
export function drawStarmap(board, data, opts = {}) {
  const byId = new Map(data.stars.map((x) => [x.id, x]));
  const areas = svgEl('g', { class: 'gx-sectors' });
  const lines = svgEl('g', { class: 'gx-lanes' });
  const out = [];
  const lit = (id) => opts.selected === id || opts.hover === id;
  for (const sec of data.sectors) {
    const poly = svgEl('polygon', { points: sec.points.map((p) => p.join(',')).join(' '), class: `gx-sector ${sec.revealed === false ? 'is-hidden' : ''} ${lit(sec.id) ? 'is-lit' : ''}`, style: `--c:${colorOf(sec.color).hex}` });
    areas.append(poly);
    const c = centroid(sec.points);
    out.push({ node: marker({ id: sec.id, glyph: '⬚', name: sec.name, named: true, cls: `gx-sectormark ${sec.revealed === false ? 'is-hidden' : ''} ${lit(sec.id) ? 'is-current' : ''}`, title: `${sec.name} sector${sec.revealed === false ? ' (hidden)' : ''}`, onClick: opts.onSector ? () => opts.onSector(sec.id) : null }), x: c.x, y: c.y });
  }
  for (const l of data.lanes) {
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    if (!a || !b) continue;
    lines.append(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: `gx-lane gx-lane--${l.kind} ${l.revealed === false ? 'is-hidden' : ''} ${lit(l.id) ? 'is-lit' : ''}` }));
    const k = laneKind(l.kind);
    out.push({ node: marker({ id: l.id, glyph: k.glyph, name: l.travel ? `${l.name} · ${l.travel}` : l.name, cls: `gx-lanemark ${l.revealed === false ? 'is-hidden' : ''} ${lit(l.id) ? 'is-current' : ''}`, title: `${l.name} (${k.label}${l.travel ? `, ${l.travel}` : ''})`, onClick: opts.onLane ? () => opts.onLane(l.id) : null }), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  const p = opts.pending;
  if (p?.from && p.to) {
    const a = byId.get(p.from);
    if (a) lines.append(svgEl('line', { x1: a.x, y1: a.y, x2: p.to.x, y2: p.to.y, class: 'gx-lane gx-lane--pending' }));
  }
  if (p?.points?.length) {
    const pts = p.cursor ? [...p.points, [p.cursor.x, p.cursor.y]] : p.points;
    areas.append(svgEl('polyline', { points: pts.map((q) => q.join(',')).join(' '), class: 'gx-sector gx-sector--pending' }));
    p.points.forEach(([x, y], i) => out.push({ node: marker({ id: `__corner${i}`, glyph: i === 0 ? '◆' : '•', name: '', cls: 'gx-corner', title: i === 0 ? 'Click to close the outline' : 'Corner', onClick: i === 0 ? opts.onCloseSector : null }), x, y }));
  }
  for (const st of data.stars) {
    const k = starKind(st.kind);
    out.push({
      node: marker({ id: st.id, glyph: k.glyph, name: st.name, named: true, drag: opts.drag, cls: `gx-star gx-star--${st.kind} ${st.unique ? 'is-unique' : ''} ${st.revealed === false ? 'is-hidden' : ''} ${lit(st.id) || p?.from === st.id ? 'is-current' : ''}`, title: `${st.name} (${st.unique ? 'Unique ' : ''}${k.label}${st.revealed === false ? ', hidden' : ''})`, onClick: opts.onStar ? () => opts.onStar(st.id) : null }),
      x: st.x,
      y: st.y,
    });
  }
  if (p?.star) out.push({ node: marker({ id: '__new', glyph: starKind(p.star.kind).glyph, name: p.star.name || 'New system', named: true, cls: 'gx-star is-pending is-current' }), x: p.star.x, y: p.star.y });
  board.svg.replaceChildren(areas, lines);
  board.setMarkers(out);
}

export async function mount(root, { engine, project, item }) {
  // /starmap/<slug>: a unique location's own map (Night City's City Map).
  if (item) return cityMap.mount(root, { slug: item, project, back: { href: '#/starmap', label: 'Star Map' } });

  const s = {
    stars: [],
    lanes: [],
    sectors: [],
    viewAs: 'gm',
    tool: null, // 'star' | 'lane' | 'sector'
    laneFrom: null,
    corners: [], // the sector being drawn
    redrawing: null, // a sector whose outline is being drawn again
    cursor: null,
    draft: null, // { kind: 'star' | 'lane' | 'sector', item }
    viewing: null,
    tab: 'stars',
    query: '',
    hover: null,
  };
  const shown = () => (s.viewAs === 'players' ? playerStarmap(s.stars, s.lanes, s.sectors) : { stars: s.stars, lanes: s.lanes, sectors: s.sectors });

  const readout = { systems: el('span', { class: 'wv-value tp-mono' }, '0'), cursor: el('span', { class: 'wv-value tp-mono' }, '—'), sector: el('span', { class: 'wv-value' }, '—') };
  const toolBtn = (tool, label) => el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', 'data-tool': tool, onClick: () => setTool(s.tool === tool ? null : tool) }, label);
  const tools = { star: toolBtn('star', '+ System'), lane: toolBtn('lane', '+ Lane'), sector: toolBtn('sector', '+ Sector') };
  const viewHost = el('div');
  const hud = el('div', { class: 'wv-hud' },
    el('div', { class: 'wv-readouts' },
      el('div', { class: 'wv-readout' }, el('span', { class: 'tp-label' }, 'Systems'), readout.systems),
      el('div', { class: 'wv-readout' }, el('span', { class: 'tp-label' }, 'Cursor'), readout.cursor),
      el('div', { class: 'wv-readout' }, el('span', { class: 'tp-label' }, 'Sector'), readout.sector)),
    el('div', { class: 'wv-controls' },
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', 'aria-label': 'Zoom in', onClick: () => board.zoomBy(1.3) }, '+'),
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', 'aria-label': 'Zoom out', onClick: () => board.zoomBy(1 / 1.3) }, '−'),
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive', onClick: () => board.home() }, 'Fit')),
    el('div', { class: 'wv-controls pl-tools' }, tools.star, tools.lane, tools.sector),
    el('div', { class: 'wv-controls' }, pushButton('Push view', pushView, { title: 'Show the star map on the player screen as you see it now, with what players know' })),
    viewHost);
  const side = el('aside', { class: 'wv-side cm-side', 'aria-label': 'Systems, lanes and sectors' });
  const help = el('p', { class: 'wv-help tp-dim' }, '+ System or Shift+click to place a system · drag one to move it · + Lane, then two systems · + Sector, then click its corners · scroll to zoom');

  const board = createBoard({
    space: SPACE,
    zoom: [1, 300],
    className: 'gx-stage',
    label: 'The star map. + System or Shift+click places a system; drag one to move it; + Lane then two systems joins them; + Sector then its corners draws a sector. Drag to pan, scroll to zoom; arrow keys, + and −, 0 to fit.',
    home: () => starmapBox(shown()),
    reserve: () => side.offsetWidth + 24,
    onTap: (pt, e) => {
      if (s.viewAs !== 'gm') return;
      if (s.tool === 'sector') return addCorner(pt);
      if (s.tool === 'star' || e.shiftKey) return placeAt(pt);
      if (s.tool === 'lane') return;
      if (s.draft && !s.draft.item.id) return;
      if (s.draft || s.viewing) closeEditor();
    },
    onDoubleTap: () => {
      if (s.tool !== 'sector') return false;
      finishSector();
      return true;
    },
    onMove: (pt) => {
      readout.cursor.textContent = pt ? `${ly(pt.x)}, ${ly(pt.y)}` : '—';
      readout.sector.textContent = pt ? sectorAt(shown().sectors, [pt.x, pt.y])?.name ?? '—' : '—';
      if ((s.tool === 'lane' && s.laneFrom) || (s.tool === 'sector' && s.corners.length)) {
        s.cursor = pt;
        draw();
      }
    },
    onMarkerDrag: (id, pt) => {
      const st = starOf(id);
      if (!st) return;
      Object.assign(st, { x: Math.round(pt.x), y: Math.round(pt.y) });
      if (s.draft?.item.id === id) Object.assign(s.draft.item, { x: st.x, y: st.y });
      draw();
    },
    onMarkerDrop: async (id) => {
      const st = starOf(id);
      if (!st) return;
      try {
        const saved = await starsApi.save(st.unique ? { id: st.id, x: st.x, y: st.y } : st);
        s.stars = s.stars.map((x) => (x.id === saved.id ? saved : x));
        if (st.unique) toast(`Moved ${saved.name}`);
      } catch (err) {
        toastError(err);
      }
    },
  });

  root.replaceChildren(el('section', { class: 'tp-frame tp-panel wv-panel', 'aria-label': `${project?.name ?? 'Project'}: star map` },
    el('div', { class: 'wv-stage gx-frame' }, board.stage, hud, side, help)));
  document.title = 'TEMPEST · Star Map';

  try {
    [s.stars, s.lanes, s.sectors] = await Promise.all([starsApi.list(), lanesApi.list(), sectorsApi.list()]);
  } catch (err) {
    side.replaceChildren(el('p', { class: 'app-error' }, err.message));
  }

  const starOf = (id) => s.stars.find((x) => x.id === id);
  const listOf = { star: 'stars', lane: 'lanes', sector: 'sectors' };
  const apiOf = { star: starsApi, lane: lanesApi, sector: sectorsApi };
  const itemOf = (kind, id) => s[listOf[kind]].find((x) => x.id === id);

  function draw() {
    const data = shown();
    if (s.draft?.item.id) {
      const d = s.draft.item;
      const list = listOf[s.draft.kind];
      data[list] = data[list].map((x) => (x.id === d.id ? { ...x, ...d } : x));
    }
    if (s.draft?.kind === 'lane' && !s.draft.item.id) data.lanes = [...data.lanes, { ...s.draft.item, id: '__newlane', name: s.draft.item.name || 'New lane' }];
    if (s.draft?.kind === 'sector' && !s.draft.item.id) data.sectors = [...data.sectors, { ...s.draft.item, id: '__newsector', name: s.draft.item.name || 'New sector' }];
    const pending = s.draft?.kind === 'star' && !s.draft.item.id ? { star: s.draft.item }
      : s.laneFrom ? { from: s.laneFrom, to: s.cursor }
        : s.corners.length ? { points: s.corners, cursor: s.cursor } : null;
    drawStarmap(board, data, {
      selected: s.draft?.item.id ?? s.viewing ?? (s.draft?.kind === 'lane' ? '__newlane' : s.draft?.kind === 'sector' ? '__newsector' : null),
      hover: s.hover,
      drag: s.viewAs === 'gm' && !s.tool,
      onStar: pickStar,
      onLane: (id) => id !== '__newlane' && open('lane', itemOf('lane', id)),
      onSector: (id) => id !== '__newsector' && open('sector', itemOf('sector', id)),
      onCloseSector: finishSector,
      pending,
    });
    readout.systems.textContent = s.viewAs === 'players' ? `${data.stars.length} known` : `${s.stars.length} (${s.stars.filter((x) => x.revealed).length} revealed)`;
  }

  // --- tools -----------------------------------------------------------------------------------

  function setTool(tool) {
    s.tool = s.viewAs === 'gm' ? tool : null;
    s.laneFrom = null;
    s.corners = [];
    s.cursor = null;
    if (tool) s.draft = s.draft?.item.id ? s.draft : null;
    render();
  }
  function placeAt(pt) {
    s.viewing = null;
    const keep = s.draft?.kind === 'star' && !s.draft.item.id ? s.draft.item : null;
    s.draft = { kind: 'star', item: keep ? { ...keep, x: Math.round(pt.x), y: Math.round(pt.y) } : { name: '', kind: 'star', description: '', revealed: false, x: Math.round(pt.x), y: Math.round(pt.y), maps: [] } };
    s.tool = null;
    render();
    side.querySelector('[name="name"]')?.focus();
  }
  function pickStar(id) {
    if (s.viewAs === 'players') return view(id);
    if (s.tool === 'sector') return addCorner(starOf(id));
    if (s.tool !== 'lane') return open('star', starOf(id));
    if (!s.laneFrom) {
      s.laneFrom = id;
      return render();
    }
    if (s.laneFrom === id) return;
    s.draft = { kind: 'lane', item: { name: '', kind: 'hyperlane', from: s.laneFrom, to: id, travel: '', description: '', revealed: false, maps: [] } };
    s.tool = null;
    s.laneFrom = null;
    s.cursor = null;
    render();
    side.querySelector('[name="name"]')?.focus();
  }
  function addCorner(pt) {
    if (s.corners.length >= MAX_SECTOR_POINTS) return toast(`A sector can have up to ${MAX_SECTOR_POINTS} corners`);
    s.corners = [...s.corners, [Math.round(pt.x), Math.round(pt.y)]];
    render();
  }
  function finishSector() {
    if (s.corners.length < 3) return toast('A sector needs at least three corners');
    s.draft = { kind: 'sector', item: s.redrawing ? { ...s.redrawing, points: s.corners } : { name: '', color: 'cyan', points: s.corners, description: '', revealed: false, maps: [] } };
    s.redrawing = null;
    s.tool = null;
    s.corners = [];
    s.cursor = null;
    render();
    side.querySelector('[name="name"]')?.focus();
  }

  // --- editing ---------------------------------------------------------------------------------

  function open(kind, item) {
    if (!item) return;
    if (s.viewAs === 'players') return view(item.id);
    s.draft = { kind, item: { maps: [], ...structuredClone(item) } };
    s.viewing = null;
    s.tool = null;
    s.laneFrom = null;
    s.corners = [];
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
    render();
  }
  async function saveDraft() {
    const { kind, item } = s.draft;
    const list = listOf[kind];
    try {
      if (item.id) {
        const saved = await apiOf[kind].save(item);
        s[list] = s[list].map((x) => (x.id === saved.id ? saved : x));
        toast(`Saved "${saved.name}"`, { tone: 'success' });
      } else {
        const made = await apiOf[kind].create(item);
        s[list] = [...s[list], made].sort((a, b) => a.name.localeCompare(b.name));
        toast(`Charted "${made.name}"`, { tone: 'success' });
      }
      s.draft = null;
      render();
    } catch (err) {
      toastError(err);
    }
  }
  async function setRevealed(kind, item, revealed) {
    const list = listOf[kind];
    const saved = await apiOf[kind].save(item.unique ? { id: item.id, revealed } : { ...item, revealed });
    s[list] = s[list].map((x) => (x.id === saved.id ? saved : x));
    if (s.draft?.item.id === saved.id) s.draft.item.revealed = saved.revealed;
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
    const lanes = kind === 'star' ? s.lanes.filter((l) => l.from === item.id || l.to === item.id) : [];
    const noun = { star: 'system', lane: 'lane', sector: 'sector' }[kind];
    const body = `This ${noun} will be removed from the map for good${lanes.length ? `, with its ${lanes.length} lane${lanes.length === 1 ? '' : 's'}` : ''}.`;
    if (!(await confirmDialog({ title: `Delete "${item.name}"?`, body, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await apiOf[kind].remove(item.id);
      s[listOf[kind]] = s[listOf[kind]].filter((x) => x.id !== item.id);
      if (kind === 'star') s.lanes = s.lanes.filter((l) => !lanes.includes(l));
      toast(`Deleted "${item.name}"`);
      s.draft = null;
      render();
    } catch (err) {
      toastError(err);
    }
  }

  // --- pushing ---------------------------------------------------------------------------------

  function pushView() {
    const focus = s.draft && s.draft.kind !== 'lane' ? s.draft.item.id : s.viewing && !s.viewing.startsWith('lane_') ? s.viewing : null;
    push({ mode: 'starmap', box: board.visibleBox(), focus: focus ?? null });
  }
  function pushPlace(kind, item) {
    if (kind === 'lane') {
      const hidden = [starOf(item.from), starOf(item.to)].filter((x) => !x?.revealed);
      if (hidden.length) return toastError(new Error(`Players can't see this lane until both its ends are revealed: reveal ${hidden.map((x) => `"${x?.name ?? '?'}"`).join(' and ')} first`));
    }
    return revealAndPush(item, async () => {
      await setRevealed(kind, item, true);
      render();
    }, { mode: 'place', id: item.id });
  }
  const pushMap = (d) => (m) => push({ mode: 'handout', image: m.image, caption: m.caption || d.name });

  // --- side panel ------------------------------------------------------------------------------

  const actions = (kind, d) => (d.id ? [
    el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => remove(kind, itemOf(kind, d.id)) }, 'Delete'),
    pushButton('Push', () => pushPlace(kind, itemOf(kind, d.id)), { title: 'Show this (as saved) on the player screen', ghost: true }),
  ] : []);

  function uniqueEditor(d) {
    const live = starOf(d.id);
    return el('div', { class: 'wv-editor' },
      sideHead(d.name, closeEditor),
      el('p', { class: 'app-row' }, glyph(starKind(d.kind).glyph), el('span', {}, `Unique ${starKind(d.kind).label}`), el('span', { class: 'tp-badge tp-badge--interactive' }, 'Built in')),
      el('p', { class: 'wv-note' }, d.description),
      el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Players'),
        seg('Visibility to players', [[false, 'Hidden'], [true, 'Revealed']], live.revealed, () => toggle('star')(live))),
      el('div', { class: 'wv-where' },
        el('span', { class: 'tp-mono' }, `${ly(live.x)}, ${ly(live.y)}`),
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => board.center(live.x, live.y, 20) }, 'Centre on it')),
      el('a', { class: 'tp-frame tp-btn tp-btn--primary wv-citymap', href: `#/starmap/${d.slug}` }, 'Open City Map'),
      pushButton('Push to players', () => pushPlace('star', live), { title: 'Show it on the player screen' }),
      el('p', { class: 'tp-dim wv-note' }, 'Built into this project: drag it to move it; it can\'t be renamed or deleted. Turn it off in Project settings.'));
  }

  function starEditor(d) {
    if (d.unique) return uniqueEditor(d);
    const isNew = !d.id;
    const lanes = s.lanes.filter((l) => l.from === d.id || l.to === d.id);
    const sector = sectorAt(s.sectors, [d.x, d.y]);
    return editorForm({
      title: isNew ? 'New system' : 'Edit system',
      close: closeEditor,
      save: saveDraft,
      isNew,
      saveLabel: isNew ? 'Place system' : 'Save',
      fields: [
        nameField(d, { placeholder: 'e.g. Tau Ceti', onInput: draw }),
        kindField('Kind', STAR_KINDS, d, render),
        descField(d, 'Worlds, stations, who holds it… (optional)'),
        visField(d, render, { shownNote: 'Players know of this system.', hiddenNote: 'Only you can see this system until you reveal it.' }),
        el('div', { class: 'wv-where' },
          el('span', { class: 'tp-mono' }, `${ly(d.x)}, ${ly(d.y)}${sector ? ` · ${sector.name}` : ''}`),
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => board.center(d.x, d.y, 20) }, 'Centre on it')),
        isNew ? null : el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, `Lanes (${lanes.length})`),
          lanes.length ? el('ul', { class: 'wv-items' }, lanes.map((l) => row({ item: l, g: laneKind(l.kind).glyph, sub: `${laneKind(l.kind).label} · to ${starOf(l.from === d.id ? l.to : l.from)?.name ?? '?'}`, onPick: () => open('lane', l), toggle: toggle('lane'), gm: true, hover: setHover }))) : null,
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => ((s.draft = null), (s.tool = 'lane'), (s.laneFrom = d.id), render()) }, '+ Lane from here')),
        mapsEditor(d.maps, render, { push: pushMap(d) }),
      ],
      left: actions('star', d),
    });
  }

  function laneEditor(d) {
    const isNew = !d.id;
    const pick = (key, label) => el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, label),
      el('select', { class: 'tp-select', onChange: (e) => ((d[key] = e.target.value), render()) },
        s.stars.map((x) => el('option', { value: x.id, selected: d[key] === x.id }, `${x.name}${x.revealed ? '' : ' (hidden)'}`))));
    const ends = [starOf(d.from), starOf(d.to)];
    return editorForm({
      title: isNew ? 'New lane' : 'Edit lane',
      close: closeEditor,
      save: saveDraft,
      isNew,
      saveLabel: isNew ? 'Chart lane' : 'Save',
      fields: [
        nameField(d, { placeholder: 'e.g. The Kessel Run', onInput: draw }),
        kindField('Kind', LANE_KINDS, d, render),
        el('div', { class: 'pl-ends' }, pick('from', 'From'), pick('to', 'To')),
        el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Travel time'),
          el('input', { class: 'tp-input', value: d.travel, maxlength: 40, placeholder: 'e.g. 3 days (optional)', onInput: (e) => ((d.travel = e.target.value), draw()) })),
        descField(d, 'Hazards, tolls, who patrols it… (optional)'),
        visField(d, render, {
          shownNote: ends.every((x) => x?.revealed) ? 'Players know of this lane.' : 'Revealed, but players see it only once both its ends are revealed.',
          hiddenNote: 'Only you can see this lane until you reveal it.',
        }),
        mapsEditor(d.maps, render, { push: pushMap(d) }),
      ],
      left: actions('lane', d),
    });
  }

  function sectorEditor(d) {
    const isNew = !d.id;
    const inside = s.stars.filter((x) => sectorAt([d], [x.x, x.y]));
    return editorForm({
      title: isNew ? 'New sector' : 'Edit sector',
      close: closeEditor,
      save: saveDraft,
      isNew,
      saveLabel: isNew ? 'Add sector' : 'Save',
      fields: [
        nameField(d, { placeholder: 'e.g. The Outer Rim', onInput: draw }),
        colorField(d, render),
        descField(d, 'Who claims it, what it\'s known for… (optional)'),
        visField(d, render, { shownNote: 'Players know of this sector.', hiddenNote: 'Only you can see this sector until you reveal it.' }),
        el('p', { class: 'tp-dim wv-note' }, `${d.points.length} corners · ${inside.length} system${inside.length === 1 ? '' : 's'} inside`),
        el('div', { class: 'wv-where' }, el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => board.fit(boundsOf(d.points)) }, 'Zoom to'),
          isNew ? null : el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', title: 'Draw a new outline for this sector', onClick: () => redraw(d) }, 'Redraw outline')),
        mapsEditor(d.maps, render, { push: pushMap(d) }),
      ],
      left: actions('sector', d),
    });
  }
  /** Draw a sector's outline again: the next closed outline replaces its corners (saved with Save). */
  function redraw(d) {
    s.redrawing = structuredClone(d);
    s.draft = null;
    s.tool = 'sector';
    s.corners = [];
    render();
  }

  function playersCard(id) {
    const card = galacticCard(id, s.stars, s.lanes, s.sectors);
    if (!card) return listPanel();
    const st = starOf(id);
    return el('div', { class: 'wv-editor' },
      sideHead(card.name, closeEditor),
      placeCardView(card, { panel: false, push: pushMap(card) }),
      st ? el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => board.center(st.x, st.y, 20) }, 'Centre on it') : null,
      st?.unique ? el('a', { class: 'tp-frame tp-btn tp-btn--primary wv-citymap', href: `#/starmap/${st.slug}` }, 'Open City Map') : null);
  }

  function listPanel() {
    const gm = s.viewAs === 'gm';
    const data = shown();
    const q = s.query.trim().toLowerCase();
    const match = (x) => !q || x.name.toLowerCase().includes(q);
    const known = (list, key) => (gm ? list : list.filter((x) => data[key].some((y) => y.id === x.id)));
    const lists = { stars: known(s.stars, 'stars'), lanes: known(s.lanes, 'lanes'), sectors: known(s.sectors, 'sectors') };
    const tabs = listTabs([['stars', `Systems (${lists.stars.length})`], ['lanes', `Lanes (${lists.lanes.length})`], ['sectors', `Sectors (${lists.sectors.length})`]], s.tab, (t) => ((s.tab = t), render()));
    const search = searchBox(s.query, 'Find…', (v) => {
      s.query = v;
      const next = listPanel();
      side.replaceChildren(next);
      const box = next.querySelector('input[type="search"]');
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    });
    const empty = {
      stars: gm ? 'No systems yet. Use “+ System” or Shift+click the map.' : 'No systems revealed yet.',
      lanes: gm ? 'No lanes yet. Use “+ Lane”, then click two systems.' : 'No lanes known yet.',
      sectors: gm ? 'No sectors yet. Use “+ Sector”, click its corners, then click the first corner (or double-click) to close it.' : 'No sectors known yet.',
    };
    const rows = {
      stars: (x) => row({ item: x, g: starKind(x.kind).glyph, sub: x.unique ? `Unique ${starKind(x.kind).label}` : `${starKind(x.kind).label}${sectorAt(data.sectors, [x.x, x.y]) ? ` · ${sectorAt(data.sectors, [x.x, x.y]).name}` : ''}`, onPick: () => (board.center(x.x, x.y), open('star', x)), toggle: toggle('star'), gm, hover: setHover }),
      lanes: (x) => row({ item: x, g: laneKind(x.kind).glyph, sub: `${starOf(x.from)?.name ?? '?'} ⇄ ${starOf(x.to)?.name ?? '?'}${x.travel ? ` · ${x.travel}` : ''}`, onPick: () => open('lane', x), toggle: toggle('lane'), gm, hover: setHover }),
      sectors: (x) => row({ item: x, g: '⬚', sub: `Sector · ${colorOf(x.color).label}`, onPick: () => (board.fit(boundsOf(x.points)), open('sector', x)), toggle: toggle('sector'), gm, hover: setHover }),
    };
    const shownList = lists[s.tab].filter(match);
    return el('div', { class: 'wv-list' },
      tabs,
      el('p', { class: 'tp-dim wv-note' }, gm ? 'A lane shows to players once it and both its ends are revealed.' : `Showing what players know: ${data.stars.length} of ${s.stars.length} systems.`),
      search,
      shownList.length ? el('ul', { class: 'wv-items' }, shownList.map(rows[s.tab])) : el('p', { class: 'tp-dim wv-note' }, lists[s.tab].length ? 'Nothing matches.' : empty[s.tab]));
  }

  function setHover(id) {
    if (s.hover === id) return;
    s.hover = id;
    draw();
  }

  function renderHud() {
    const gm = s.viewAs === 'gm';
    const labels = {
      star: s.tool === 'star' ? 'Click the map… (Esc)' : '+ System',
      lane: s.tool === 'lane' ? (s.laneFrom ? `From ${starOf(s.laneFrom)?.name ?? '?'}: pick the other end…` : 'Pick the first system… (Esc)') : '+ Lane',
      sector: s.tool === 'sector' ? (s.corners.length >= 3 ? `${s.corners.length} corners: click the first to close` : 'Click the corners… (Esc)') : '+ Sector',
    };
    for (const [tool, b] of Object.entries(tools)) {
      b.hidden = !gm;
      b.textContent = labels[tool];
      b.classList.toggle('tp-btn--interactive', s.tool === tool);
      b.setAttribute('aria-pressed', String(s.tool === tool));
    }
    board.stage.classList.toggle('is-placing', s.tool === 'star' || s.tool === 'sector');
    board.stage.classList.toggle('is-linking', s.tool === 'lane');
    viewHost.replaceChildren(viewAsField(s.viewAs, (v) => {
      s.viewAs = v;
      s.draft = null;
      s.viewing = null;
      setTool(null);
    }));
  }

  function render() {
    renderHud();
    draw();
    const d = s.draft && s.viewAs === 'gm' ? s.draft : null;
    const key = d ? `edit:${d.kind}:${d.item.id ?? 'new'}` : s.viewing ? `card:${s.viewing}` : `list:${s.tab}`;
    const keep = side.dataset.panel === key ? side.scrollTop : 0;
    const editors = { star: starEditor, lane: laneEditor, sector: sectorEditor };
    side.replaceChildren(d ? editors[d.kind](d.item) : s.viewing ? playersCard(s.viewing) : listPanel());
    side.dataset.panel = key;
    side.scrollTop = keep;
    board.stage.parentElement?.classList.toggle('is-players', s.viewAs === 'players');
  }

  const onKey = (e) => {
    if (document.querySelector('dialog[open]') || e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'Enter' && s.tool === 'sector') return finishSector();
    if (e.key === 'Backspace' && s.tool === 'sector' && s.corners.length) {
      s.corners = s.corners.slice(0, -1);
      return render();
    }
    if (e.key !== 'Escape') return;
    if (s.tool) {
      s.redrawing = null;
      setTool(null);
    } else if (s.draft || s.viewing) closeEditor();
  };
  document.addEventListener('keydown', onKey);
  const onTheme = () => requestAnimationFrame(() => board.redraw());
  engine?.addEventListener('change', onTheme);

  render();
  board.home();

  return {
    unmount() {
      board.destroy();
      document.removeEventListener('keydown', onKey);
      engine?.removeEventListener('change', onTheme);
    },
  };
}
