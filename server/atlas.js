// The players' copies of the Planar, Cartographer and Galactic map systems, for
// pushes (server/display.js) and the players' Codex (server/codex.js). Like
// every players' copy, they are built here from the project's data with the
// models' own rules, so nothing GM-only can reach a player screen: hidden places,
// a chart's map under fog (only its baked players' copy), the fog brush itself.

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { StoreError } = require('./presets');

const appModule = (rel) => import(pathToFileURL(path.join(__dirname, '..', 'app', rel)).href);

/** Everything one system holds, read once. */
async function load(library, projectId, system) {
  const stores = await library.open(projectId);
  if (system === 'planar') return { planes: await stores.planes.list(), ways: await stores.ways.list() };
  if (system === 'cartographer') return { charts: await stores.charts.list(), pins: await stores.pins.list(), regions: await stores.regions.list() };
  return { stars: await library.listStars(projectId), lanes: await stores.lanes.list(), sectors: await stores.sectors.list() };
}

/** The system an id belongs to, from its prefix. */
const systemOf = (id) => (/^(plane|way)_/.test(id) ? 'planar' : /^(chart|pin|region)_/.test(id) ? 'cartographer' : /^(star|lane|sector|unique)_/.test(id) ? 'galactic' : null);

/** The players' card of one place (any of the three systems), or null if they can't see it. */
async function card(library, projectId, id) {
  const system = systemOf(id);
  if (!system) return null;
  const d = await load(library, projectId, system);
  if (system === 'planar') return (await appModule('maps/planar-model.js')).planarCard(id, d.planes, d.ways);
  if (system === 'cartographer') return (await appModule('maps/chart-model.js')).chartCard(id, d.charts, d.pins, d.regions);
  return (await appModule('maps/galactic-model.js')).galacticCard(id, d.stars, d.lanes, d.sectors);
}

/** Does this place exist at all (to tell "hidden" from "no such place")? */
async function exists(library, projectId, id) {
  const system = systemOf(id);
  if (!system) return false;
  const d = await load(library, projectId, system);
  return Object.values(d).some((list) => list.some((x) => x.id === id));
}

/**
 * Build a push of a map system (checked by push-model.js):
 *   planes   { graph, box, focus }   the Planar board as players know it
 *   starmap  { map, box, focus }     the star map as players know it
 *   chart    { chart, box, focus }   one revealed chart, its fog baked in
 *   place    { place }               one place's card
 */
async function buildDisplay(library, req, project) {
  if (req.mode === 'place') {
    const place = await card(library, req.project, req.id);
    if (!place) throw (await exists(library, req.project, req.id)) ? new StoreError(409, 'That place is hidden from players: reveal it first') : new StoreError(404, 'No such place');
    return { project, place, title: place.name };
  }
  if (req.mode === 'planes') {
    const d = await load(library, req.project, 'planar');
    const graph = (await appModule('maps/planar-model.js')).playerPlanar(d.planes, d.ways);
    return { project, graph, box: req.box, focus: graph.planes.some((p) => p.id === req.focus) ? req.focus : null, title: 'Planes' };
  }
  if (req.mode === 'starmap') {
    const d = await load(library, req.project, 'galactic');
    const map = (await appModule('maps/galactic-model.js')).playerStarmap(d.stars, d.lanes, d.sectors);
    const focus = [...map.stars, ...map.sectors].some((x) => x.id === req.focus) ? req.focus : null;
    return { project, map, box: req.box, focus, title: 'Star Map' };
  }
  if (req.mode === 'chart') {
    const d = await load(library, req.project, 'cartographer');
    const source = d.charts.find((c) => c.id === req.id);
    if (!source) throw new StoreError(404, 'No such chart');
    const chart = (await appModule('maps/chart-model.js')).playerChart(source, d.pins, d.regions, d.charts);
    if (!chart) throw new StoreError(409, 'That chart is hidden from players: reveal it first');
    const focus = [...chart.pins, ...chart.regions].some((x) => x.id === req.focus) ? req.focus : null;
    return { project, chart, box: req.box, focus, title: chart.name };
  }
  return null;
}

/**
 * The Codex's places for a project's map system: [{ id, type: 'place', group: 'places', sub, title, image, summary, at }].
 * Only the system the project uses now (switching systems and back loses nothing).
 */
async function codexEntries(library, projectId, mode) {
  const system = ['planar', 'cartographer', 'galactic'].includes(mode) ? mode : null;
  if (!system) return [];
  const d = await load(library, projectId, system);
  const ids = Object.values(d).flat().map((x) => x.id);
  const out = [];
  for (const id of ids) {
    const c = await cardFrom(system, id, d);
    if (!c) continue;
    const at = Object.values(d).flat().find((x) => x.id === id)?.updatedAt ?? null;
    out.push({ id, type: 'place', group: 'places', sub: c.label, title: c.name, image: c.image ?? c.maps[0]?.image ?? null, summary: c.description.slice(0, 240), at });
  }
  return out;
}
async function cardFrom(system, id, d) {
  if (system === 'planar') return (await appModule('maps/planar-model.js')).planarCard(id, d.planes, d.ways);
  if (system === 'cartographer') return (await appModule('maps/chart-model.js')).chartCard(id, d.charts, d.pins, d.regions);
  return (await appModule('maps/galactic-model.js')).galacticCard(id, d.stars, d.lanes, d.sectors);
}

module.exports = { buildDisplay, card, codexEntries, systemOf };
