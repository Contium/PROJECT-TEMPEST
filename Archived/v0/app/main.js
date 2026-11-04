// TEMPEST app shell: theme engine, hash router, universe session and live sync.

import { ThemeEngine } from '/src/theme-engine/theme-engine.js';
import { universeApi } from './api.js';
import { el, toast, toastError, debounce, emptyState } from './ui.js';
import * as universesView from './views/universes.js';
import * as overviewView from './views/overview.js';
import * as entitiesView from './views/entities.js';
import * as timelineView from './views/timeline.js';
import * as settingsView from './views/settings.js';
import * as screenView from './views/screen.js';
import * as screamsheetView from './views/screamsheet.js';
import * as initiativeView from './views/initiative.js';
import { pushMessageDialog, clearScreen, displayLabel } from './push.js';
import { openPalette } from './palette.js';

const engine = new ThemeEngine();
const $ = (id) => document.getElementById(id);

const ROUTES = [
  { pattern: /^\/$/, view: universesView },
  { pattern: /^\/u\/([^/]+)$/, view: overviewView, keys: ['uid'] },
  { pattern: /^\/u\/([^/]+)\/e\/([^/]+)(?:\/([^/]+))?$/, view: entitiesView, keys: ['uid', 'type', 'id'] },
  { pattern: /^\/u\/([^/]+)\/timeline$/, view: timelineView, keys: ['uid'] },
  { pattern: /^\/u\/([^/]+)\/settings$/, view: settingsView, keys: ['uid'] },
  { pattern: /^\/u\/([^/]+)\/tools\/screamsheet$/, view: screamsheetView, keys: ['uid'] },
  { pattern: /^\/u\/([^/]+)\/initiative$/, view: initiativeView, keys: ['uid'] },
  { pattern: /^\/u\/([^/]+)\/screen(?:\/(full))?$/, view: screenView, keys: ['uid', 'layout'], player: true },
];

const shell = {
  uid: null,
  meta: null,
  types: [], // in the universe's presentation order (server-sorted)
  api: null,
  stream: null,
  names: null, // Promise<Map>, cleared on every change
  eras: null, // Promise<Era[]>, cleared on every change
  display: null, // what the shared player screen shows
  combat: null, // { active, round } of the Initiative Tracker, for the sidebar (GM windows only)
  route: null,
  view: null,
};

// --- Context handed to views -------------------------------------------------

function typeLabel(typeOrId, plural = false) {
  const type = typeof typeOrId === 'string' ? shell.types.find((t) => t.id === typeOrId) : typeOrId;
  if (!type) return String(typeOrId);
  if (!type.lexKey) return plural ? type.plural : type.name;
  return plural ? engine.t(`${type.lexKey}.plural`, type.plural) : engine.t(type.lexKey, type.name);
}

function makeContext(route) {
  return {
    uid: shell.uid,
    base: `/u/${shell.uid}`,
    params: route.params,
    api: shell.api,
    engine,
    get meta() {
      return shell.meta;
    },
    get types() {
      return shell.types;
    },
    get display() {
      return shell.display;
    },
    type: (id) => shell.types.find((t) => t.id === id),
    typeLabel,
    fieldLabel: (field) => (field.lexKey ? engine.t(field.lexKey, field.label) : field.label),
    /** Map of id → entity (with data) for every entity, including removed ones. */
    names() {
      shell.names ??= shell.api.list({ limit: 100000, includeDeleted: true }).then((all) => new Map(all.map((e) => [e.id, e])));
      return shell.names;
    },
    /** Eras on the Time-Line, earliest first. */
    eras() {
      shell.eras ??= shell.api.eras();
      return shell.eras;
    },
    href: (path) => `#${path}`,
    entityHref: (e) => `#/u/${shell.uid}/e/${e.type}/${e.id}`,
    go: (path) => (location.hash = path),
    refreshShell,
  };
}

// --- Universe session ------------------------------------------------------------

async function openUniverse(uid, { player = false } = {}) {
  closeUniverse();
  shell.uid = uid;
  shell.api = universeApi(uid);
  [shell.meta, shell.types, shell.display] = await Promise.all([shell.api.meta(), shell.api.types(), shell.api.display()]);
  if (shell.meta.theme && shell.meta.theme !== engine.current?.id) {
    await engine.apply(shell.meta.theme, { persist: false }).catch(() => null);
  }
  shell.stream = new EventSource(shell.api.streamUrl);
  shell.stream.addEventListener('change', onRemoteChange);
  shell.stream.addEventListener('display', onDisplay);
  shell.stream.addEventListener('encounter', onEncounter);
  if (!player) {
    shell.combat = await shell.api.encounter().catch(() => null);
    try {
      localStorage.setItem('tempest.lastUniverse', uid);
    } catch {
      /* not essential */
    }
  }
}

function closeUniverse() {
  shell.stream?.close();
  Object.assign(shell, { uid: null, meta: null, types: [], api: null, stream: null, names: null, eras: null, display: null, combat: null });
}

// The Initiative Tracker changed: the event carries no state (it holds GM secrets), so each window refetches its own view.
async function onEncounter() {
  try {
    if (!shell.route?.player) {
      const was = shell.combat;
      shell.combat = await shell.api.encounter();
      if (was?.active !== shell.combat.active || was?.round !== shell.combat.round) renderChrome();
    }
    await shell.view?.encounter?.();
  } catch (err) {
    console.error(err);
  }
}

// A push from any GM window: the player screen re-renders; GM windows update their "on screen" markers.
async function onDisplay(event) {
  shell.display = JSON.parse(event.data);
  renderScreenControl();
  try {
    await (shell.view?.display ?? shell.view?.onDisplay)?.(shell.display);
  } catch (err) {
    console.error(err);
  }
}

async function renderScreenControl() {
  if (!shell.uid) return;
  const names = await makeContext(shell.route).names().catch(() => null);
  $('screen-now').textContent = displayLabel(shell.display, makeContext(shell.route), names);
}

const onRemoteChange = debounce(async () => {
  if (!shell.uid) return;
  shell.names = null;
  shell.eras = null;
  shell.meta = await shell.api.meta().catch(() => shell.meta);
  // The universe's theme was changed from another window: follow it (player screens too).
  if (shell.meta.theme && shell.meta.theme !== engine.current?.id) {
    await engine.apply(shell.meta.theme, { persist: false }).catch(() => null);
  }
  renderChrome();
  try {
    await shell.view?.update?.();
  } catch (err) {
    console.error(err);
  }
}, 120);

/** Re-read universe meta + types (after settings changes) and redraw chrome. */
async function refreshShell() {
  if (!shell.uid) return;
  [shell.meta, shell.types] = await Promise.all([shell.api.meta(), shell.api.types()]);
  shell.names = null;
  shell.eras = null;
  renderChrome();
}

// --- Chrome: top bar + sidebar ---------------------------------------------------

async function renderChrome() {
  const inUniverse = Boolean(shell.uid);
  $('clock').hidden = !inUniverse;
  $('search-btn').hidden = !inUniverse;
  $('screen-ctl').hidden = !inUniverse;
  $('nav').hidden = !inUniverse;
  $('top-subtitle').textContent = inUniverse ? shell.meta.name : engine.t('app.tagline', 'Universe World Manager');
  // The tray finds GM windows by this title ("TEMPEST" / "TEMPEST · <universe>"); player screens set their own.
  if (!shell.route?.player) document.title = inUniverse ? `TEMPEST · ${shell.meta.name}` : 'TEMPEST';
  if (!inUniverse) return;

  $('clock-value').textContent = shell.meta.clockLabel;
  $('clock-era').textContent = shell.meta.era?.name ?? 'No era';
  renderScreenControl();

  const counts = new Map();
  const names = await makeContext(shell.route).names().catch(() => new Map());
  for (const e of names.values()) if (!e.deleted) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);

  const base = `/u/${shell.uid}`;
  const current = location.hash.slice(1);
  const link = (path, label, count, match = (p) => p === path) =>
    el(
      'a',
      { href: `#${path}`, 'aria-current': match(current) ? 'page' : null },
      el('span', {}, label),
      count != null ? el('span', { class: 'app-nav__count' }, count) : null,
    );
  const typeLink = (t) => link(`${base}/e/${t.id}`, typeLabel(t, true), counts.get(t.id) ?? 0, (p) => p.startsWith(`${base}/e/${t.id}`));
  const section = (label, list) => (list.length ? [el('span', { class: 'tp-label app-nav__group' }, label), ...list.map(typeLink)] : []);

  const world = shell.types.filter((t) => t.category !== 'play' && t.category !== 'extra');
  $('nav').replaceChildren(
    el('div', { class: 'app-nav__campaign' }, el('strong', {}, shell.meta.name), el('span', { class: 'tp-deco' }, shell.meta.system ?? '')),
    link(base, engine.t('universe', 'Universe')),
    link(`${base}/timeline`, engine.t('timeline', 'Time-Line')),
    ...world.map(typeLink),
    ...section('Play', shell.types.filter((t) => t.category === 'play')),
    link(`${base}/initiative`, engine.t('initiative', 'Initiative Tracker'), shell.combat?.active ? `R${shell.combat.round}` : null),
    link(`${base}/tools/screamsheet`, 'Screamsheet Generator'),
    ...section('Extras', shell.types.filter((t) => t.category === 'extra')),
    el('div', { class: 'app-nav__foot' }, link(`${base}/settings`, 'Settings'), el('a', { href: '/styleguide/', target: '_blank' }, 'Style guide')),
  );
}

// --- Router -------------------------------------------------------------------------

function matchRoute(path) {
  for (const route of ROUTES) {
    const m = path.match(route.pattern);
    if (!m) continue;
    const params = Object.fromEntries((route.keys ?? []).map((k, i) => [k, m[i + 1] ? decodeURIComponent(m[i + 1]) : undefined]));
    return { ...route, params };
  }
  return null;
}

let routing = Promise.resolve();

function onHashChange() {
  routing = routing.then(route, route);
}

async function route() {
  const path = location.hash.slice(1) || '/';
  const legacy = path.match(/^\/player\/([^/]+)$/); // old player display links
  if (legacy) return location.replace(`#/u/${legacy[1]}/screen`);
  const next = matchRoute(path);
  if (!next) return (location.hash = '/');

  // Same view, same universe: let the view handle it (keeps scroll, search, focus).
  const prev = shell.route;
  if (prev && prev.view === next.view && prev.params.uid === next.params.uid && shell.view?.reroute?.(next.params)) {
    shell.route = next;
    renderChrome();
    return;
  }

  shell.view?.unmount?.();
  shell.view = null;
  shell.route = next;
  document.body.classList.toggle('is-player', Boolean(next.player));

  const main = $('main');
  try {
    if (next.params.uid && next.params.uid !== shell.uid) await openUniverse(next.params.uid, { player: next.player });
    if (!next.params.uid && shell.uid) closeUniverse();
    await renderChrome();
    main.replaceChildren();
    main.scrollTop = 0;
    shell.view = (await next.view.mount(main, makeContext(next))) ?? {};
  } catch (err) {
    console.error(err);
    if (err.status === 404 && next.params.uid && !shell.meta) closeUniverse();
    renderChrome();
    main.replaceChildren(
      emptyState(err.status === 404 ? 'Not found' : 'Something went wrong', err.message, el('a', { class: 'tp-frame tp-btn', href: '#/' }, 'All universes')),
    );
  }
}

// --- Top-bar controls ---------------------------------------------------------------

function wireControls() {
  const themeSelect = $('theme-select');
  const effectsSelect = $('effects-select');

  engine.addEventListener('registry', (e) => {
    themeSelect.replaceChildren(...e.detail.map((t) => el('option', { value: t.id }, t.name)));
  });
  engine.addEventListener('change', (e) => {
    themeSelect.value = e.detail.theme.id;
    if (shell.route) {
      // Lexicon changed: redraw chrome and the current view so every label follows.
      renderChrome();
      shell.view?.relabel?.() ?? shell.view?.update?.();
    }
  });
  engine.addEventListener('effects', (e) => (effectsSelect.value = e.detail.level));

  themeSelect.addEventListener('change', async () => {
    await engine.apply(themeSelect.value);
    // Themes belong to universes: remember the choice on the open one.
    if (shell.uid && shell.meta.theme !== themeSelect.value) {
      shell.meta = await shell.api.setMeta({ theme: themeSelect.value }).catch((err) => (toastError(err), shell.meta));
    }
  });
  effectsSelect.addEventListener('change', () => engine.setEffects(effectsSelect.value));

  const advance = async (by) => {
    try {
      const res = await shell.api.clock({ advance: by });
      const enteredEra = res.era?.id !== shell.meta.era?.id && res.era;
      shell.meta = res;
      renderChrome();
      toast(`Clock → ${res.clockLabel}`, {
        tone: 'success',
        details: [
          res.affected ? `${res.affected} scheduled change${res.affected === 1 ? '' : 's'} took effect` : null,
          enteredEra ? `Entered ${enteredEra.name}` : null,
        ].filter(Boolean),
      });
    } catch (err) {
      toastError(err);
    }
  };
  $('clock').addEventListener('click', (e) => {
    const by = e.target.closest('[data-advance]')?.dataset.advance;
    if (by) advance(by);
  });
  $('clock-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = $('clock-input').value.trim();
    if (!value) return;
    advance(value);
    $('clock-input').value = '';
  });

  // Quick search: Ctrl+K / Cmd+K anywhere in a GM window (not on player screens).
  const quickSearch = () => {
    if (shell.uid && shell.route && !shell.route.player) openPalette(makeContext(shell.route)).catch(toastError);
  };
  $('search-btn').addEventListener('click', quickSearch);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault(); // the browser would otherwise focus its own search bar
      if (document.querySelector('dialog.palette')) return;
      quickSearch();
    }
  });

  // Each window picks its own layout; content is shared by all of them.
  const openScreen = (layout) =>
    window.open(`#/u/${shell.uid}/screen${layout === 'full' ? '/full' : ''}`, `tempest-screen-${shell.uid}-${layout}`, 'width=1440,height=900');
  $('screen-open').addEventListener('click', () => openScreen('station'));
  $('screen-open-full').addEventListener('click', () => openScreen('full'));
  $('screen-message').addEventListener('click', () => pushMessageDialog(makeContext(shell.route)));
  $('screen-clear').addEventListener('click', () => clearScreen(makeContext(shell.route)));
}

// --- Boot -----------------------------------------------------------------------------

wireControls();
window.addEventListener('hashchange', onHashChange);
engine
  .init()
  .catch((err) => toast(`Theme failed to load: ${err.message}`, { tone: 'danger' }))
  .then(onHashChange);

window.tempest = { engine, shell }; // devtools
