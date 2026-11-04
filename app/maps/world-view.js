// World View (#/worldview): the Planetary map system. Shown as a section of its
// own while the open project's map system is Planetary (Project settings).
//
// The interactive Earth (globe.js) with a HUD of readouts and controls, and
// points of interest: click anywhere on the globe to place one (City,
// Landmark, Point of Interest, Other or Unknown), click a marker to edit it.
// Every POI is hidden from players until the GM reveals it; "View as Players"
// shows the globe with only the revealed ones.

import { el, toast, toastError, confirmDialog, store } from '../ui.js';
import { pois as api, currentProjectId } from '../api.js';
import { createGlobe } from './globe.js';
import { decodeRings, formatLonLat } from './globe-math.js';
import { POI_TYPES, typeOf } from './poi-model.js';
import * as cityMap from './city-map.js';
import { mapsEditor, mapsGallery } from './attached-maps.js';
import { push, revealAndPush, pushButton } from '../push/push.js';

let landRings = null; // decoded once per session
export async function land() {
  if (!landRings) {
    const res = await fetch('/app/vendor/land-110m.json');
    if (!res.ok) throw new Error(`Couldn't load the Earth's outlines (${res.status})`);
    landRings = decodeRings(await res.json(), 'land');
  }
  return landRings;
}

export async function mount(root, { engine, project, item }) {
  // /worldview/<slug>: a unique location's own map instead of the globe.
  if (item) return cityMap.mount(root, { slug: item, project });
  const s = {
    pois: [],
    selected: null, // id of the POI being edited
    draft: null, // { id?, name, type, description, revealed, lon, lat, maps } in the panel
    viewing: null, // players' view: id of the POI being looked at
    moving: false, // the next click on the globe moves the draft
    viewAs: 'gm', // 'gm' | 'players'
    filter: store.get(`tempest.${currentProjectId()}.pois.filter`) ?? '',
    show: 'all', // 'all' | 'revealed' | 'hidden'
  };

  // --- HUD (left) -----------------------------------------------------------------------

  const canvas = el('canvas', { class: 'wv-canvas', tabindex: 0, 'aria-label': 'Interactive globe of the Earth. Click to place a point of interest, click a marker to edit it. Drag to turn, scroll to zoom, double-click to fly to a point; arrow keys, + and −, Space and 0 work too.' });
  const readout = {
    center: el('span', { class: 'wv-value tp-mono' }, '—'),
    cursor: el('span', { class: 'wv-value tp-mono' }, '—'),
    zoom: el('span', { class: 'wv-value tp-mono' }, '1.0×'),
  };
  const spinBtn = el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', 'aria-pressed': 'true', onClick: () => globe.toggleSpin() }, 'Spin: on');
  const viewSeg = el('span', { class: 'fd-seg', role: 'group', 'aria-label': 'View as' });
  const hud = el('div', { class: 'wv-hud' },
    el('div', { class: 'wv-readouts' },
      el('div', { class: 'wv-readout' }, el('span', { class: 'tp-label' }, 'Centre'), readout.center),
      el('div', { class: 'wv-readout' }, el('span', { class: 'tp-label' }, 'Cursor'), readout.cursor),
      el('div', { class: 'wv-readout' }, el('span', { class: 'tp-label' }, 'Zoom'), readout.zoom)),
    el('div', { class: 'wv-controls' },
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', 'aria-label': 'Zoom in', onClick: () => globe.zoomBy(1.25) }, '+'),
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', 'aria-label': 'Zoom out', onClick: () => globe.zoomBy(0.8) }, '−'),
      spinBtn,
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive', onClick: () => globe.reset() }, 'Reset view')),
    el('div', { class: 'wv-controls' }, el('span', { class: 'tp-label wv-viewas' }, 'View as'), viewSeg),
    el('div', { class: 'wv-controls' }, pushButton('Push view', pushView, { title: 'Show the globe on the player screen as you see it now, with the revealed points' })));
  const side = el('aside', { class: 'wv-side', 'aria-label': 'Points of interest' });
  const stage = el('div', { class: 'wv-stage' }, canvas, hud, side,
    el('p', { class: 'wv-help tp-dim' }, 'Click to place a POI · drag to turn · scroll to zoom · double-click to fly there'));

  // The section shell already shows the "World View" heading.
  root.replaceChildren(el('section', { class: 'tp-frame tp-panel wv-panel', 'aria-label': `${project?.name ?? 'Project'}: planetary map` }, stage));

  let rings;
  try {
    [rings, s.pois] = await Promise.all([land(), api.list()]);
  } catch (err) {
    stage.replaceChildren(el('p', { class: 'app-error' }, err.message));
    return {};
  }

  // --- what the globe shows ---------------------------------------------------------------

  const visiblePois = () => (s.viewAs === 'players' ? s.pois.filter((p) => p.revealed) : s.pois);

  function markers() {
    const list = visiblePois().map((p) => {
      // The POI being edited shows its draft (new type, name, place) as you change it.
      const d = s.draft && s.draft.id === p.id ? s.draft : p;
      return { id: p.id, lon: d.lon, lat: d.lat, type: d.type, name: d.name, revealed: d.revealed, selected: p.id === s.selected, unique: p.unique };
    });
    if (s.draft && !s.draft.id) list.push({ id: '__new', lon: s.draft.lon, lat: s.draft.lat, type: s.draft.type, name: s.draft.name || 'New point', revealed: s.draft.revealed, pending: true });
    return list;
  }

  function onGlobeClick(point, id) {
    if (s.viewAs === 'players') return id && id !== '__new' ? view(s.pois.find((p) => p.id === id)) : undefined; // look-only
    if (s.moving && point && s.draft) {
      Object.assign(s.draft, { lon: point.lon, lat: point.lat });
      s.moving = false;
      return renderSide();
    }
    if (id && id !== '__new') return edit(s.pois.find((p) => p.id === id));
    if (point) {
      // A new point: keep what was typed for an unsaved new one, just move it.
      s.selected = null;
      s.draft = s.draft && !s.draft.id
        ? { ...s.draft, lon: point.lon, lat: point.lat }
        : { name: '', type: 'poi', description: '', revealed: false, lon: point.lon, lat: point.lat, maps: [] };
      renderSide();
      side.querySelector('[name="name"]')?.focus();
    }
  }

  // --- the side panel ---------------------------------------------------------------------

  function edit(poi) {
    s.selected = poi.id;
    s.draft = { maps: [], ...structuredClone(poi) };
    s.moving = false;
    renderSide();
  }
  /** Players' view: a read-only card. */
  function view(poi) {
    if (!poi) return;
    s.viewing = poi.id;
    s.selected = poi.id;
    renderSide();
  }
  function closeEditor() {
    s.selected = null;
    s.viewing = null;
    s.draft = null;
    s.moving = false;
    renderSide();
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
        toast(`Placed "${made.name}"`, { tone: 'success' });
      }
      closeEditor();
    } catch (err) {
      toastError(err);
    }
  }

  // --- pushing to the player screen -----------------------------------------------------------

  /** The globe as it's turned now, centred on the selected point if there is one. */
  function pushView() {
    const { view, zoom } = globe.getView();
    push({ mode: 'globe', view, zoom, focus: s.selected && s.selected !== '__new' ? s.selected : null });
  }
  /** One point on the player screen; a hidden one is revealed first (after asking). */
  function pushPoi(poi) {
    return revealAndPush(poi, async () => {
      const saved = await api.save({ ...poi, revealed: true });
      s.pois = s.pois.map((p) => (p.id === saved.id ? saved : p));
      if (s.draft?.id === saved.id) s.draft.revealed = true;
      renderSide();
    }, { mode: 'poi', id: poi.id });
  }
  const pushMap = (d) => (m) => push({ mode: 'handout', image: m.image, caption: m.caption || d.name });

  /** Reveal or hide straight from the list. */
  async function toggleReveal(poi) {
    try {
      const saved = await api.save({ ...poi, revealed: !poi.revealed });
      s.pois = s.pois.map((p) => (p.id === saved.id ? saved : p));
      if (s.draft?.id === saved.id) s.draft.revealed = saved.revealed;
      toast(saved.revealed ? `"${saved.name}" is revealed to players` : `"${saved.name}" is hidden from players`);
      renderSide();
    } catch (err) {
      toastError(err);
    }
  }

  async function remove(poi) {
    if (!(await confirmDialog({ title: `Delete "${poi.name}"?`, body: 'This point of interest will be removed from the globe for good.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.remove(poi.id);
      s.pois = s.pois.filter((p) => p.id !== poi.id);
      toast(`Deleted "${poi.name}"`);
      closeEditor();
    } catch (err) {
      toastError(err);
    }
  }

  const glyph = (type) => el('span', { class: `wv-glyph wv-glyph--${type}`, 'aria-hidden': 'true' }, typeOf(type).glyph);
  const visBadge = (revealed) => el('span', { class: `tp-badge ${revealed ? 'tp-badge--interactive' : ''} wv-vis` }, revealed ? 'Revealed' : 'Hidden');

  /** Built-in POIs (Night City): only visibility changes here; they lead to their own map. */
  function uniqueEditor(d) {
    return el('div', { class: 'wv-editor' },
      el('header', { class: 'wv-side__head' },
        el('h2', { class: 'tp-panel__title' }, d.name),
        el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': 'Close', onClick: closeEditor }, '×')),
      el('p', { class: 'app-row' }, glyph(d.type), el('span', {}, `Unique ${typeOf(d.type).label}`), el('span', { class: 'tp-badge tp-badge--interactive' }, 'Built in')),
      el('p', { class: 'wv-note' }, d.description),
      el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Players'),
        el('span', { class: 'fd-seg', role: 'group', 'aria-label': 'Visibility to players' },
          [[false, 'Hidden'], [true, 'Revealed']].map(([v, label]) =>
            el('button', {
              type: 'button', class: `fd-seg__btn ${d.revealed === v ? 'is-on' : ''}`, 'aria-pressed': String(d.revealed === v),
              onClick: () => d.revealed !== v && toggleReveal(s.pois.find((p) => p.id === d.id)),
            }, label)))),
      el('div', { class: 'wv-where' },
        el('span', { class: 'tp-mono' }, formatLonLat(d)),
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => globe.setView(d) }, 'Fly to')),
      el('a', { class: 'tp-frame tp-btn tp-btn--primary wv-citymap', href: `#/worldview/${d.slug}` }, 'Open City Map'),
      pushButton('Push to players', () => pushPoi(s.pois.find((p) => p.id === d.id)), { title: 'Show this point on the player screen' }),
      el('p', { class: 'tp-dim wv-note' }, 'Built into this project: it can\'t be moved, renamed or deleted. Turn it off in Project settings.'));
  }

  function editor() {
    const d = s.draft;
    const isNew = !d.id;
    if (d.unique) return uniqueEditor(d);
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
      el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Name'),
        el('input', { class: 'tp-input', name: 'name', value: d.name, maxlength: 80, required: true, placeholder: 'e.g. Night City', autocomplete: 'off', onInput: (e) => (d.name = e.target.value) })),
      el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Type'),
        el('div', { class: 'wv-types', role: 'radiogroup', 'aria-label': 'Type' },
          POI_TYPES.map((t) =>
            el('label', { class: `wv-type ${d.type === t.id ? 'is-on' : ''}` },
              el('input', { type: 'radio', name: 'type', value: t.id, checked: d.type === t.id, onChange: () => ((d.type = t.id), renderSide()) }),
              glyph(t.id), el('span', {}, t.label))))),
      el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Description'),
        el('textarea', { class: 'tp-textarea', name: 'description', rows: 3, maxlength: 1000, placeholder: 'What it is, who holds it… (optional)', onInput: (e) => (d.description = e.target.value) }, d.description)),
      el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Players'),
        el('span', { class: 'fd-seg', role: 'group', 'aria-label': 'Visibility to players' },
          [[false, 'Hidden'], [true, 'Revealed']].map(([v, label]) =>
            el('button', { type: 'button', class: `fd-seg__btn ${d.revealed === v ? 'is-on' : ''}`, 'aria-pressed': String(d.revealed === v), onClick: () => ((d.revealed = v), renderSide()) }, label))),
        el('span', { class: 'tp-dim wv-note' }, d.revealed ? 'Players can see this point.' : 'Only you can see this point until you reveal it.')),
      el('div', { class: 'wv-where' },
        el('span', { class: 'tp-mono' }, formatLonLat(d)),
        el('button', { type: 'button', class: `tp-frame tp-btn tp-btn--sm ${s.moving ? 'tp-btn--interactive' : 'tp-btn--ghost'}`, onClick: () => ((s.moving = !s.moving), renderSide()) }, s.moving ? 'Click the globe…' : 'Move'),
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => globe.setView(d) }, 'Fly to')),
      mapsEditor(d.maps, renderSide, { push: pushMap(d) }),
      el('div', { class: 'wv-editor__actions' },
        isNew ? null : el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => remove(s.pois.find((p) => p.id === d.id)) }, 'Delete'),
        isNew ? null : pushButton('Push', () => pushPoi(s.pois.find((p) => p.id === d.id)), { title: 'Show this point (as saved) on the player screen', ghost: true }),
        el('span', { class: 'app-actions' },
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost', onClick: closeEditor }, 'Cancel'),
          el('button', { class: 'tp-frame tp-btn tp-btn--primary' }, isNew ? 'Place POI' : 'Save'))));
  }

  function list() {
    const all = visiblePois();
    const shown = all
      .filter((p) => !s.filter || p.type === s.filter)
      .filter((p) => s.show === 'all' || (s.show === 'revealed') === p.revealed);
    const setFilter = (id) => {
      s.filter = id;
      store.set(`tempest.${currentProjectId()}.pois.filter`, id);
      renderSide();
    };
    return el('div', { class: 'wv-list' },
      el('header', { class: 'wv-side__head' },
        el('h2', { class: 'tp-panel__title' }, `Points of interest (${all.length})`)),
      s.viewAs === 'players'
        ? el('p', { class: 'tp-dim wv-note' }, `Showing what players see: ${all.length} of ${s.pois.length} revealed. Switch to GM to place or edit.`)
        : el('p', { class: 'tp-dim wv-note' }, 'Click anywhere on the globe to place a new point.'),
      el('div', { class: 'wv-filters', role: 'group', 'aria-label': 'Filter by type' },
        el('button', { type: 'button', class: `wv-filter ${s.filter ? '' : 'is-on'}`, 'aria-pressed': String(!s.filter), onClick: () => setFilter('') }, 'All'),
        POI_TYPES.map((t) => el('button', { type: 'button', class: `wv-filter ${s.filter === t.id ? 'is-on' : ''}`, 'aria-pressed': String(s.filter === t.id), title: t.label, 'aria-label': t.label, onClick: () => setFilter(s.filter === t.id ? '' : t.id) }, glyph(t.id)))),
      s.viewAs === 'gm'
        ? el('select', { class: 'tp-select wv-show', 'aria-label': 'Show', onChange: (e) => ((s.show = e.target.value), renderSide()) },
            [['all', 'Hidden and revealed'], ['revealed', 'Revealed only'], ['hidden', 'Hidden only']].map(([v, label]) => el('option', { value: v, selected: s.show === v }, label)))
        : null,
      shown.length
        ? el('ul', { class: 'wv-items' },
            shown.map((p) =>
              el('li', { class: `wv-item ${p.revealed ? '' : 'is-hidden'}` },
                el('button', { type: 'button', class: 'wv-item__pick', onClick: () => (globe.setView(p), s.viewAs === 'gm' ? edit(p) : view(p)) },
                  glyph(p.type),
                  el('span', { class: 'wv-item__text' }, el('span', { class: 'wv-item__name' }, p.name), el('span', { class: 'tp-dim wv-item__type' }, p.unique ? `Unique ${typeOf(p.type).label}` : typeOf(p.type).label, p.maps?.length ? `  ·  ${p.maps.length} map${p.maps.length === 1 ? '' : 's'}` : ''))),
                p.unique && s.viewAs === 'players' ? el('a', { class: 'fd-icon-btn wv-item__map', href: `#/worldview/${p.slug}`, title: 'Open City Map', 'aria-label': `Open the ${p.name} City Map` }, '⌗') : null,
                s.viewAs === 'gm'
                  ? el('button', { type: 'button', class: 'fd-icon-btn wv-item__eye', title: p.revealed ? 'Hide from players' : 'Reveal to players', 'aria-label': `${p.revealed ? 'Hide' : 'Reveal'} ${p.name}`, onClick: () => toggleReveal(p) }, p.revealed ? '◉' : '◌')
                  : null,
                visBadge(p.revealed))))
        : el('p', { class: 'tp-dim wv-note' }, s.pois.length ? 'Nothing matches the filters.' : 'No points of interest yet.'));
  }

  /** What players see of a POI: name, type, description and its maps. */
  function card(p) {
    return el('div', { class: 'wv-editor' },
      el('header', { class: 'wv-side__head' },
        el('h2', { class: 'tp-panel__title' }, p.name),
        el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': 'Close', onClick: closeEditor }, '×')),
      el('p', { class: 'app-row' }, glyph(p.type), el('span', {}, p.unique ? `Unique ${typeOf(p.type).label}` : typeOf(p.type).label)),
      p.description ? el('p', { class: 'wv-note cm-desc' }, p.description) : el('p', { class: 'tp-dim wv-note' }, 'No description.'),
      mapsGallery(p.maps, { push: pushMap(p) }),
      el('div', { class: 'wv-where' },
        el('span', { class: 'tp-mono' }, formatLonLat(p)),
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => globe.setView(p) }, 'Fly to')),
      p.unique ? el('a', { class: 'tp-frame tp-btn tp-btn--primary wv-citymap', href: `#/worldview/${p.slug}` }, 'Open City Map') : null);
  }

  function renderSide() {
    viewSeg.replaceChildren(...[['gm', 'GM'], ['players', 'Players']].map(([v, label]) =>
      el('button', {
        type: 'button', class: `fd-seg__btn ${s.viewAs === v ? 'is-on' : ''}`, 'aria-pressed': String(s.viewAs === v),
        onClick: () => {
          s.viewAs = v;
          closeEditor();
        },
      }, label)));
    const viewing = s.viewAs === 'players' ? visiblePois().find((p) => p.id === s.viewing) : null;
    side.replaceChildren(s.draft && s.viewAs === 'gm' ? editor() : viewing ? card(viewing) : list());
    stage.classList.toggle('is-players', s.viewAs === 'players');
  }

  const globe = createGlobe(canvas, {
    rings,
    markers,
    onClick: onGlobeClick,
    onChange: ({ view, zoom, cursor, spinning }) => {
      readout.center.textContent = formatLonLat(view);
      readout.cursor.textContent = cursor ? formatLonLat(cursor) : '—';
      readout.zoom.textContent = `${zoom.toFixed(1)}×`;
      spinBtn.textContent = `Spin: ${spinning ? 'on' : 'off'}`;
      spinBtn.setAttribute('aria-pressed', String(spinning));
    },
  });
  renderSide();

  // A new theme brings new colours (wait a frame for its stylesheet to apply).
  const onTheme = () => requestAnimationFrame(() => globe.refreshColors());
  engine?.addEventListener('change', onTheme);
  const onKey = (e) => {
    if (e.key === 'Escape' && (s.draft || s.viewing) && !document.querySelector('dialog[open]')) closeEditor();
  };
  document.addEventListener('keydown', onKey);
  document.title = 'TEMPEST · World View';

  return {
    unmount() {
      globe.destroy();
      engine?.removeEventListener('change', onTheme);
      document.removeEventListener('keydown', onKey);
    },
  };
}
