// The player screen (#/player): shows whatever the GM last pushed, live.
//
// It follows /api/display/stream and draws the display (the players' copy the
// server built; see push-model.js) into one viewport. Each new push enters with
// the theme's push animation: the viewport carries data-push-kind and
// --push-depth, and is-entering while it plays (themes/*/theme.css).
//
// While a fight is on (Combat › Initiative), every display also carries the turn
// order (d.tracker): it runs across the top of the screen whatever is pushed, the
// view below makes room for it, and attacks play over everything (attack-scene.js).
//
// The Codex button (bottom left, or the C key) opens the players' Codex over the view:
// everything the party knows of, to browse at their own pace (app/codex/codex.js).

import { el } from '../ui.js';
import { renderSheet } from '../forge/sheet.js';
import { createGlobe } from '../maps/globe.js';
import { land } from '../maps/world-view.js';
import { typeOf } from '../maps/poi-model.js';
import { iconOf } from '../maps/city-poi-model.js';
import { CITY_MAPS, prepareDistricts, pathOf, fitBox } from '../maps/city-map-model.js';
import { mapsGallery } from '../maps/attached-maps.js';
import { createBoard } from '../maps/board.js';
import { placeCardView } from '../maps/place-card.js';
import { drawPlanar, planesBox } from '../maps/planar.js';
import { drawStarmap, starmapBox } from '../maps/galactic.js';
import { drawChart } from '../maps/cartographer.js';
import { openImage } from '../image-viewer.js';
import { pushKind, displayLabel, PUSH_MODES } from './push-model.js';
import { fullscreenControl } from './fullscreen.js';
import { renderArticle } from '../screamsheets/article.js';
import { playerNetworkView } from '../netrun/player-view.js';
import { turnBar } from '../combat/turn-bar.js';
import { attackScene } from '../combat/attack-scene.js';
import { codex as createCodex } from '../codex/codex.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const icon = (id) => {
  const s = svg('svg', { viewBox: '0 0 24 24', class: 'cm-icon', 'aria-hidden': 'true' });
  s.append(svg('path', { d: iconOf(id).d }));
  return s;
};
const initials = (name) => (name ?? '?').split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w.replace(/\W/g, '')[0]).join('').toUpperCase() || '?';

export function mount(root, { engine }) {
  const view = el('div', { class: 'scr__view' });
  const tag = el('p', { class: 'scr__tag tp-label' });
  const bar = turnBar({ t: (k, f) => engine?.t?.(k, f) ?? f });
  const scene = attackScene();
  const book = createCodex();
  const frame = el('div', { class: 'scr' }, view, tag, bar.node, book.node, scene.node);
  root.replaceChildren(frame);
  // The view starts below the turn bar while it's up (--scr-top), so nothing hides behind it.
  const sizeBar = new ResizeObserver(() => frame.style.setProperty('--scr-top', `${bar.node.hidden ? 0 : bar.node.offsetHeight}px`));
  sizeBar.observe(bar.node);
  /** The fight's turn order and its latest attack, from any display. */
  function combat(d) {
    const tracker = d.tracker?.active ? d.tracker : null;
    bar.update(tracker);
    frame.classList.toggle('has-turns', Boolean(tracker));
    frame.style.setProperty('--scr-top', `${tracker ? bar.node.offsetHeight : 0}px`);
    if (tracker?.attack) scene.show(tracker.attack, tracker.projectId);
    else if (!tracker) scene.clear();
  }
  const dropFullscreen = fullscreenControl(frame);
  let seq = null;
  let cleanup = null; // the current view's teardown (globe, resize observers)
  let entering = 0;

  async function show(d) {
    if (d.seq === seq) return;
    const first = seq === null;
    seq = d.seq;
    if (d.theme && engine && engine.current?.id !== d.theme && engine.list().some((t) => t.id === d.theme)) await engine.apply(d.theme).catch(() => null);
    cleanup?.();
    cleanup = null;
    const url = (id) => `/api/projects/${encodeURIComponent(d.projectId)}/assets/${encodeURIComponent(id)}`;
    const content = await draw(d, url).catch((err) => el('p', { class: 'app-error' }, err.message));
    if (seq !== d.seq) return; // a newer push arrived while this one was drawing
    view.dataset.pushKind = pushKind(d.mode);
    view.replaceChildren(content);
    tag.textContent = d.mode === 'ambient' ? '' : d.project ?? '';
    document.title = `${displayLabel(d)} · Player Screen`;
    // A fresh push plays the theme's entrance (not on first load, or for standing by).
    clearTimeout(entering);
    view.classList.remove('is-entering');
    if (!first && d.mode !== 'ambient') {
      view.style.setProperty('--push-depth', `${Math.min(content.scrollHeight || view.clientHeight, view.clientHeight)}px`);
      void view.offsetWidth; // restart the animation
      view.classList.add('is-entering');
      entering = setTimeout(() => view.classList.remove('is-entering'), 2000);
    }
  }

  async function draw(d, url) {
    switch (d.mode) {
      case 'message':
        return el('section', { class: `scr-msg scr-msg--${d.tone}`, role: d.tone === 'danger' ? 'alert' : 'status' },
          d.heading ? el('h1', { class: 'tp-display scr-msg__title' }, d.heading) : null,
          el('p', { class: 'scr-msg__text' }, d.text));
      case 'entity': {
        const e = d.entity;
        const lookup = (id) => (e.links[id] ? { name: e.links[id].name ?? 'Unknown', image: e.links[id].image } : null);
        return el('article', { class: 'tp-frame tp-panel scr-panel scr-entity' },
          el('div', { class: 'tp-panel__body' }, renderSheet(e.sheet, { view: 'player', values: e.values, shown: e.shown, lookup, imageUrl: url, openImage: (items, i) => openImage(items.map((x) => ({ ...x, src: url(x.image) })), i) })));
      }
      case 'roster':
        return el('section', { class: 'scr-roster' },
          el('h1', { class: 'tp-h1 scr-roster__title' }, d.title),
          d.entries.length
            ? el('ul', { class: 'scr-roster__grid' }, d.entries.map((x) =>
                el('li', { class: 'tp-frame tp-panel scr-card' },
                  x.image ? el('img', { class: 'scr-card__image', src: url(x.image), alt: '' }) : el('span', { class: 'scr-card__image scr-card__sigil', 'aria-hidden': 'true' }, x.name ? initials(x.name) : '?'),
                  el('span', { class: 'scr-card__text' },
                    el('span', { class: 'scr-card__name' }, x.name ?? 'Unknown'),
                    x.summary ? el('span', { class: 'scr-card__summary' }, x.summary) : null))))
            : el('p', { class: 'tp-muted' }, 'Nothing known yet.'));
      case 'article':
        return renderArticle(d.article);
      case 'handout':
        return el('figure', { class: 'scr-handout' },
          el('img', { src: url(d.image), alt: d.caption || 'Handout' }),
          d.caption ? el('figcaption', { class: 'tp-label scr-handout__caption' }, d.caption) : null);
      case 'poi':
        return poiCard(d.poi.name, [el('span', { class: 'wv-glyph', 'aria-hidden': 'true' }, typeOf(d.poi.type).glyph), typeOf(d.poi.type).label], d.poi, url);
      case 'citypoi':
        return poiCard(d.poi.name, [icon(d.poi.icon), iconOf(d.poi.icon).label, el('span', { class: 'tp-dim' }, `· ${d.districtName ?? 'Outside the districts'}, ${d.cityName}`)], d.poi, url);
      case 'globe':
        return globe(d);
      case 'citymap':
        return cityMap(d);
      case 'place':
        return placeCardView(d.place, { url });
      case 'planes':
      case 'starmap':
      case 'chart':
        return atlasMap(d, url);
      case 'network': {
        const out = playerNetworkView(d.network, { url, fit: true, openImage: (items, i) => openImage(items.map((x) => ({ ...x, src: url(x.image) })), i) });
        cleanup = out.cleanup;
        return out.node;
      }
      default:
        return el('div', { class: 'scr-standby' },
          el('h1', { class: 'tp-display tp-glitch', 'data-text': 'TEMPEST' }, 'TEMPEST'),
          el('p', { class: 'tp-deco' }, 'Standing by'));
    }
  }

  function poiCard(name, line, poi, url) {
    return el('article', { class: 'tp-frame tp-panel scr-panel scr-poi' },
      el('div', { class: 'tp-panel__body' },
        el('p', { class: 'app-row scr-poi__type' }, line),
        el('h1', { class: 'tp-h1 scr-poi__name' }, name),
        poi.description ? el('p', { class: 'scr-poi__desc' }, poi.description) : null,
        mapsGallery(poi.maps, { url })));
  }

  async function globe(d) {
    const canvas = el('canvas', { class: 'scr-globe__canvas', 'aria-label': 'The globe' });
    const focus = d.pois.find((p) => p.id === d.focus);
    const node = el('section', { class: 'scr-globe' }, canvas, focus ? el('p', { class: 'tp-label scr-globe__focus' }, focus.name) : null);
    const rings = await land();
    // Mounted after this returns; start once it's in the page.
    requestAnimationFrame(() => {
      const g = createGlobe(canvas, {
        rings,
        markers: () => d.pois.map((p) => ({ id: p.id, lon: p.lon, lat: p.lat, type: p.type, name: p.name, revealed: true, selected: p.id === d.focus, unique: p.unique })),
      });
      g.toggleSpin(false);
      g.setZoom(d.zoom);
      g.setView(focus ?? d.view);
      cleanup = () => g.destroy();
    });
    return node;
  }

  /** The Planar board, the star map or a chart, framed on what the GM pushed. */
  function atlasMap(d, url) {
    let board;
    let label = d.title;
    if (d.mode === 'chart') {
      const c = d.chart;
      const space = { x0: 0, y0: 0, x1: c.width, y1: c.height };
      const box = d.box ? { x0: d.box.x0 * c.width, y0: d.box.y0 * c.height, x1: d.box.x1 * c.width, y1: d.box.y1 * c.height } : space;
      board = createBoard({ space, interactive: false, zoom: [0.2, 40], frame: () => box, label: c.name, className: 'scr-atlas' });
      if (c.image) board.raster.append(el('img', { class: 'cm-img', src: url(c.image), alt: c.name, style: `width:${c.width}px;height:${c.height}px` }));
      drawChart(board, { width: c.width, height: c.height, pins: c.pins, regions: c.regions }, { selected: d.focus, named: true });
      const focus = [...c.pins, ...c.regions].find((x) => x.id === d.focus);
      if (focus) label = `${c.name} · ${focus.name}`;
      if (c.covered) board.stage.append(el('p', { class: 'ct-covered tp-label' }, 'This map is still under fog'));
    } else if (d.mode === 'planes') {
      board = createBoard({ space: { x0: -10000, y0: -10000, x1: 10000, y1: 10000 }, interactive: false, zoom: [0.2, 400], frame: () => d.box ?? planesBox(d.graph.planes), label: 'The planes', className: 'pl-stage scr-atlas' });
      drawPlanar(board, d.graph, { selected: d.focus });
      const focus = d.graph.planes.find((p) => p.id === d.focus);
      if (focus) label = focus.name;
    } else {
      board = createBoard({ space: { x0: -10000, y0: -10000, x1: 10000, y1: 10000 }, interactive: false, zoom: [0.2, 600], frame: () => d.box ?? starmapBox(d.map), label: 'The star map', className: 'gx-stage scr-atlas' });
      drawStarmap(board, d.map, { selected: d.focus });
      const focus = [...d.map.stars, ...d.map.sectors].find((x) => x.id === d.focus);
      if (focus) label = focus.name;
    }
    cleanup = () => board.destroy();
    return el('section', { class: 'scr-city' }, board.stage, el('p', { class: 'tp-label scr-globe__focus' }, label));
  }

  async function cityMap(d) {
    const map = CITY_MAPS[d.city];
    if (!map) return el('p', { class: 'app-error' }, 'No such city map');
    const districts = prepareDistricts(await (await fetch(`${map.base}/districts.json`)).json(), map);
    const layer = map.layers.find((l) => l.id === d.layer) ?? map.layers[0];
    const overlay = svg('svg', { class: 'cm-overlay', viewBox: `0 0 ${map.width} ${map.height}`, width: map.width, height: map.height });
    for (const x of districts) overlay.append(svg('path', { d: pathOf(x.rings), class: `cm-district ${x.id === d.district ? 'is-selected' : d.district ? 'is-dim' : ''}` }));
    const world = el('div', { class: 'cm-world' }, el('img', { class: 'cm-img', src: `${map.base}/${layer.file}`, alt: `${d.cityName} map`, width: map.width, height: map.height }), overlay);
    const markers = el('div', { class: 'cm-markers' }, d.pois.map((p) =>
      el('span', { class: 'cm-marker scr-marker', 'data-x': p.x, 'data-y': p.y }, icon(p.icon), el('span', { class: 'cm-marker__name' }, p.name))));
    const stage = el('div', { class: 'cm-stage scr-city__stage' }, world, markers);
    const node = el('section', { class: 'scr-city' }, stage,
      el('p', { class: 'tp-label scr-globe__focus' }, d.districtName ? `${d.cityName} · ${d.districtName}` : d.cityName));
    // Frame the lit district (or the whole city), and keep it framed as the window changes.
    const lit = districts.find((x) => x.id === d.district);
    const box = lit?.bounds ?? districts.reduce((b, x) => ({ x0: Math.min(b.x0, x.bounds.x0), y0: Math.min(b.y0, x.bounds.y0), x1: Math.max(b.x1, x.bounds.x1), y1: Math.max(b.y1, x.bounds.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    const place = () => {
      const v = fitBox(box, { width: stage.clientWidth, height: stage.clientHeight }, lit ? 60 : 24);
      world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
      for (const m of markers.children) m.style.transform = `translate(${v.x + m.dataset.x * map.width * v.scale}px, ${v.y + m.dataset.y * map.height * v.scale}px)`;
    };
    const observer = new ResizeObserver(place);
    requestAnimationFrame(() => {
      observer.observe(stage);
      place();
    });
    cleanup = () => observer.disconnect();
    return node;
  }

  const lost = el('p', { class: 'scr__lost tp-label', hidden: true, role: 'status' }, 'Connection lost · reconnecting…');
  const who = el('button', { type: 'button', class: 'scr__who tp-label', title: 'Change the name this screen goes by', hidden: true });
  frame.append(lost, el('div', { class: 'scr__dock' }, book.button, who));

  // TEMPEST updated since this page loaded (a new build), or a push this page doesn't know:
  // reload to pick up the new code. At most once per push, so it can never loop. The reload
  // keeps the name (it isn't the viewer reopening the link, so it doesn't ask again).
  let name = null;
  let loadedBuild = null;
  const outdated = (d) => {
    if (d.build && !loadedBuild) loadedBuild = d.build;
    const stale = (d.build && d.build !== loadedBuild) || !PUSH_MODES.includes(d.mode);
    if (!stale) return false;
    let last = null;
    try {
      last = sessionStorage.getItem('tempest.screen.reloadedFor');
      sessionStorage.setItem('tempest.screen.reloadedFor', String(d.seq));
      if (last !== String(d.seq) && name) sessionStorage.setItem(AUTO_RELOAD, name);
    } catch {
      /* no storage: reload anyway */
    }
    if (last === String(d.seq)) return false;
    location.reload();
    return true;
  };
  const take = (d) => (outdated(d) ? null : (combat(d), book.update(d), show(d)).catch((err) => view.replaceChildren(el('p', { class: 'app-error' }, `Couldn't draw this push: ${err.message}`))));

  /** Follow the display under a screen name; returns the way to stop. */
  function connect(as) {
    const q = `?screen=${encodeURIComponent(as)}`;
    // What's on screen now, straight away: never wait on the live stream to draw.
    const fetchNow = () => fetch(`/api/display${q}`, { cache: 'no-store' })
      .then((r) => {
        if (r.status === 403) throw Object.assign(new Error('This link is no longer valid: ask your GM for the new one, then open it again.'), { gone: true });
        if (!r.ok) throw new Error(`The server answered ${r.status}`);
        return r.json();
      });
    fetchNow().then(take, (err) => {
      lost.hidden = false;
      lost.textContent = err.gone ? err.message : 'Can\'t reach the GM\'s screen · retrying…';
    });

    // Live: the stream sends every push as it happens. Some browsers or networks never let a
    // stream through; then ask every few seconds instead (which also keeps this screen listed).
    let poll = 0;
    let streamed = false;
    const startPolling = () => {
      if (poll) return;
      poll = setInterval(() => fetchNow().then((d) => ((lost.hidden = true), take(d)), (err) => {
        lost.hidden = false;
        lost.textContent = err.gone ? err.message : 'Connection lost · retrying…';
      }), 3000);
    };
    const source = new EventSource(`/api/display/stream${q}`);
    source.addEventListener('open', () => (lost.hidden = true));
    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) {
        source.close();
        startPolling();
      } else if (streamed) {
        lost.hidden = false;
        lost.textContent = 'Connection lost · reconnecting…';
      }
    });
    source.addEventListener('display', (e) => {
      streamed = true;
      if (poll) (clearInterval(poll), (poll = 0));
      try {
        take(JSON.parse(e.data));
      } catch {
        /* ignore a garbled event */
      }
    });
    // No live message within a few seconds: poll until one arrives.
    const watchdog = setTimeout(() => !streamed && startPolling(), 6000);
    return () => {
      source.close();
      clearInterval(poll);
      clearTimeout(watchdog);
    };
  }

  let disconnect = null;
  function join(as) {
    name = as;
    try {
      localStorage.setItem(NAME_KEY, as);
    } catch {
      /* no storage: asked again next time anyway */
    }
    who.textContent = as;
    who.hidden = false;
    disconnect?.();
    seq = null; // draw what this name's screen shows, even if it's the same push number
    disconnect = connect(as);
  }
  const ask = () => askName(frame, name ?? remembered()).then(join);
  who.addEventListener('click', ask);

  // Every time the link is opened (or the page reloaded by hand) it asks who's watching,
  // offering the last name. Only TEMPEST's own reload after an update skips the question.
  let resumed = null;
  try {
    resumed = sessionStorage.getItem(AUTO_RELOAD);
    sessionStorage.removeItem(AUTO_RELOAD);
  } catch {
    /* no storage */
  }
  if (resumed) join(resumed);
  else ask();

  return {
    unmount() {
      dropFullscreen();
      sizeBar.disconnect();
      book.destroy();
      scene.clear();
      disconnect?.();
      cleanup?.();
    },
  };
}

const NAME_KEY = 'tempest.screen.name';
const AUTO_RELOAD = 'tempest.screen.autoReloadAs';
const remembered = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
};

/** Ask who's watching this screen; resolves to the name (1–32 characters). */
function askName(frame, suggested) {
  return new Promise((resolve) => {
    frame.querySelector('.scr-name')?.remove();
    const input = el('input', {
      class: 'tp-input scr-name__input', name: 'screen-name', required: true, maxlength: 32,
      autocomplete: 'nickname', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'go',
      placeholder: 'e.g. Alex, or Table TV', value: suggested ?? '', 'aria-label': 'Your name',
    });
    const error = el('p', { class: 'scr-name__error', role: 'alert', hidden: true }, 'Enter a name.');
    const form = el('form', { class: 'tp-frame tp-panel scr-name__panel' },
      el('div', { class: 'tp-panel__body scr-name__body' },
        el('h1', { class: 'tp-display scr-name__title' }, 'Who\'s watching?'),
        el('p', { class: 'tp-muted scr-name__text' }, 'Your name lets the GM send things to this screen alone.'),
        input, error,
        el('button', { type: 'submit', class: 'tp-frame tp-btn tp-btn--primary scr-name__go' }, 'Join')));
    const gate = el('div', { class: 'scr-name', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Your name' }, form);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = input.value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
      if (!value) {
        error.hidden = false;
        return input.focus();
      }
      gate.remove();
      resolve(value);
    });
    frame.append(gate);
    // With a mouse, ready to type (or Enter to keep the name); on a touch screen, don't throw
    // the keyboard over a name that's already filled in.
    if (!suggested || matchMedia('(pointer: fine)').matches) {
      input.focus();
      input.select();
    }
  });
}
