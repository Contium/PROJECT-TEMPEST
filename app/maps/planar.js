// Planes (#/planes): the Planar map system. Shown as a section of its own while
// the open project's map system is Planar (Project settings).
//
// A board of planes and realms the GM lays out freely, joined by ways (portals,
// gates, rifts, paths, rituals). "+ Plane" (or Shift+click) puts a plane down;
// drag a plane to move it. "+ Way" then two planes joins them. Click anything to
// edit it in the side panel. Everything is hidden from players until revealed;
// a way shows to players only once both its planes are revealed too, and a
// hinted way shows as a "?" leading off a plane they know. "View as Players"
// shows the board as they know it; "Push view" puts that on the player screens.

import { el, toast, toastError, confirmDialog } from '../ui.js';
import { placesApi } from '../api.js';
import { createBoard, marker, svgEl } from './board.js';
import { PLANE_KINDS, WAY_KINDS, PLANAR_SPACE, planeKind, wayKind, playerPlanar, planarCard } from './planar-model.js';
import { boundsOf } from './place-model.js';
import { mapsEditor } from './attached-maps.js';
import { placeCardView } from './place-card.js';
import { push, revealAndPush, pushButton } from '../push/push.js';
import { visField, kindField, nameField, descField, editorForm, row, viewAsField, listTabs, searchBox, sideHead, glyph } from './place-kit.js';

const planesApi = placesApi('planes');
const waysApi = placesApi('ways');
const SPACE = { x0: -PLANAR_SPACE, y0: -PLANAR_SPACE, x1: PLANAR_SPACE, y1: PLANAR_SPACE };
const HINT_LENGTH = 150;

/** The box around some planes, with room for their names; a default patch when there are none. */
export function planesBox(planes) {
  const b = boundsOf(planes.map((p) => [p.x, p.y]));
  return b ? { x0: b.x0 - 120, y0: b.y0 - 100, x1: b.x1 + 120, y1: b.y1 + 120 } : { x0: -400, y0: -300, x1: 400, y1: 300 };
}

/**
 * Draw planes and ways on a board.
 *   data   { planes, ways, hints? }  (the GM's own, or playerPlanar()'s)
 *   opts   { gm, selected, hover, onPlane(id), onWay(id), drag (planes can be dragged), pending: { from, to: {x,y} } | { plane } }
 */
export function drawPlanar(board, data, opts = {}) {
  const byId = new Map(data.planes.map((p) => [p.id, p]));
  const lines = svgEl('g', { class: 'pl-lines' });
  const out = [];
  for (const w of data.ways) {
    const a = byId.get(w.from);
    const b = byId.get(w.to);
    if (!a || !b) continue;
    const lit = opts.selected === w.id || opts.hover === w.id;
    lines.append(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: `pl-way pl-way--${w.kind} ${w.revealed === false ? 'is-hidden' : ''} ${lit ? 'is-lit' : ''}` }));
    const k = wayKind(w.kind);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const node = marker({ id: w.id, glyph: k.glyph, name: w.name, cls: `pl-waymark ${w.revealed === false ? 'is-hidden' : ''} ${lit ? 'is-current' : ''}`, title: `${w.name} (${k.label}${w.oneWay ? ', one way' : ''})`, onClick: opts.onWay ? () => opts.onWay(w.id) : null });
    if (w.oneWay) node.append(el('span', { class: 'pl-arrow', style: `transform: rotate(${angle}rad)`, 'aria-hidden': 'true' }, '➜'));
    out.push({ node, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  for (const h of data.hints ?? []) {
    const a = byId.get(h.at);
    if (!a) continue;
    const x = a.x + Math.cos(h.angle) * HINT_LENGTH;
    const y = a.y + Math.sin(h.angle) * HINT_LENGTH;
    lines.append(svgEl('line', { x1: a.x, y1: a.y, x2: x, y2: y, class: 'pl-way pl-way--hint' }));
    out.push({ node: marker({ id: h.id, glyph: '?', name: '', cls: 'pl-hint', title: h.inbound ? 'Something leads here, from somewhere unknown' : 'A way leads off from here, to somewhere unknown' }), x, y });
  }
  const p = opts.pending;
  if (p?.from && p.to) {
    const a = byId.get(p.from);
    if (a) lines.append(svgEl('line', { x1: a.x, y1: a.y, x2: p.to.x, y2: p.to.y, class: 'pl-way pl-way--pending' }));
  }
  for (const pl of data.planes) {
    const k = planeKind(pl.kind);
    const lit = opts.selected === pl.id || opts.hover === pl.id || p?.from === pl.id;
    out.push({
      node: marker({ id: pl.id, glyph: k.glyph, name: pl.name, named: true, drag: opts.drag, cls: `pl-plane pl-plane--${pl.kind} ${pl.revealed === false ? 'is-hidden' : ''} ${lit ? 'is-current' : ''}`, title: `${pl.name} (${k.label}${pl.revealed === false ? ', hidden' : ''})`, onClick: opts.onPlane ? () => opts.onPlane(pl.id) : null }),
      x: pl.x,
      y: pl.y,
    });
  }
  if (p?.plane) out.push({ node: marker({ id: '__new', glyph: planeKind(p.plane.kind).glyph, name: p.plane.name || 'New plane', named: true, cls: 'pl-plane is-pending is-current' }), x: p.plane.x, y: p.plane.y });
  board.svg.replaceChildren(lines);
  board.setMarkers(out);
}

export async function mount(root, { engine, project }) {
  const s = {
    planes: [],
    ways: [],
    viewAs: 'gm',
    tool: null, // 'plane' | 'way': the next click places a plane / picks a plane for a way
    wayFrom: null, // the first plane picked for a new way
    cursor: null, // the pointer on the board (for the way being drawn)
    draft: null, // { kind: 'plane' | 'way', item } being edited
    viewing: null, // players' view: id of the place being looked at
    tab: 'planes',
    query: '',
    hover: null,
  };
  const shown = () => (s.viewAs === 'players' ? playerPlanar(s.planes, s.ways) : { planes: s.planes, ways: s.ways, hints: [] });

  const readout = { planes: el('span', { class: 'wv-value tp-mono' }, '0'), ways: el('span', { class: 'wv-value tp-mono' }, '0') };
  const planeBtn = el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => setTool(s.tool === 'plane' ? null : 'plane') });
  const wayBtn = el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => setTool(s.tool === 'way' ? null : 'way') });
  const viewHost = el('div');
  const hud = el('div', { class: 'wv-hud' },
    el('div', { class: 'wv-readouts' },
      el('div', { class: 'wv-readout' }, el('span', { class: 'tp-label' }, 'Planes'), readout.planes),
      el('div', { class: 'wv-readout' }, el('span', { class: 'tp-label' }, 'Ways'), readout.ways)),
    el('div', { class: 'wv-controls' },
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', 'aria-label': 'Zoom in', onClick: () => board.zoomBy(1.3) }, '+'),
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', 'aria-label': 'Zoom out', onClick: () => board.zoomBy(1 / 1.3) }, '−'),
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive', onClick: () => board.home() }, 'Fit')),
    el('div', { class: 'wv-controls pl-tools' }, planeBtn, wayBtn),
    el('div', { class: 'wv-controls' }, pushButton('Push view', pushView, { title: 'Show the board on the player screen as you see it now, with what players know' })),
    viewHost);
  const side = el('aside', { class: 'wv-side cm-side', 'aria-label': 'Planes and ways' });
  const help = el('p', { class: 'wv-help tp-dim' }, '+ Plane or Shift+click to add a plane · drag a plane to move it · + Way, then two planes, to join them · scroll to zoom');

  const board = createBoard({
    space: SPACE,
    zoom: [1, 160],
    className: 'pl-stage',
    label: 'The planes. + Plane or Shift+click puts a plane down; drag a plane to move it; + Way then two planes joins them. Drag to pan, scroll to zoom; arrow keys, + and −, 0 to fit.',
    home: () => planesBox(shown().planes),
    reserve: () => side.offsetWidth + 24,
    onTap: (pt, e) => {
      if (s.viewAs !== 'gm') return;
      if (s.tool === 'plane' || e.shiftKey) return placeAt(pt);
      if (s.tool === 'way') return; // waiting for a plane
      if (s.draft && !s.draft.item.id) return; // an unsaved new thing stays open
      if (s.draft || s.viewing) closeEditor();
    },
    onMove: (pt) => {
      if (s.tool === 'way' && s.wayFrom) {
        s.cursor = pt;
        draw();
      }
    },
    onMarkerDrag: (id, pt) => {
      const p = s.planes.find((x) => x.id === id);
      if (!p) return;
      Object.assign(p, { x: Math.round(pt.x), y: Math.round(pt.y) });
      if (s.draft?.item.id === id) Object.assign(s.draft.item, { x: p.x, y: p.y });
      draw();
    },
    onMarkerDrop: async (id) => {
      const p = s.planes.find((x) => x.id === id);
      if (!p) return;
      try {
        const saved = await planesApi.save(p);
        s.planes = s.planes.map((x) => (x.id === saved.id ? saved : x));
      } catch (err) {
        toastError(err);
      }
    },
  });

  root.replaceChildren(el('section', { class: 'tp-frame tp-panel wv-panel', 'aria-label': `${project?.name ?? 'Project'}: planes` },
    el('div', { class: 'wv-stage pl-frame' }, board.stage, hud, side, help)));
  document.title = 'TEMPEST · Planes';

  try {
    [s.planes, s.ways] = await Promise.all([planesApi.list(), waysApi.list()]);
  } catch (err) {
    side.replaceChildren(el('p', { class: 'app-error' }, err.message));
  }

  // --- what the board shows ---------------------------------------------------------------

  const planeOf = (id) => s.planes.find((p) => p.id === id);
  const wayOf = (id) => s.ways.find((w) => w.id === id);

  function draw() {
    const data = shown();
    // The thing being edited shows its draft (name, kind, ends) as it changes.
    if (s.draft?.item.id) {
      const d = s.draft.item;
      if (s.draft.kind === 'plane') data.planes = data.planes.map((p) => (p.id === d.id ? { ...p, ...d } : p));
      else data.ways = data.ways.map((w) => (w.id === d.id ? { ...w, ...d } : w));
    }
    if (s.draft?.kind === 'way' && !s.draft.item.id) data.ways = [...data.ways, { ...s.draft.item, id: '__newway', name: s.draft.item.name || 'New way' }];
    const selected = s.draft?.item.id ?? s.viewing ?? (s.draft?.kind === 'way' ? '__newway' : null);
    drawPlanar(board, data, {
      gm: s.viewAs === 'gm',
      selected,
      hover: s.hover,
      drag: s.viewAs === 'gm' && !s.tool,
      onPlane: pickPlane,
      onWay: (id) => id !== '__newway' && open('way', wayOf(id)),
      pending: s.draft?.kind === 'plane' && !s.draft.item.id ? { plane: s.draft.item } : s.wayFrom ? { from: s.wayFrom, to: s.cursor } : null,
    });
    readout.planes.textContent = s.viewAs === 'players' ? `${data.planes.length} known` : `${s.planes.length} (${s.planes.filter((p) => p.revealed).length} revealed)`;
    readout.ways.textContent = s.viewAs === 'players' ? `${data.ways.length} known` : `${s.ways.length} (${s.ways.filter((w) => w.revealed).length} revealed)`;
  }

  // --- tools ---------------------------------------------------------------------------------

  function setTool(tool) {
    s.tool = s.viewAs === 'gm' ? tool : null;
    s.wayFrom = null;
    s.cursor = null;
    render();
  }
  function placeAt(pt) {
    s.viewing = null;
    const keep = s.draft?.kind === 'plane' && !s.draft.item.id ? s.draft.item : null;
    s.draft = { kind: 'plane', item: keep ? { ...keep, x: Math.round(pt.x), y: Math.round(pt.y) } : { name: '', kind: 'material', description: '', revealed: false, x: Math.round(pt.x), y: Math.round(pt.y), maps: [] } };
    s.tool = null;
    render();
    side.querySelector('[name="name"]')?.focus();
  }
  function pickPlane(id) {
    if (s.viewAs === 'players') return view(id);
    if (s.tool !== 'way') return open('plane', planeOf(id));
    if (!s.wayFrom) {
      s.wayFrom = id;
      return render();
    }
    if (s.wayFrom === id) return;
    s.draft = { kind: 'way', item: { name: '', kind: 'portal', from: s.wayFrom, to: id, oneWay: false, hint: false, description: '', revealed: false, maps: [] } };
    s.tool = null;
    s.wayFrom = null;
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
    s.wayFrom = null;
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
  const apiOf = (kind) => (kind === 'plane' ? planesApi : waysApi);
  const listOf = (kind) => (kind === 'plane' ? 'planes' : 'ways');
  const sortByName = (list) => list.sort((a, b) => a.name.localeCompare(b.name));

  async function saveDraft() {
    const { kind, item } = s.draft;
    try {
      if (item.id) {
        const saved = await apiOf(kind).save(item);
        s[listOf(kind)] = s[listOf(kind)].map((x) => (x.id === saved.id ? saved : x));
        toast(`Saved "${saved.name}"`, { tone: 'success' });
      } else {
        const made = await apiOf(kind).create(item);
        s[listOf(kind)] = sortByName([...s[listOf(kind)], made]);
        toast(`${kind === 'plane' ? 'Added' : 'Opened'} "${made.name}"`, { tone: 'success' });
      }
      s.draft = null;
      render();
    } catch (err) {
      toastError(err);
    }
  }
  async function setRevealed(kind, item, revealed) {
    const saved = await apiOf(kind).save({ ...item, revealed });
    s[listOf(kind)] = s[listOf(kind)].map((x) => (x.id === saved.id ? saved : x));
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
    const ways = kind === 'plane' ? s.ways.filter((w) => w.from === item.id || w.to === item.id) : [];
    const body = kind === 'plane'
      ? `This plane will be removed for good${ways.length ? `, with the ${ways.length} way${ways.length === 1 ? '' : 's'} in or out of it` : ''}.`
      : 'This way will be removed for good. Its planes stay.';
    if (!(await confirmDialog({ title: `Delete "${item.name}"?`, body, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await apiOf(kind).remove(item.id);
      s[listOf(kind)] = s[listOf(kind)].filter((x) => x.id !== item.id);
      if (kind === 'plane') s.ways = s.ways.filter((w) => !ways.includes(w));
      toast(`Deleted "${item.name}"`);
      s.draft = null;
      render();
    } catch (err) {
      toastError(err);
    }
  }

  // --- pushing ---------------------------------------------------------------------------------

  function pushView() {
    const focus = s.draft?.kind === 'plane' ? s.draft.item.id : planeOf(s.viewing)?.id;
    push({ mode: 'planes', box: board.visibleBox(), focus: focus ?? null });
  }
  function pushPlace(kind, item) {
    if (kind === 'way') {
      const hidden = [planeOf(item.from), planeOf(item.to)].filter((p) => !p?.revealed);
      if (hidden.length) return toastError(new Error(`Players can't see this way until both its planes are revealed: reveal ${hidden.map((p) => `"${p?.name ?? '?'}"`).join(' and ')} first`));
    }
    return revealAndPush(item, async () => {
      await setRevealed(kind, item, true);
      render();
    }, { mode: 'place', id: item.id });
  }
  const pushMap = (d) => (m) => push({ mode: 'handout', image: m.image, caption: m.caption || d.name });

  // --- side panel ------------------------------------------------------------------------------

  function planeEditor(d) {
    const isNew = !d.id;
    const ways = s.ways.filter((w) => w.from === d.id || w.to === d.id);
    return editorForm({
      title: isNew ? 'New plane' : 'Edit plane',
      close: closeEditor,
      save: saveDraft,
      isNew,
      saveLabel: isNew ? 'Add plane' : 'Save',
      fields: [
        nameField(d, { placeholder: 'e.g. The Feywild', onInput: draw }),
        kindField('Kind', PLANE_KINDS, d, render),
        descField(d, 'What it is like, who rules it… (optional)'),
        visField(d, render, { shownNote: 'Players know of this plane.', hiddenNote: 'Only you can see this plane until you reveal it.' }),
        isNew ? null : el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, `Ways in or out (${ways.length})`),
          ways.length ? el('ul', { class: 'wv-items' }, ways.map((w) => row({ item: w, g: wayKind(w.kind).glyph, sub: `${wayKind(w.kind).label} · ${w.from === d.id ? 'to' : 'from'} ${planeOf(w.from === d.id ? w.to : w.from)?.name ?? '?'}`, onPick: () => open('way', w), toggle: toggle('way'), gm: true, hover: setHover }))) : null,
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => ((s.draft = null), (s.tool = 'way'), (s.wayFrom = d.id), render()) }, '+ Way from here')),
        el('div', { class: 'wv-where' }, el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => board.center(d.x, d.y, 8) }, 'Centre on it')),
        mapsEditor(d.maps, render, { push: pushMap(d) }),
      ],
      left: isNew ? [] : [
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => remove('plane', planeOf(d.id)) }, 'Delete'),
        pushButton('Push', () => pushPlace('plane', planeOf(d.id)), { title: 'Show this plane (as saved) on the player screen', ghost: true }),
      ],
    });
  }

  function wayEditor(d) {
    const isNew = !d.id;
    const planePick = (key, label) => el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, label),
      el('select', { class: 'tp-select', onChange: (e) => ((d[key] = e.target.value), render()) },
        s.planes.map((p) => el('option', { value: p.id, selected: d[key] === p.id }, `${p.name}${p.revealed ? '' : ' (hidden)'}`))));
    const check = (key, label, note) => el('label', { class: 'pl-check' },
      el('input', { type: 'checkbox', checked: d[key], onChange: (e) => ((d[key] = e.target.checked), render()) }),
      el('span', {}, label, el('span', { class: 'tp-dim wv-note' }, ` ${note}`)));
    const ends = [planeOf(d.from), planeOf(d.to)];
    return editorForm({
      title: isNew ? 'New way' : 'Edit way',
      close: closeEditor,
      save: saveDraft,
      isNew,
      saveLabel: isNew ? 'Open the way' : 'Save',
      fields: [
        nameField(d, { placeholder: 'e.g. The Mushroom Ring', onInput: draw }),
        kindField('Kind', WAY_KINDS, d, render),
        el('div', { class: 'pl-ends' }, planePick('from', 'From'), planePick('to', 'To')),
        check('oneWay', 'One way only', `(from ${ends[0]?.name ?? '?'} to ${ends[1]?.name ?? '?'})`),
        check('hint', 'Hint at it', '(players see a “?” leading off a plane they know, until they know the way)'),
        descField(d, 'Where it opens, what it takes to pass… (optional)'),
        visField(d, render, {
          shownNote: ends.every((p) => p?.revealed) ? 'Players know of this way.' : 'Revealed, but players see it only once both its planes are revealed.',
          hiddenNote: 'Only you can see this way until you reveal it.',
        }),
        mapsEditor(d.maps, render, { push: pushMap(d) }),
      ],
      left: isNew ? [] : [
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => remove('way', wayOf(d.id)) }, 'Delete'),
        pushButton('Push', () => pushPlace('way', wayOf(d.id)), { title: 'Show this way (as saved) on the player screen', ghost: true }),
      ],
    });
  }

  function playersCard(id) {
    const card = planarCard(id, s.planes, s.ways);
    if (!card) return listPanel();
    const p = planeOf(id);
    return el('div', { class: 'wv-editor' },
      sideHead(card.name, closeEditor),
      placeCardView(card, { panel: false, push: pushMap(card) }),
      p ? el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => board.center(p.x, p.y, 8) }, 'Centre on it') : null);
  }

  function listPanel() {
    const gm = s.viewAs === 'gm';
    const data = shown();
    const q = s.query.trim().toLowerCase();
    const match = (x) => !q || x.name.toLowerCase().includes(q);
    const planes = (gm ? s.planes : s.planes.filter((p) => data.planes.some((x) => x.id === p.id))).filter(match);
    const ways = (gm ? s.ways : s.ways.filter((w) => data.ways.some((x) => x.id === w.id))).filter(match);
    const tabs = listTabs([['planes', `Planes (${gm ? s.planes.length : data.planes.length})`], ['ways', `Ways (${gm ? s.ways.length : data.ways.length})`]], s.tab, (t) => ((s.tab = t), render()));
    const search = searchBox(s.query, s.tab === 'planes' ? 'Find a plane…' : 'Find a way…', (v) => {
      s.query = v;
      const next = listPanel();
      side.replaceChildren(next);
      const box = next.querySelector('input[type="search"]');
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    });
    const body = s.tab === 'planes'
      ? (planes.length
          ? el('ul', { class: 'wv-items' }, planes.map((p) => row({ item: p, g: planeKind(p.kind).glyph, sub: planeKind(p.kind).label, onPick: () => (board.center(p.x, p.y), open('plane', p)), toggle: toggle('plane'), gm, hover: setHover })))
          : el('p', { class: 'tp-dim wv-note' }, s.planes.length ? 'Nothing matches.' : gm ? 'No planes yet. Use “+ Plane” or Shift+click the board.' : 'No planes revealed yet.'))
      : (ways.length
          ? el('ul', { class: 'wv-items' }, ways.map((w) => row({ item: w, g: wayKind(w.kind).glyph, sub: `${planeOf(w.from)?.name ?? '?'} ${w.oneWay ? '→' : '⇄'} ${planeOf(w.to)?.name ?? '?'}`, onPick: () => open('way', w), toggle: toggle('way'), gm, hover: setHover })))
          : el('p', { class: 'tp-dim wv-note' }, s.ways.length ? 'Nothing matches.' : gm ? 'No ways yet. Use “+ Way”, then click two planes.' : 'No ways known yet.'));
    return el('div', { class: 'wv-list' },
      tabs,
      el('p', { class: 'tp-dim wv-note' }, gm
        ? 'A way shows to players once it and both its planes are revealed.'
        : `Showing what players know: ${data.planes.length} of ${s.planes.length} planes, ${data.ways.length} of ${s.ways.length} ways.`),
      search,
      body);
  }

  function setHover(id) {
    if (s.hover === id) return;
    s.hover = id;
    draw();
  }

  function renderHud() {
    const gm = s.viewAs === 'gm';
    planeBtn.hidden = !gm;
    wayBtn.hidden = !gm;
    planeBtn.textContent = s.tool === 'plane' ? 'Click the board… (Esc)' : '+ Plane';
    wayBtn.textContent = s.tool === 'way' ? (s.wayFrom ? `From ${planeOf(s.wayFrom)?.name ?? '?'}: pick the other plane…` : 'Pick the first plane… (Esc)') : '+ Way';
    for (const [b, on] of [[planeBtn, s.tool === 'plane'], [wayBtn, s.tool === 'way']]) {
      b.classList.toggle('tp-btn--interactive', on);
      b.setAttribute('aria-pressed', String(on));
    }
    board.stage.classList.toggle('is-placing', s.tool === 'plane');
    board.stage.classList.toggle('is-linking', s.tool === 'way');
    viewHost.replaceChildren(viewAsField(s.viewAs, (v) => {
      s.viewAs = v;
      s.draft = null;
      s.viewing = null;
      s.tool = null;
      s.wayFrom = null;
      render();
    }));
  }

  function render() {
    renderHud();
    draw();
    const d = s.draft && s.viewAs === 'gm' ? s.draft : null;
    const key = d ? `edit:${d.kind}:${d.item.id ?? 'new'}` : s.viewing ? `card:${s.viewing}` : `list:${s.tab}`;
    const keep = side.dataset.panel === key ? side.scrollTop : 0;
    side.replaceChildren(d ? (d.kind === 'plane' ? planeEditor(d.item) : wayEditor(d.item)) : s.viewing ? playersCard(s.viewing) : listPanel());
    side.dataset.panel = key;
    side.scrollTop = keep;
    stageClass();
  }
  const stageClass = () => board.stage.parentElement?.classList.toggle('is-players', s.viewAs === 'players');

  const onKey = (e) => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (s.tool) setTool(null);
    else if (s.draft || s.viewing) closeEditor();
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
