// TEMPEST GM window and player screen: theme engine, projects, hash router, section tabs.
//
// One page serves both: #/player is the player screen (opened in its own window),
// every other route is a GM section. A tab with a view module (VIEWS) mounts it;
// the rest show a placeholder until the next features fill them in.
//
// Everything the user makes lives in a project. The window reopens the project
// it last used; with none (first run, or it was deleted) it starts on the
// project picker (#/projects), which the project button at the top left also opens.

import { ThemeEngine } from '/src/theme-engine/theme-engine.js';
import { el, store, toastError, menuButton } from './ui.js';
import { visibleSections, PLAYER_PATH, PROJECTS_PATH, SETTINGS_PATH, HOME, resolve, pathOf } from './sections.js';
import { projects as projectsApi, setProject } from './api.js';
import * as presetDesigner from './forge/designer.js';
import * as entitiesView from './entities/view.js';
import * as projectsView from './projects/view.js';
import * as settingsView from './projects/settings.js';
import * as worldView from './maps/world-view.js';
import * as planarView from './maps/planar.js';
import * as cartographerView from './maps/cartographer.js';
import * as galacticView from './maps/galactic.js';
import * as screamsheetsView from './screamsheets/view.js';
import * as netrunView from './netrun/view.js';
import * as initiativeView from './combat/initiative.js';
import * as timelineView from './world/timeline.js';
import * as sessionsView from './sessions/view.js';
import * as playerScreen from './push/screen.js';
import { messageDialog, clear as clearScreen, watchDisplay, targetPicker } from './push/push.js';
import { displayLabel } from './push/push-model.js';

const engine = new ThemeEngine();
const $ = (id) => document.getElementById(id);
const PROJECT_KEY = 'tempest.project';
let project = null; // the open project
// 'player' when this page came from the network player server (server/lan.js):
// then it is only ever the player screen.
let role = 'gm';
// Remembered per project, so each project reopens on its own last tab.
const lastTabKey = (sectionId) => `tempest.${project?.id}.tab.${sectionId}`;

// Tabs that have been built: 'section/tab' → module with mount(root) → { unmount?, relabel? }.
const VIEWS = {
  'characters/players': entitiesView,
  'characters/npcs': entitiesView,
  'characters/monsters': entitiesView,
  'characters/creatures': entitiesView,
  'world/events': entitiesView,
  'world/stories': entitiesView,
  'world/rumors': entitiesView,
  'world/screamsheets': screamsheetsView,
  'world/factions': entitiesView,
  'world/timeline': timelineView,
  'combat/initiative': initiativeView,
  'combat/netrunning': netrunView,
  'sessions/log': sessionsView,
  'sessions/handouts': sessionsView,
  'forge/characters': presetDesigner,
  'forge/stories': presetDesigner,
  'forge/items': presetDesigner,
  'forge/factions': presetDesigner,
  items: entitiesView, // a section without tabs: keyed by the section alone
  worldview: worldView, // only while the project's map system is Planetary
  planes: planarView, // …Planar
  atlas: cartographerView, // …Cartographer
  starmap: galacticView, // …Galactic
};
let current = null; // the mounted view
let mounting = null; // the view being mounted (mounts are async)

// --- Projects ---------------------------------------------------------------------------

/** Switch the window to a project (or to none). `stay` keeps the current page. */
async function openProject(next, { stay = false } = {}) {
  project = next;
  setProject(next?.id ?? null);
  if (next) store.set(PROJECT_KEY, next.id);
  else store.set(PROJECT_KEY, '');
  $('project-name').textContent = next?.name ?? 'Choose a project';
  $('project-btn').classList.toggle('is-empty', !next);
  $('settings-btn').hidden = !next;
  // A project remembers its theme; switching projects switches the look.
  if (next?.theme && next.theme !== engine.current?.id && engine.list().some((t) => t.id === next.theme)) {
    await engine.apply(next.theme).catch(() => null);
  }
  if (stay) return;
  if (next) projectsApi.get(next.id, { open: true }).catch(() => null); // sorts it first in the picker
  const target = `#${next ? HOME : PROJECTS_PATH}`;
  if (location.hash === target) route(); // no hashchange will come: redraw for the new project
  else location.hash = target;
}

async function restoreProject() {
  const id = store.get(PROJECT_KEY);
  if (!id) return;
  try {
    await openProject(await projectsApi.get(id), { stay: true });
  } catch {
    store.set(PROJECT_KEY, ''); // deleted or moved: back to the picker
  }
}

// --- GM sections ---------------------------------------------------------------------

function renderSectionNav(active) {
  $('sections').hidden = !project;
  $('sections').replaceChildren(
    ...visibleSections(project).map((s) =>
      el('a', { class: 'app-sections__link', href: `#${pathOf(s)}`, 'aria-current': s === active ? 'page' : null }, s.label)),
  );
}

/** A landing page: one card per tab, e.g. The Forge's preset types. */
function chooser(section) {
  return el('div', { class: 'app-chooser' },
    el('p', { class: 'tp-muted app-chooser__lead' }, 'Choose a preset to start forging.'),
    el('div', { class: 'app-chooser__grid' },
      section.tabs.map((t) =>
        el('a', { class: 'tp-frame tp-panel app-chooser__card', href: `#${pathOf(section, t)}` },
          el('div', { class: 'tp-panel__body' },
            el('span', { class: 'tp-label' }, 'Preset'),
            // Wrap long names after their slashes, not mid-word.
            el('span', { class: 'tp-h2 app-chooser__name' }, t.label.split('/').flatMap((part, i) => (i ? ['/', el('wbr'), part] : [part]))),
            t.blurb ? el('span', { class: 'tp-muted' }, t.blurb) : null)))));
}

/** Mount a view module into `host`, unless the route changes while it loads. */
function mountView(view, host, ctx, label) {
  const token = (mounting = Symbol(label));
  // Something to look at while a slow view loads (it fades in only if loading takes a moment).
  const loading = el('p', { class: 'tp-muted app-loading', role: 'status' }, 'Loading…');
  host.append(loading);
  Promise.resolve(view.mount(host, { engine, ...ctx }))
    .finally(() => loading.remove())
    .then((handle) => {
      // Navigated away while it was loading: release it straight away.
      if (mounting !== token) return handle?.unmount?.();
      current = handle ?? {};
    })
    .catch((err) => {
      console.error(err);
      host.replaceChildren(el('p', { class: 'app-error' }, `Couldn't open ${label}: ${err.message}`));
    });
}

function renderSection(section, tab, item) {
  const title = tab ? `${section.label} · ${tab.label}` : section.label;
  const view = tab ? VIEWS[`${section.id}/${tab.id}`] : VIEWS[section.id] ?? null;
  const host = el('div', { class: 'app-view' });
  document.title = `TEMPEST · ${section.label}`; // the tray finds GM windows by "TEMPEST" / "TEMPEST · …"
  $('main').replaceChildren(
    el('div', { class: 'app-page' },
      // The open tab is already marked in the tab row below: the head names only the section.
      el('div', { class: 'app-page__head' },
        el('h1', { class: 'tp-h1' }, section.label)),
      section.tabs.length
        // Tabs that navigate: role="tab" + aria-selected is also what the themes style.
        ? el('nav', { class: 'tp-tabs app-tabs', role: 'tablist', 'aria-label': `${section.label} tabs` },
            section.tabs.map((t) =>
              el('a', { class: 'tp-tab', role: 'tab', href: `#${pathOf(section, t)}`, 'aria-selected': t === tab ? 'true' : 'false' }, t.label)))
        : null,
      section.landing && !tab
        ? chooser(section)
        : view
          ? host
          : el('article', { class: 'tp-frame tp-panel app-placeholder' },
              el('div', { class: 'tp-panel__body' },
                el('p', { class: 'tp-h3' }, `${tab?.label ?? section.label}`),
                el('p', { class: 'tp-muted' }, `Nothing here yet. ${title} is ready for what we build next.`)))),
  );
  if (view) mountView(view, host, { section, tab, item, project }, tab?.label ?? section.label);
}

// --- Player screen ---------------------------------------------------------------------

function renderPlayer() {
  // "<view> · Player Screen": the tray tells player windows from GM windows by this title.
  document.title = 'Standing by · Player Screen';
  const host = el('div', { class: 'app-view scr-host' });
  $('main').replaceChildren(host);
  mountView(playerScreen, host, {}, 'the player screen');
}

// --- Router ------------------------------------------------------------------------------

function route() {
  if (role === 'player' && location.hash !== `#${PLAYER_PATH}`) return location.replace(`#${PLAYER_PATH}`);
  const where = resolve(location.hash.slice(1) || '/', { lastTab: (id) => store.get(lastTabKey(id)) });
  if (where.kind === 'redirect') return location.replace(`#${where.to}`);
  // No project open: everything but the player screen waits for one.
  if (!project && (where.kind === 'section' || where.kind === 'settings')) return location.replace(`#${PROJECTS_PATH}`);
  current?.unmount?.();
  current = null;
  mounting = null;
  const player = where.kind === 'player';
  document.body.classList.toggle('is-player', player);
  $('main').scrollTop = 0;
  if (player) return renderPlayer();
  if (where.kind === 'projects') {
    renderSectionNav(null);
    const host = el('div', { class: 'app-view' });
    $('main').replaceChildren(host);
    return mountView(projectsView, host, { current: project, open: openProject }, 'Projects');
  }
  if (where.kind === 'settings') {
    renderSectionNav(null);
    const host = el('div', { class: 'app-view' });
    $('main').replaceChildren(host);
    // A save updates the open project (its settings) without leaving the page.
    // Saving can change which sections show (e.g. World View for Planetary maps).
    return mountView(settingsView, host, { project, saved: (p) => ((project = p), renderSectionNav(null)) }, 'Settings');
  }
  // A map-system section the project doesn't use (e.g. World View when maps aren't Planetary).
  if (!visibleSections(project).includes(where.section)) return location.replace(`#${HOME}`);
  if (where.tab) store.set(lastTabKey(where.section.id), where.tab.id);
  renderSectionNav(where.section);
  renderSection(where.section, where.tab, where.item);
}

// --- Top-bar controls ---------------------------------------------------------------------

function wireControls() {
  const themeSelect = $('theme-select');
  const effectsSelect = $('effects-select');
  // Theme and Effects: one menu in the top bar (the selects move into it; their listeners stay).
  const fields = [...$('look-fields').children];
  const look = menuButton('◐ Theme', () => fields, { cls: 'tp-btn--sm app-look', title: 'Theme and effects for this project' });
  $('look-fields').replaceWith(look.node);
  engine.addEventListener('registry', (e) => themeSelect.replaceChildren(...e.detail.map((t) => el('option', { value: t.id }, t.name))));
  engine.addEventListener('change', (e) => (themeSelect.value = e.detail.theme.id));
  engine.addEventListener('effects', (e) => (effectsSelect.value = e.detail.level));
  themeSelect.addEventListener('change', async () => {
    await engine.apply(themeSelect.value);
    // The theme belongs to the open project: remember it there.
    if (project && project.theme !== themeSelect.value) {
      project = await projectsApi.update(project.id, { theme: themeSelect.value }).catch((err) => (toastError(err), project));
    }
  });
  effectsSelect.addEventListener('change', () => engine.setEffects(effectsSelect.value));
  $('screen-open').addEventListener('click', () => window.open(`#${PLAYER_PATH}`, 'tempest-player', 'width=1440,height=900'));
  $('screen-message').addEventListener('click', messageDialog);
  $('screen-clear').addEventListener('click', () => clearScreen());
  // What's on the player screens right now, live, and who pushes go to (GM windows only).
  if (role === 'gm' && location.hash.slice(1) !== PLAYER_PATH) {
    let screens = [];
    let everyone = { mode: 'ambient' };
    const picker = targetPicker(() => screens);
    $('screen-open').before(picker.node);
    const status = () => {
      const watching = screens.filter((s) => s.online).length;
      const own = screens.filter((s) => s.personal).length;
      $('screen-status').textContent = `${displayLabel(everyone)}${watching ? ` · ${watching} watching` : ''}`;
      $('screen-status').title = `Every screen: ${displayLabel(everyone)}${own ? `\n${own} screen${own === 1 ? '' : 's'} showing something sent to them alone` : ''}`;
      // Clear stays useful while any screen shows something.
      $('screen-clear').disabled = everyone.mode === 'ambient' && !screens.some((s) => s.personal && s.mode !== 'ambient');
    };
    watchDisplay((d) => ((everyone = d), status()), (list) => ((screens = list), status(), picker.refresh()));
  }
}

// --- Boot -----------------------------------------------------------------------------------

// The network server marks its page as the player screen (server/lan.js); /api/role says so too.
role = document.body.dataset.role === 'player' || (await fetch('/api/role').then((r) => r.json()).catch(() => null))?.role === 'player' ? 'player' : 'gm';
wireControls();
window.addEventListener('hashchange', route);
await engine.init().catch((err) => console.error(`Theme failed to load: ${err.message}`));
if (role === 'gm') await restoreProject();
route();

window.tempest = { engine, get project() { return project; } }; // devtools
