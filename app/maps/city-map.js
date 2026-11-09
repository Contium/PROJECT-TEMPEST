// City Map (#/worldview/<slug>, or #/starmap/<slug> on a Galactic project): the map
// of a unique location, opened from its POI on the World View globe or the star map. Night City is the first: the 2045 atlas, with its
// districts traced (scripts/extract-districts.py) into outlines laid over it.
//
// Drag to pan, scroll to zoom. Hovering a district lights it up; clicking selects
// it and opens it in the side panel. The atlas comes in layers (districts,
// streets, locations, everything), switched from the HUD.
//
// Points of interest: "Place POI" (or Shift+click) puts one on the map. It is
// filed under the district it lands in, found from the outlines. Each has one of
// twelve icons, is hidden from players until revealed, and can carry GM-only
// references to anything in the project and attached maps (uploaded images).

import { el, store, toast, toastError, confirmDialog } from '../ui.js';
import { pois as globeApi, cityPois as api, allEntities, currentProjectId } from '../api.js';
import { UNIQUE_POIS } from './poi-model.js';
import { formatLonLat } from './globe-math.js';
import { CITY_MAPS, prepareDistricts, pathOf, fitMap, fitBox, clampView, zoomAt, zoomWithin, relativeZoom, shareOf, districtAt, toImage } from './city-map-model.js';
import { CITY_POI_ICONS, iconOf, MAX_REFS } from './city-poi-model.js';
import { mapsEditor, mapsGallery } from './attached-maps.js';
import { push, revealAndPush, pushButton } from '../push/push.js';
import { hrefOf, categoryOf } from '../forge/entity-model.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
/** One of the twelve POI icons as an inline SVG. */
const icon = (id, cls = 'cm-icon') => {
  const s = svg('svg', { viewBox: '0 0 24 24', class: cls, 'aria-hidden': 'true' });
  s.append(svg('path', { d: iconOf(id).d }));
  return s;
};
/** What an entity is, for badges: NPC, Rumor, Item… */
const kindLabel = (e) => categoryOf(e.kind, e.category)?.label ?? (e.kind === 'items' ? 'Item' : 'Entry');

const districtCache = new Map(); // slug -> raw JSON, once per session
async function loadDistricts(map) {
  if (!districtCache.has(map.slug)) {
    const res = await fetch(`${map.base}/districts.json`);
    if (!res.ok) throw new Error(`Couldn't load the district outlines (${res.status})`);
    districtCache.set(map.slug, await res.json());
  }
  return prepareDistricts(districtCache.get(map.slug), map);
}

export async function mount(root, { slug, project, back: from = { href: '#/worldview', label: 'World View' } }) {
  const base = UNIQUE_POIS.find((u) => u.slug === slug);
  // Is it on this project's map? (Switched on, and a map system that carries it.)
  const live = base ? (await globeApi.list().catch(() => [])).find((p) => p.id === base.id) : null;
  const map = CITY_MAPS[slug];
  const back = el('a', { class: 'app-link', href: from.href }, `← ${from.label}`);

  if (!live || !map) {
    root.replaceChildren(el('article', { class: 'tp-frame tp-panel app-placeholder' },
      el('div', { class: 'tp-panel__body' },
        el('p', { class: 'tp-h3' }, base ? `${base.name} isn't on this project's map` : 'No such city map'),
        el('p', { class: 'tp-muted' }, base ? 'Turn it on under Unique locations in Project settings (Planetary or Galactic maps).' : 'This address doesn\'t lead to a city map.'),
        el('span', { class: 'app-row' }, back, base ? el('a', { class: 'tp-frame tp-btn tp-btn--sm', href: '#/settings' }, 'Project settings') : null))));
    return {};
  }

  const layerKey = `tempest.${currentProjectId()}.citymap.${slug}.layer`;
  const s = {
    districts: [],
    hover: null, // district id under the pointer (or the list)
    selected: null, // district id
    layer: map.layers.some((l) => l.id === store.get(layerKey)) ? store.get(layerKey) : map.layers[0].id,
    outlines: store.get('tempest.citymap.outlines') !== 'false',
    view: null, // { x, y, scale }, set once the stage has a size
    query: '',
    tab: store.get('tempest.citymap.tab') === 'pois' ? 'pois' : 'districts', // the list's tab
    pois: [],
    viewAs: 'gm', // 'gm' | 'players'
    placing: false, // the next click on the map places a new POI
    moving: false, // the next click moves the draft
    draft: null, // the POI being edited (a copy), or a new one (no id)
    viewing: null, // players' view: id of the POI being looked at
    entities: null, // the project's pool, loaded when first needed
    refQuery: '',
  };

  // --- the stage: image + district overlay, moved together; markers on top ------------------------

  const img = el('img', { class: 'cm-img', alt: `${live.name} atlas`, draggable: 'false', width: map.width, height: map.height });
  const overlay = svg('svg', { class: 'cm-overlay', viewBox: `0 0 ${map.width} ${map.height}`, width: map.width, height: map.height });
  const world = el('div', { class: 'cm-world' }, img, overlay);
  const markerLayer = el('div', { class: 'cm-markers' });
  const tip = el('div', { class: 'cm-tip', role: 'status', 'aria-live': 'polite', hidden: true });
  const stage = el('div', {
    class: 'cm-stage', tabindex: 0,
    'aria-label': `${live.name} city map. Hover a district to highlight it, click to select it; Place POI or Shift+click puts a point of interest down. Drag to pan, scroll to zoom; arrow keys, + and −, 0 to fit and Escape work too.`,
  }, world, markerLayer, tip);

  const readout = { zoom: el('span', { class: 'wv-value tp-mono' }, '1.0×'), district: el('span', { class: 'wv-value' }, '—') };
  const layerSeg = el('span', { class: 'fd-seg', role: 'group', 'aria-label': 'Map layer' });
  const viewSeg = el('span', { class: 'fd-seg', role: 'group', 'aria-label': 'View as' });
  const outlineBtn = el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => setOutlines(!s.outlines) });
  const placeBtn = el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => setPlacing(!s.placing) });
  const hud = el('div', { class: 'wv-hud' },
    el('div', { class: 'wv-readouts' },
      el('div', { class: 'wv-readout' }, el('span', { class: 'tp-label' }, 'District'), readout.district),
      el('div', { class: 'wv-readout' }, el('span', { class: 'tp-label' }, 'Zoom'), readout.zoom)),
    el('div', { class: 'wv-controls' },
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', 'aria-label': 'Zoom in', onClick: () => zoomCenter(1.3) }, '+'),
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', 'aria-label': 'Zoom out', onClick: () => zoomCenter(1 / 1.3) }, '−'),
      outlineBtn,
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive', onClick: () => fit() }, 'Fit')),
    el('div', { class: 'wv-controls' }, placeBtn, pushButton('Push map', () => pushCity(s.selected), { title: 'Show the city map on the player screen (the selected district lit), with the revealed points' })),
    el('div', { class: 'wv-controls' }, el('span', { class: 'tp-label wv-viewas' }, 'Layer'), layerSeg),
    el('div', { class: 'wv-controls' }, viewSeg));
  const side = el('aside', { class: 'wv-side cm-side', 'aria-label': 'Districts and points of interest' });
  const help = el('p', { class: 'wv-help tp-dim' }, 'Hover a district to highlight it · click to select · Shift+click to place a POI · drag to pan · scroll to zoom');
  const frame = el('div', { class: 'cm-frame' }, stage, hud, side, help);

  root.replaceChildren(
    el('div', { class: 'cm' },
      el('div', { class: 'cv-bar' },
        back,
        el('span', { class: 'app-row' },
          el('span', { class: 'tp-badge tp-badge--interactive' }, 'Unique City'),
          el('span', { class: `tp-badge ${live.revealed ? 'tp-badge--interactive' : ''}` }, live.revealed ? 'Revealed to players' : 'Hidden from players'))),
      el('section', { class: 'tp-frame tp-panel cm-panel', 'aria-label': `${live.name} city map` },
        el('header', { class: 'tp-panel__head' },
          el('h2', { class: 'tp-panel__title' }, `City Map // ${live.name}`),
          el('span', { class: 'tp-mono tp-dim' }, formatLonLat(live))),
        frame)),
  );
  document.title = `TEMPEST · ${live.name}`;

  try {
    [s.districts, s.pois] = await Promise.all([loadDistricts(map), api.list(slug)]);
  } catch (err) {
    side.replaceChildren(el('p', { class: 'app-error' }, err.message));
  }
  const byId = new Map(s.districts.map((d) => [d.id, d]));
  const paths = new Map();
  for (const d of s.districts) {
    const p = svg('path', { d: pathOf(d.rings), class: 'cm-district', 'data-id': d.id });
    p.append(Object.assign(svg('title'), { textContent: d.name }));
    paths.set(d.id, p);
    overlay.append(p);
  }
  const districtName = (id) => byId.get(id)?.name ?? 'Outside the districts';
  /** The district under a map point (0..1), or null. */
  const detect = (x, y) => districtAt(s.districts, [x * map.width, y * map.height])?.id ?? null;

  // --- view ----------------------------------------------------------------------------------

  const viewport = () => ({ width: stage.clientWidth, height: stage.clientHeight });
  function apply() {
    if (!s.view) return;
    s.view = clampView(s.view, map, viewport());
    const { x, y, scale } = s.view;
    world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    readout.zoom.textContent = `${relativeZoom(s.view, map, viewport()).toFixed(1)}×`;
    placeMarkers();
  }
  // The part of the stage not covered by the side panel (on wide screens).
  const open = () => {
    const { width, height } = viewport();
    const panel = width > 760 ? Math.min(side.offsetWidth + 24, width / 2) : 0;
    return { width: width - panel, height };
  };
  // "Fit" frames the city itself (the districts), not the whole atlas sheet.
  const cityBounds = () => (s.districts.length
    ? s.districts.reduce((b, d) => ({ x0: Math.min(b.x0, d.bounds.x0), y0: Math.min(b.y0, d.bounds.y0), x1: Math.max(b.x1, d.bounds.x1), y1: Math.max(b.y1, d.bounds.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
    : { x0: 0, y0: 0, x1: map.width, y1: map.height });
  let touched = false; // until the GM pans or zooms, a resize re-fits
  const fit = () => ((touched = false), (s.view = fitBox(cityBounds(), open(), 20)), apply());
  const zoomCenter = (f) => {
    const { width, height } = open();
    s.view = zoomWithin(s.view, f, width / 2, height / 2, map, viewport());
    touched = true;
    apply();
  };
  function focusDistrict(d) {
    const area = open();
    const v = fitBox(d.bounds, area, 48);
    const cap = fitMap(map, viewport()).scale * 6; // small districts: don't zoom in absurdly
    s.view = v.scale > cap ? zoomAt(v, cap / v.scale, area.width / 2, area.height / 2) : v;
    touched = true;
    apply();
  }
  /** Bring a map point (0..1) into the middle of the open area, zooming in if far out. */
  function focusPoint(x, y) {
    const area = open();
    const want = Math.max(s.view.scale, fitMap(map, viewport()).scale * 4);
    s.view = { scale: want, x: area.width / 2 - x * map.width * want, y: area.height / 2 - y * map.height * want };
    touched = true;
    apply();
  }

  // --- markers ---------------------------------------------------------------------------------

  const visiblePois = () => (s.viewAs === 'players' ? s.pois.filter((p) => p.revealed) : s.pois);
  function renderMarkers() {
    const list = visiblePois().map((p) => (s.draft?.id === p.id ? { ...s.draft, id: p.id } : p));
    if (s.draft && !s.draft.id) list.push({ ...s.draft, id: '__new', name: s.draft.name || 'New point' });
    markerLayer.replaceChildren(...list.map((p) => {
      const current = p.id === s.draft?.id || (p.id === '__new') || p.id === s.viewing;
      return el('button', {
        type: 'button',
        class: `cm-marker ${p.revealed ? '' : 'is-hidden'} ${current ? 'is-current' : ''} ${p.id === '__new' ? 'is-pending' : ''}`,
        'data-poi': p.id, 'data-x': p.x, 'data-y': p.y,
        title: `${p.name}${p.revealed ? '' : ' (hidden)'}`,
        'aria-label': `${p.name}, ${iconOf(p.icon).label}${p.revealed ? '' : ', hidden from players'}`,
        onPointerdown: (e) => e.stopPropagation(),
        onClick: (e) => {
          e.stopPropagation();
          if (p.id !== '__new') openPoi(s.pois.find((q) => q.id === p.id));
        },
      }, icon(p.icon), el('span', { class: 'cm-marker__name' }, p.name));
    }));
    placeMarkers();
  }
  function placeMarkers() {
    if (!s.view) return;
    for (const m of markerLayer.children) {
      m.style.transform = `translate(${s.view.x + Number(m.dataset.x) * map.width * s.view.scale}px, ${s.view.y + Number(m.dataset.y) * map.height * s.view.scale}px)`;
    }
  }

  // --- highlight and selection -----------------------------------------------------------------

  function paint() {
    for (const [id, p] of paths) {
      p.classList.toggle('is-hover', id === s.hover);
      p.classList.toggle('is-selected', id === s.selected);
      p.classList.toggle('is-dim', Boolean(s.selected) && id !== s.selected && id !== s.hover);
    }
    overlay.classList.toggle('is-outlined', s.outlines);
    const shown = byId.get(s.hover) ?? byId.get(s.selected);
    readout.district.textContent = shown?.name ?? '—';
    for (const li of side.querySelectorAll('[data-id]')) li.classList.toggle('is-hover', li.dataset.id === s.hover);
  }
  function setHover(id) {
    if (s.hover === id) return;
    s.hover = id;
    paint();
  }
  function select(id, { zoom = false } = {}) {
    s.selected = id;
    s.hover = null;
    s.draft = null;
    s.viewing = null;
    s.moving = false;
    tip.hidden = true;
    render();
    if (zoom && id) focusDistrict(byId.get(id));
  }
  function setOutlines(on) {
    s.outlines = on;
    store.set('tempest.citymap.outlines', on);
    outlineBtn.textContent = `Outlines: ${on ? 'on' : 'off'}`;
    outlineBtn.setAttribute('aria-pressed', String(on));
    paint();
  }
  function setLayer(id) {
    s.layer = id;
    store.set(layerKey, id);
    const layer = map.layers.find((l) => l.id === id);
    stage.classList.add('is-loading');
    img.onload = () => stage.classList.remove('is-loading');
    img.src = `${map.base}/${layer.file}`;
    layerSeg.replaceChildren(...map.layers.map((l) =>
      el('button', { type: 'button', class: `fd-seg__btn ${l.id === id ? 'is-on' : ''}`, 'aria-pressed': String(l.id === id), onClick: () => setLayer(l.id) }, l.label)));
  }
  function setPlacing(on) {
    s.placing = on && s.viewAs === 'gm';
    s.moving = false;
    renderHud();
  }
  function renderHud() {
    placeBtn.hidden = s.viewAs !== 'gm';
    placeBtn.textContent = s.placing ? 'Click the map… (Esc to stop)' : '+ Place POI';
    placeBtn.classList.toggle('tp-btn--interactive', s.placing);
    placeBtn.setAttribute('aria-pressed', String(s.placing));
    stage.classList.toggle('is-placing', s.placing || s.moving);
    viewSeg.replaceChildren(...[['gm', 'GM view'], ['players', 'Player view']].map(([v, label]) =>
      el('button', {
        type: 'button', class: `fd-seg__btn ${s.viewAs === v ? 'is-on' : ''}`, 'aria-pressed': String(s.viewAs === v),
        onClick: () => {
          s.viewAs = v;
          s.draft = null;
          s.viewing = null;
          s.placing = false;
          s.moving = false;
          render();
        },
      }, label)));
  }

  // --- POIs: placing, editing, saving ------------------------------------------------------------

  function openPoi(poi) {
    if (!poi) return;
    s.selected = null;
    s.placing = false;
    s.moving = false;
    if (s.viewAs === 'players') {
      s.viewing = poi.id;
      s.draft = null;
    } else {
      s.viewing = null;
      s.draft = structuredClone(poi);
      loadEntities();
    }
    render();
  }
  function placeAt(x, y) {
    const district = detect(x, y);
    if (s.moving && s.draft) {
      Object.assign(s.draft, { x, y, district });
      s.moving = false;
    } else {
      s.selected = null;
      s.viewing = null;
      // An unsaved new point keeps what was typed; it just moves.
      s.draft = s.draft && !s.draft.id
        ? { ...s.draft, x, y, district }
        : { city: slug, name: '', icon: 'pin', description: '', revealed: false, x, y, district, refs: [], maps: [] };
      s.placing = false;
      loadEntities();
    }
    render();
    side.querySelector('[name="name"]')?.focus();
  }
  function closeEditor() {
    s.draft = null;
    s.viewing = null;
    s.moving = false;
    render();
  }
  async function saveDraft() {
    try {
      if (s.draft.id) {
        const saved = await api.save(s.draft);
        s.pois = s.pois.map((p) => (p.id === saved.id ? saved : p));
        toast(`Saved "${saved.name}"`, { tone: 'success' });
      } else {
        const made = await api.create(s.draft);
        s.pois = [...s.pois, made].sort((a, b) => a.name.localeCompare(b.name));
        toast(`Placed "${made.name}" in ${districtName(made.district)}`, { tone: 'success' });
      }
      closeEditor();
    } catch (err) {
      toastError(err);
    }
  }
  async function toggleReveal(poi) {
    try {
      const saved = await api.save({ ...poi, revealed: !poi.revealed });
      s.pois = s.pois.map((p) => (p.id === saved.id ? saved : p));
      if (s.draft?.id === saved.id) s.draft.revealed = saved.revealed;
      toast(saved.revealed ? `"${saved.name}" is revealed to players` : `"${saved.name}" is hidden from players`);
      render();
    } catch (err) {
      toastError(err);
    }
  }
  async function remove(poi) {
    if (!(await confirmDialog({ title: `Delete "${poi.name}"?`, body: 'This point of interest will be removed from the city map for good. What it references is not touched.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.remove(poi.id);
      s.pois = s.pois.filter((p) => p.id !== poi.id);
      toast(`Deleted "${poi.name}"`);
      closeEditor();
    } catch (err) {
      toastError(err);
    }
  }
  // --- pushing to the player screen -----------------------------------------------------------

  /** The city map (a district lit, or the whole city) on the player screen. */
  const pushCity = (district) => push({ mode: 'citymap', city: slug, layer: s.layer, district: district ?? null });
  /** One point on the player screen; a hidden one is revealed first (after asking). */
  function pushPoi(poi) {
    return revealAndPush(poi, async () => {
      const saved = await api.save({ ...poi, revealed: true });
      s.pois = s.pois.map((p) => (p.id === saved.id ? saved : p));
      if (s.draft?.id === saved.id) s.draft.revealed = true;
      render();
    }, { mode: 'citypoi', city: slug, id: poi.id });
  }

  async function loadEntities() {
    if (s.entities) return;
    try {
      s.entities = await allEntities();
      if (s.draft) render();
    } catch (err) {
      toastError(err);
    }
  }
  // --- side panel ------------------------------------------------------------------------------

  const visBadge = (revealed) => el('span', { class: `tp-badge ${revealed ? 'tp-badge--interactive' : ''} wv-vis` }, revealed ? 'Revealed' : 'Hidden');
  const eyeBtn = (p) => el('button', { type: 'button', class: 'fd-icon-btn wv-item__eye', title: p.revealed ? 'Hide from players' : 'Reveal to players', 'aria-label': `${p.revealed ? 'Hide' : 'Reveal'} ${p.name}`, onClick: () => toggleReveal(p) }, p.revealed ? '◉' : '◌');

  function poiRows(list) {
    return el('ul', { class: 'wv-items' },
      list.map((p) =>
        el('li', { class: `wv-item cm-poi-row ${p.revealed ? '' : 'is-hidden'}` },
          el('button', { type: 'button', class: 'wv-item__pick', onClick: () => (focusPoint(p.x, p.y), openPoi(p)) },
            icon(p.icon, 'cm-icon cm-icon--row'),
            el('span', { class: 'wv-item__text' }, el('span', { class: 'wv-item__name' }, p.name), el('span', { class: 'tp-dim wv-item__type' }, iconOf(p.icon).label))),
          s.viewAs === 'gm' ? eyeBtn(p) : el('span'),
          visBadge(p.revealed))));
  }

  function districtPanel(d) {
    const i = s.districts.indexOf(d);
    const step = (n) => select(s.districts[(i + n + s.districts.length) % s.districts.length].id, { zoom: true });
    const here = visiblePois().filter((p) => p.district === d.id);
    return el('div', { class: 'wv-editor' },
      el('header', { class: 'wv-side__head' },
        el('h2', { class: 'tp-panel__title' }, d.name),
        el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': 'Close', onClick: () => select(null) }, '×')),
      el('p', { class: 'app-row' }, el('span', { class: 'tp-badge tp-badge--interactive' }, 'District'), el('span', { class: 'tp-dim' }, live.name)),
      el('div', { class: 'cm-stats' },
        el('div', { class: 'wv-readout' }, el('span', { class: 'tp-label' }, 'Share'), el('span', { class: 'wv-value tp-mono' }, `${shareOf(d, s.districts).toFixed(1)}% of the city`)),
        el('div', { class: 'wv-readout' }, el('span', { class: 'tp-label' }, 'POIs'), el('span', { class: 'wv-value tp-mono' }, String(here.length)))),
      el('div', { class: 'wv-where' },
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive', onClick: () => focusDistrict(d) }, 'Zoom to'),
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => fit() }, 'Whole city'),
        s.viewAs === 'gm' ? el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => (focusDistrict(d), setPlacing(true)) }, '+ POI here') : null,
        pushButton('Push district', () => pushCity(d.id), { title: `Show ${d.name} on the player screen` })),
      el('h3', { class: 'tp-label cm-subhead' }, `Points of interest in ${d.name}`),
      here.length ? poiRows(here) : el('p', { class: 'tp-dim wv-note' }, s.viewAs === 'gm' ? 'None yet. Place one with “+ POI here”.' : 'None revealed here.'),
      el('div', { class: 'wv-editor__actions' },
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', 'aria-label': 'Previous district', onClick: () => step(-1) }, '‹ Prev'),
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => select(null) }, 'All districts'),
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', 'aria-label': 'Next district', onClick: () => step(1) }, 'Next ›')));
  }

  function listPanel() {
    const q = s.query.trim().toLowerCase();
    const pois = visiblePois();
    const count = (id) => pois.filter((p) => p.district === id).length;
    const setTab = (t) => ((s.tab = t), store.set('tempest.citymap.tab', t), render());
    const tabs = el('span', { class: 'fd-seg cm-tabs', role: 'group', 'aria-label': 'Show' },
      [['districts', `Districts (${s.districts.length})`], ['pois', `POIs (${pois.length})`]].map(([v, label]) =>
        el('button', { type: 'button', class: `fd-seg__btn ${s.tab === v ? 'is-on' : ''}`, 'aria-pressed': String(s.tab === v), onClick: () => setTab(v) }, label)));
    const search = el('input', {
      class: 'tp-input', type: 'search', placeholder: s.tab === 'pois' ? 'Find a point of interest…' : 'Find a district…', value: s.query, 'aria-label': 'Search',
      onInput: (e) => {
        s.query = e.target.value;
        const next = listPanel();
        side.replaceChildren(next);
        const box = next.querySelector('input[type="search"]');
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
        paint();
      },
    });

    let body;
    if (s.tab === 'pois') {
      const shown = pois.filter((p) => !q || p.name.toLowerCase().includes(q) || districtName(p.district).toLowerCase().includes(q));
      // Grouped by district, in district order; those outside every district last.
      const groups = [...s.districts.map((d) => d.id), null]
        .map((id) => [id, shown.filter((p) => p.district === id)])
        .filter(([, list]) => list.length);
      body = groups.length
        ? el('div', { class: 'cm-groups' }, groups.map(([id, list]) =>
            el('section', { class: 'cm-group' },
              el('h3', { class: 'tp-label cm-subhead' }, el('button', { type: 'button', class: 'cm-group__name', onClick: () => id && select(id, { zoom: true }) }, districtName(id)), el('span', { class: 'tp-dim' }, ` · ${list.length}`)),
              poiRows(list))))
        : el('p', { class: 'tp-dim wv-note' }, s.pois.length ? 'Nothing matches.' : (s.viewAs === 'gm' ? 'No points of interest yet. Use “+ Place POI” or Shift+click the map.' : 'No points of interest revealed yet.'));
    } else {
      const shown = s.districts.filter((d) => !q || d.name.toLowerCase().includes(q));
      body = shown.length
        ? el('ul', { class: 'wv-items' },
            shown.map((d) =>
              el('li', { class: 'wv-item cm-item', 'data-id': d.id },
                el('button', {
                  type: 'button', class: 'wv-item__pick',
                  onClick: () => select(d.id, { zoom: true }),
                  onPointerenter: () => setHover(d.id),
                  onPointerleave: () => setHover(null),
                  onFocus: () => setHover(d.id),
                  onBlur: () => setHover(null),
                },
                  el('span', { class: 'wv-glyph', 'aria-hidden': 'true' }, '⬡'),
                  el('span', { class: 'wv-item__text' }, el('span', { class: 'wv-item__name' }, d.name))),
                el('span', { class: 'tp-dim tp-mono cm-share', title: 'Points of interest' }, count(d.id) ? `${count(d.id)} POI` : ''))))
        : el('p', { class: 'tp-dim wv-note' }, 'No district matches.');
    }
    return el('div', { class: 'wv-list' },
      tabs,
      el('p', { class: 'tp-dim wv-note' }, s.viewAs === 'players'
        ? `Showing what players see: ${pois.length} of ${s.pois.length} points revealed.`
        : 'Hover the map to highlight a district; click to select it. Shift+click places a POI.'),
      search,
      body);
  }

  function refsEditor(d) {
    const pool = s.entities ?? [];
    const byEntity = new Map(pool.map((e) => [e.id, e]));
    const q = s.refQuery.trim().toLowerCase();
    const taken = new Set(d.refs.map((r) => r.id));
    const matches = q
      ? pool.filter((e) => !taken.has(e.id) && (e.name.toLowerCase().includes(q) || kindLabel(e).toLowerCase().includes(q))).slice(0, 8)
      : [];
    const add = (e) => {
      if (d.refs.length >= MAX_REFS) return toast(`Up to ${MAX_REFS} references`);
      d.refs.push({ id: e.id, note: '' });
      s.refQuery = '';
      render();
      side.querySelector('.cm-ref-search')?.focus();
    };
    return el('div', { class: 'tp-field cm-refs' },
      el('span', { class: 'tp-label' }, 'References ', el('span', { class: 'tp-dim' }, '(GM only)')),
      d.refs.length
        ? el('ul', { class: 'cm-ref-list' }, d.refs.map((r, i) => {
            const e = byEntity.get(r.id);
            return el('li', { class: 'cm-ref' },
              el('div', { class: 'cm-ref__head' },
                el('span', { class: 'tp-badge cm-ref__kind' }, e ? kindLabel(e) : '?'),
                e ? el('a', { class: 'app-link cm-ref__name', href: hrefOf(e) }, e.name) : el('span', { class: 'tp-dim cm-ref__name' }, s.entities ? 'Missing (deleted?)' : 'Loading…'),
                el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': `Remove ${e?.name ?? 'reference'}`, onClick: () => (d.refs.splice(i, 1), render()) }, '×')),
              el('input', { class: 'tp-input cm-ref__note', value: r.note, maxlength: 200, placeholder: 'Note (optional): how it ties in…', 'aria-label': 'Note', onInput: (ev) => (r.note = ev.target.value) }));
          }))
        : null,
      el('input', {
        class: 'tp-input cm-ref-search', type: 'search', value: s.refQuery, autocomplete: 'off',
        placeholder: s.entities ? (pool.length ? 'Add: search characters, events, stories, items…' : 'Nothing in this project yet') : 'Loading…',
        'aria-label': 'Add a reference',
        onInput: (ev) => {
          s.refQuery = ev.target.value;
          render();
          const box = side.querySelector('.cm-ref-search');
          box.focus();
          box.setSelectionRange(box.value.length, box.value.length);
        },
        onKeydown: (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            if (matches[0]) add(matches[0]);
          }
        },
      }),
      matches.length
        ? el('ul', { class: 'cm-ref-results', role: 'listbox' }, matches.map((e) =>
            el('li', {}, el('button', { type: 'button', class: 'cm-ref-result', onClick: () => add(e) },
              el('span', { class: 'tp-badge cm-ref__kind' }, kindLabel(e)), el('span', {}, e.name)))))
        : q ? el('p', { class: 'tp-dim wv-note' }, 'No match.') : null);
  }

  function editor() {
    const d = s.draft;
    const isNew = !d.id;
    return el('form', {
      class: 'wv-editor',
      onSubmit: (e) => {
        e.preventDefault();
        saveDraft();
      },
    },
      el('header', { class: 'wv-side__head' },
        el('h2', { class: 'tp-panel__title' }, isNew ? 'New point of interest' : 'Edit point of interest'),
        el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': 'Close', onClick: closeEditor }, '×')),
      el('div', { class: 'cm-stats' },
        el('div', { class: 'wv-readout' }, el('span', { class: 'tp-label' }, 'District'),
          el('span', { class: 'wv-value' }, d.district ? el('button', { type: 'button', class: 'cm-group__name', onClick: () => focusDistrict(byId.get(d.district)) }, districtName(d.district)) : districtName(null))),
        el('p', { class: 'tp-dim wv-note' }, 'Found from where it sits; moving it re-files it.')),
      el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Name'),
        el('input', { class: 'tp-input', name: 'name', value: d.name, maxlength: 80, required: true, placeholder: 'e.g. Afterlife', autocomplete: 'off', onInput: (e) => ((d.name = e.target.value), renderMarkers()) })),
      el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, `Icon: ${iconOf(d.icon).label}`),
        el('div', { class: 'cm-icons', role: 'radiogroup', 'aria-label': 'Icon' },
          CITY_POI_ICONS.map((ic) =>
            el('button', {
              type: 'button', role: 'radio', class: `cm-icon-pick ${d.icon === ic.id ? 'is-on' : ''}`, 'aria-checked': String(d.icon === ic.id), title: ic.label, 'aria-label': ic.label,
              onClick: () => ((d.icon = ic.id), render()),
            }, icon(ic.id))))),
      el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Description'),
        el('textarea', { class: 'tp-textarea', name: 'description', rows: 3, maxlength: 2000, placeholder: 'What it is, who runs it… (optional)', onInput: (e) => (d.description = e.target.value) }, d.description)),
      el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Players'),
        el('span', { class: 'fd-seg', role: 'group', 'aria-label': 'Visibility to players' },
          [[false, 'Hidden'], [true, 'Revealed']].map(([v, label]) =>
            el('button', { type: 'button', class: `fd-seg__btn ${d.revealed === v ? 'is-on' : ''}`, 'aria-pressed': String(d.revealed === v), onClick: () => ((d.revealed = v), render()) }, label))),
        el('span', { class: 'tp-dim wv-note' }, d.revealed ? 'Players see it, its description and its maps (not your references).' : 'Only you can see this point until you reveal it.')),
      el('div', { class: 'wv-where' },
        el('button', { type: 'button', class: `tp-frame tp-btn tp-btn--sm ${s.moving ? 'tp-btn--interactive' : 'tp-btn--ghost'}`, onClick: () => ((s.moving = !s.moving), s.placing = false, render()) }, s.moving ? 'Click the map…' : 'Move'),
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => focusPoint(d.x, d.y) }, 'Centre on it')),
      refsEditor(d),
      mapsEditor(d.maps, render, { push: (m) => push({ mode: 'handout', image: m.image, caption: m.caption || d.name }) }),
      el('div', { class: 'wv-editor__actions' },
        isNew ? null : el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => remove(s.pois.find((p) => p.id === d.id)) }, 'Delete'),
        isNew ? null : pushButton('Push', () => pushPoi(s.pois.find((p) => p.id === d.id)), { title: 'Show this point (as saved) on the player screen', ghost: true }),
        el('span', { class: 'app-actions' },
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost', onClick: closeEditor }, 'Cancel'),
          el('button', { class: 'tp-frame tp-btn tp-btn--primary' }, isNew ? 'Place POI' : 'Save'))));
  }

  /** The players' view of a POI: read-only, no references. */
  function poiCard(p) {
    return el('div', { class: 'wv-editor' },
      el('header', { class: 'wv-side__head' },
        el('h2', { class: 'tp-panel__title' }, p.name),
        el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': 'Close', onClick: closeEditor }, '×')),
      el('p', { class: 'app-row' }, icon(p.icon, 'cm-icon cm-icon--row'), el('span', {}, iconOf(p.icon).label), el('span', { class: 'tp-dim' }, `· ${districtName(p.district)}`)),
      p.description ? el('p', { class: 'wv-note cm-desc' }, p.description) : el('p', { class: 'tp-dim wv-note' }, 'No description.'),
      mapsGallery(p.maps, { push: (m) => push({ mode: 'handout', image: m.image, caption: m.caption || p.name }) }),
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => focusPoint(p.x, p.y) }, 'Centre on it'));
  }

  function render() {
    renderHud();
    renderMarkers();
    const d = byId.get(s.selected);
    const viewing = s.pois.find((p) => p.id === s.viewing);
    if (s.districts.length) {
      // A different panel starts at its top; the same one keeps its scroll.
      const key = s.draft && s.viewAs === 'gm' ? `edit:${s.draft.id ?? 'new'}` : viewing ? `poi:${viewing.id}` : d ? `district:${d.id}` : `list:${s.tab}`;
      const keep = side.dataset.panel === key ? side.scrollTop : 0;
      side.replaceChildren(key.startsWith('edit') ? editor() : viewing ? poiCard(viewing) : d ? districtPanel(d) : listPanel());
      side.dataset.panel = key;
      side.scrollTop = keep;
    }
    paint();
  }

  // --- pointer and keys ------------------------------------------------------------------------

  let drag = null; // { id, sx, sy, vx, vy, moved }
  const districtOf = (target) => target?.closest?.('.cm-district')?.dataset.id ?? null;
  function showTip(e, id) {
    const d = byId.get(id);
    if (!d || drag?.moved) return (tip.hidden = true);
    const r = stage.getBoundingClientRect();
    tip.textContent = s.placing || s.moving ? `Place in ${d.name}` : d.name;
    tip.hidden = false;
    tip.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 14}px)`;
  }
  // The browser's own drag (a ghost copy of the atlas image following the pointer) and text
  // selection are blocked, so a press always pans; focus is given by hand instead.
  stage.addEventListener('dragstart', (e) => e.preventDefault());
  let frameReq = 0; // panning redraws at most once per frame
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stage.focus({ preventScroll: true });
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: s.view.x, vy: s.view.y, moved: false };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (drag && drag.id === e.pointerId) {
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) > 4) {
        drag.moved = true;
        stage.classList.add('is-dragging');
        tip.hidden = true;
      }
      if (drag.moved) {
        touched = true;
        s.view = { ...s.view, x: drag.vx + dx, y: drag.vy + dy };
        frameReq ||= requestAnimationFrame(() => ((frameReq = 0), apply()));
        return;
      }
    }
    // While captured, the event target is the stage: find what's really under the pointer.
    const under = drag ? document.elementFromPoint(e.clientX, e.clientY) : e.target;
    const id = districtOf(under);
    setHover(id);
    showTip(e, id);
  });
  const endDrag = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const wasClick = !drag.moved;
    drag = null;
    stage.classList.remove('is-dragging');
    if (!wasClick || e.type !== 'pointerup') return;
    if (s.viewAs === 'gm' && (s.placing || s.moving || e.shiftKey)) {
      const r = stage.getBoundingClientRect();
      const [ix, iy] = toImage(s.view, e.clientX - r.left, e.clientY - r.top);
      const x = ix / map.width;
      const y = iy / map.height;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) placeAt(x, y);
      return;
    }
    const id = districtOf(document.elementFromPoint(e.clientX, e.clientY));
    select(id && id === s.selected ? null : id);
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('pointerleave', () => {
    if (!drag) {
      setHover(null);
      tip.hidden = true;
    }
  });
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    s.view = zoomWithin(s.view, Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top, map, viewport());
    touched = true;
    apply();
  }, { passive: false });
  stage.addEventListener('dblclick', (e) => {
    if (s.placing || s.moving || e.shiftKey) return;
    const r = stage.getBoundingClientRect();
    s.view = zoomWithin(s.view, 2, e.clientX - r.left, e.clientY - r.top, map, viewport());
    touched = true;
    apply();
  });
  stage.addEventListener('keydown', (e) => {
    const pan = 60;
    const moves = { ArrowLeft: [pan, 0], ArrowRight: [-pan, 0], ArrowUp: [0, pan], ArrowDown: [0, -pan] };
    if (moves[e.key]) {
      touched = true;
      s.view = { ...s.view, x: s.view.x + moves[e.key][0], y: s.view.y + moves[e.key][1] };
      apply();
    } else if (e.key === '+' || e.key === '=') zoomCenter(1.3);
    else if (e.key === '-' || e.key === '_') zoomCenter(1 / 1.3);
    else if (e.key === '0') fit();
    else return;
    e.preventDefault();
  });
  const onKey = (e) => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (s.placing || s.moving) {
      s.placing = false;
      s.moving = false;
      render();
    } else if (s.draft || s.viewing) closeEditor();
    else if (s.selected) select(null);
  };
  document.addEventListener('keydown', onKey);

  // Fit once the stage has a size, and keep the map in bounds as the window changes.
  const resize = new ResizeObserver(() => (s.view && touched ? apply() : fit()));
  resize.observe(stage);

  setLayer(s.layer);
  setOutlines(s.outlines);
  render();
  fit(); // now, not only on the first resize callback (those wait for a frame to be drawn)

  return {
    unmount() {
      resize.disconnect();
      document.removeEventListener('keydown', onKey);
    },
  };
}
