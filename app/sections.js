// The GM window's sections and their tabs, and how a location hash maps onto them.
// Pure data + functions (no DOM) so the routing can be tested in Node.

export const SECTIONS = [
  {
    id: 'characters',
    label: 'Characters',
    // detail: the tab lists entries, and /section/tab/<id> opens one.
    tabs: [
      { id: 'players', label: 'Players', detail: true },
      { id: 'npcs', label: 'NPCs', detail: true },
      { id: 'monsters', label: 'Monsters', detail: true },
      { id: 'creatures', label: 'Creatures', detail: true },
    ],
  },
  {
    id: 'world',
    label: 'World',
    tabs: [
      { id: 'events', label: 'Events', detail: true },
      { id: 'stories', label: 'Stories', detail: true },
      { id: 'rumors', label: 'Rumors', detail: true },
      // In-world news, made with the Screamsheet Generator (/world/screamsheets/new).
      { id: 'screamsheets', label: 'Screamsheets', detail: true },
      // Factions and organizations: every type on this one tab (app/entities/view.js), filtered by type.
      { id: 'factions', label: 'Factions', detail: true },
      // Everything dated, in order (app/world/timeline.js).
      { id: 'timeline', label: 'Timeline' },
    ],
  },
  // Map-system sections show only while the project uses that system (see visibleSections).
  // World View is Planetary's.
  // /worldview/<slug> opens a unique location's own map (e.g. Night City's City Map).
  { id: 'worldview', label: 'World View', tabs: [], mapMode: 'planetary', detail: true },
  // The other map systems, each only while chosen. Planes: the board of planes and ways.
  { id: 'planes', label: 'Planes', tabs: [], mapMode: 'planar' },
  // Atlas: the chart gallery; /atlas/<chart id> opens one chart.
  { id: 'atlas', label: 'Atlas', tabs: [], mapMode: 'cartographer', detail: true },
  // Star Map: /starmap/<slug> opens a unique location's own map (Night City's City Map).
  { id: 'starmap', label: 'Star Map', tabs: [], mapMode: 'galactic', detail: true },
  {
    id: 'combat',
    label: 'Combat',
    // Initiative is the tracker (app/combat/initiative.js); while a fight is on, its turn order
    // shows across the top of every player screen.
    // Netrunning has three sub-tabs of its own (app/netrun/view.js): /combat/netrunning/builder,
    // /cards and /networks; a net card (ncard_…) or a network (net_…) opens by id in the same place.
    tabs: [{ id: 'initiative', label: 'Initiative' }, { id: 'netrunning', label: 'Netrunning', detail: true }],
  },
  // No tabs, but entries: /items lists them, /items/<id> opens one.
  { id: 'items', label: 'Items', tabs: [], detail: true },
  // Game nights and the handouts given out at them (app/sessions/view.js).
  {
    id: 'sessions',
    label: 'Sessions',
    tabs: [{ id: 'log', label: 'Session log', detail: true }, { id: 'handouts', label: 'Handouts', detail: true }],
  },
  {
    // Where new things are made from presets. Opens on a chooser (landing) rather
    // than a tab; each preset type is a tab of its own.
    id: 'forge',
    label: 'The Forge',
    landing: true,
    tabs: [
      { id: 'characters', label: 'Characters/Creatures', blurb: 'Players, NPCs, monsters and creatures.' },
      { id: 'stories', label: 'Stories/Rumors/Events', blurb: 'Plot threads, whispers and happenings in the world.' },
      { id: 'items', label: 'Items', blurb: 'Weapons, gear, loot and curiosities.' },
      { id: 'factions', label: 'Factions/Organizations', blurb: 'Corporations, gangs, governments, guilds and cults.' },
    ],
  },
];

export const PLAYER_PATH = '/player';
export const PROJECTS_PATH = '/projects';
export const SETTINGS_PATH = '/settings';
export const HOME = '/characters/players';

/**
 * Resolve a hash path ("/world/stories") to what the window shows:
 *   { kind: 'player' }                      the player screen
 *   { kind: 'projects' }                    the project picker
 *   { kind: 'settings' }                    the open project's settings
 *   { kind: 'section', section, tab, item? } a GM section (tab is null for sections without tabs, and on a landing
 *                                            page; item is an entry's id on tabs with detail pages)
 *   { kind: 'redirect', to }                anything else: where it should go instead
 * `lastTab(sectionId)` supplies the tab to open when a section is visited without one.
 */
export function resolve(path, { lastTab = () => null } = {}) {
  const clean = `/${String(path ?? '').replace(/^#?\/*/, '').replace(/\/+$/, '')}`;
  if (clean === PLAYER_PATH) return { kind: 'player' };
  if (clean === PROJECTS_PATH) return { kind: 'projects' };
  if (clean === SETTINGS_PATH) return { kind: 'settings' };
  const [, sectionId, tabId, ...rest] = clean.split('/');
  const section = SECTIONS.find((s) => s.id === sectionId);
  const tab = section?.tabs.find((t) => t.id === tabId);
  if (tab?.detail && rest.length === 1 && /^[a-z0-9_-]{1,64}$/.test(rest[0])) return { kind: 'section', section, tab, item: rest[0] };
  if (!section || rest.length) return { kind: 'redirect', to: HOME };
  if (!section.tabs.length) {
    if (tabId && section.detail && /^[a-z0-9_-]{1,64}$/.test(tabId)) return { kind: 'section', section, tab: null, item: tabId };
    return tabId ? { kind: 'redirect', to: `/${section.id}` } : { kind: 'section', section, tab: null };
  }
  if (tab) return { kind: 'section', section, tab };
  if (section.landing) return tabId ? { kind: 'redirect', to: `/${section.id}` } : { kind: 'section', section, tab: null };
  const fallback = section.tabs.find((t) => t.id === lastTab(section.id)) ?? section.tabs[0];
  return { kind: 'redirect', to: `/${section.id}/${fallback.id}` };
}

/** The sections a project shows: those tied to a map system appear only when it's chosen. */
export const visibleSections = (project) => SECTIONS.filter((s) => !s.mapMode || s.mapMode === project?.settings?.maps?.mode);

/** The hash path for a section (and tab). */
export const pathOf = (section, tab = null) => (tab ? `/${section.id}/${tab.id}` : `/${section.id}`);
