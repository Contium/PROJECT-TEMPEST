// Pushing to the player screen: what the GM can push, and the players' copy of
// what gets pushed. Pure data + functions, shared by the GM window, the player
// screen and the server.
//
// The GM sends a push *request* (normalizePushRequest): which entry, image or map
// to show. The server turns it into the *display*, the players' copy, built
// here (playerEntity, rosterEntry) so nothing GM-only can reach a player window:
// only Revealed fields keep their contents, Shown fields carry their
// players-read text, Rumored fields carry nothing, Hidden fields are left out
// altogether (not even their labels), references are dropped.
//
// Modes
//   ambient   nothing pushed: the screen stands by
//   message   { title, text, tone }                        an announcement (tone danger = flashing alert)
//   entity    { project, id }                              an entry's sheet, as players see it
//   roster    { project, kind, category }                  every entry on a tab (names, pictures, summaries)
//   handout   { project, image, caption }                  one picture, full screen
//             { project, id }                              or a handout (Sessions › Handouts), as players see it
//   recap     { project, id }                              a session's recap ("Previously…")
//   globe     { project, view: { lon, lat }, zoom, focus }  the World View globe with the revealed POIs
//   poi       { project, id }                              one World View POI (revealed only)
//   citymap   { project, city, layer, district }           a City Map with its revealed POIs, a district lit
//   citypoi   { project, city, id }                        one City Map POI (revealed only)
//   article   { project, id }                              a screamsheet (revealed only), as printed
//   network   { project, id, focus }                       a NET architecture: its revealed nodes, one lit
//   planes    { project, box, focus }                      the Planar board: revealed planes and ways, one lit
//   starmap   { project, box, focus }                      the star map: revealed systems, lanes, sectors
//   chart     { project, id, box, focus }                  a Cartographer chart (revealed), fog baked in
//   place     { project, id }                              one place of those three systems (revealed only)
//   timeline  { project }                                  World › Timeline: what's in the players' Codex, dated, in order
// box is the part of the map to show ({ x0, y0, x1, y1 }: board units, or 0..1 of a chart), or
// null for all of it; focus lights one thing on it.

import { ENTITY_ID, ASSET_ID, KINDS, fieldsInOrder } from '../forge/preset-model.js';
import { cleanBox } from '../maps/place-model.js';

export const PUSH_MODES = ['ambient', 'message', 'entity', 'roster', 'handout', 'globe', 'poi', 'citymap', 'citypoi', 'article', 'network', 'planes', 'starmap', 'chart', 'place', 'timeline', 'recap'];
export const TONES = [
  { id: 'info', label: 'Info' },
  { id: 'success', label: 'Good news' },
  { id: 'warning', label: 'Warning' },
  { id: 'danger', label: 'Alert (flashing)' },
];
const PROJECT_ID = /^proj_[0-9a-f]{8}$/;
const SLUG = /^[a-z0-9-]{1,64}$/;
const THEME_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const GLOBE_POI = /^(poi_[0-9a-f]{8}|unique_[a-z0-9_]+)$/;
const CITY_POI = /^cpoi_[0-9a-f]{8}$/;
const SCREAMSHEET = /^ss_[0-9a-f]{8}$/;
const NETWORK = /^net_[0-9a-f]{8}$/;
const NET_NODE = /^n[0-9a-f]{6}$/;
const PLANE = /^plane_[0-9a-f]{8}$/;
const STAR = /^(star_[0-9a-f]{8}|sector_[0-9a-f]{8}|unique_[a-z0-9_]+)$/;
const CHART = /^chart_[0-9a-f]{8}$/;
const CHART_PART = /^(pin|region)_[0-9a-f]{8}$/;
const PLACE = /^((plane|way|chart|pin|region|star|lane|sector)_[0-9a-f]{8}|unique_[a-z0-9_]+)$/;
const HANDOUT = /^hand_[0-9a-f]{8}$/;
const SESSION = /^sess_[0-9a-f]{8}$/;

/** The animation family the themes key on (data-push-kind on the player screen). */
export const pushKind = (mode) => ({ entity: 'entity', poi: 'entity', citypoi: 'entity', place: 'entity', roster: 'roster', handout: 'handout', message: 'message', globe: 'map', citymap: 'map', network: 'map', planes: 'map', starmap: 'map', chart: 'map', article: 'article', timeline: 'roster', recap: 'handout' })[mode] ?? 'ambient';

export class PushError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : dflt);

/** Check a push request from the GM. Throws PushError. */
export function normalizePushRequest(input) {
  if (!input || typeof input !== 'object') throw new PushError('A push must be an object');
  const mode = input.mode;
  if (!PUSH_MODES.includes(mode)) throw new PushError('Unknown push');
  const out = { mode };
  if (THEME_ID.test(input.theme ?? '')) out.theme = input.theme;
  if (mode === 'ambient') return out;
  if (mode === 'message') {
    const body = text(input.text, 2000);
    if (!body) throw new PushError('A message needs some text');
    return { ...out, title: text(input.title, 120), text: body, tone: TONES.some((t) => t.id === input.tone) ? input.tone : 'info' };
  }
  if (!PROJECT_ID.test(input.project ?? '')) throw new PushError('A push needs a project');
  out.project = input.project;
  switch (mode) {
    case 'entity':
      if (!ENTITY_ID.test(input.id ?? '')) throw new PushError('No such entry', 404);
      return { ...out, id: input.id };
    case 'roster':
      if (!KINDS[input.kind]) throw new PushError('No such list', 404);
      if (input.category != null && !KINDS[input.kind].categories.some((c) => c.id === input.category)) throw new PushError('No such list', 404);
      return { ...out, kind: input.kind, category: input.category ?? null };
    case 'handout':
      if (HANDOUT.test(input.id ?? '')) return { ...out, id: input.id };
      if (!ASSET_ID.test(input.image ?? '')) throw new PushError('No such image', 404);
      return { ...out, image: input.image, caption: text(input.caption, 120) };
    case 'recap':
      if (!SESSION.test(input.id ?? '')) throw new PushError('No such session', 404);
      return { ...out, id: input.id };
    case 'globe':
      return {
        ...out,
        view: { lon: num(input.view?.lon, -180, 180, 0), lat: num(input.view?.lat, -90, 90, 20) },
        zoom: num(input.zoom, 0.6, 6, 1),
        focus: GLOBE_POI.test(input.focus ?? '') ? input.focus : null,
      };
    case 'article':
      if (!SCREAMSHEET.test(input.id ?? '')) throw new PushError('No such screamsheet', 404);
      return { ...out, id: input.id };
    case 'timeline':
      return out;
    case 'network':
      if (!NETWORK.test(input.id ?? '')) throw new PushError('No such network', 404);
      return { ...out, id: input.id, focus: NET_NODE.test(input.focus ?? '') ? input.focus : null };
    case 'poi':
      if (!GLOBE_POI.test(input.id ?? '')) throw new PushError('No such point of interest', 404);
      return { ...out, id: input.id };
    case 'planes':
      return { ...out, box: cleanBox(input.box, -20000, 20000), focus: PLANE.test(input.focus ?? '') ? input.focus : null };
    case 'starmap':
      return { ...out, box: cleanBox(input.box, -20000, 20000), focus: STAR.test(input.focus ?? '') ? input.focus : null };
    case 'chart':
      if (!CHART.test(input.id ?? '')) throw new PushError('No such chart', 404);
      return { ...out, id: input.id, box: cleanBox(input.box, -1, 2), focus: CHART_PART.test(input.focus ?? '') ? input.focus : null };
    case 'place':
      if (!PLACE.test(input.id ?? '')) throw new PushError('No such place', 404);
      return { ...out, id: input.id };
    case 'citymap':
    case 'citypoi': {
      if (!SLUG.test(input.city ?? '')) throw new PushError('No such city map', 404);
      if (mode === 'citypoi') {
        if (!CITY_POI.test(input.id ?? '')) throw new PushError('No such point of interest', 404);
        return { ...out, city: input.city, id: input.id };
      }
      return { ...out, city: input.city, layer: SLUG.test(input.layer ?? '') ? input.layer : null, district: SLUG.test(input.district ?? '') ? input.district : null };
    }
    default:
      throw new PushError('Unknown push');
  }
}

/** Every entity id inside a value (parents, cast members, locations…). */
export function idsIn(value, out = new Set()) {
  if (typeof value === 'string') {
    if (ENTITY_ID.test(value)) out.add(value);
  } else if (Array.isArray(value)) value.forEach((v) => idsIn(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => idsIn(v, out));
  return out;
}

const fieldOf = (entity, id) => entity?.sheet?.fields?.[id];
const revealed = (entity, id) => fieldOf(entity, id)?.visibility === 'revealed';

/**
 * The players' copy of an entity: its sheet without GM-only defaults, the values
 * of Revealed fields only, the players-read text of Shown fields, and names /
 * pictures for the entries it links to (each as its own sheet allows).
 * `linked` maps ids to full entities (missing ones show as unknown).
 */
export function playerEntity(entity, linked = new Map()) {
  const sheet = structuredClone(entity.sheet);
  const values = {};
  const shown = {};
  for (const field of fieldsInOrder(entity.sheet)) {
    const vis = field.visibility;
    // Hidden: players get nothing of it, not even its label (the sheet draws nothing for a missing field).
    if (vis === 'hidden') {
      delete sheet.fields[field.id];
      continue;
    }
    if (vis !== 'revealed') delete sheet.fields[field.id].default;
    if (vis === 'revealed' && field.id in (entity.values ?? {})) values[field.id] = structuredClone(entity.values[field.id]);
    if (vis === 'shown') shown[field.id] = text(entity.shown?.[field.id], 4000) || field.shown || '';
  }
  // Hidden fields leave the layout too, and a section with nothing left loses its heading.
  const kept = (id) => id in sheet.fields;
  sheet.layout = {
    ...sheet.layout,
    main: (sheet.layout?.main ?? []).filter(kept),
    sections: (sheet.layout?.sections ?? [])
      .map((s) => ({ ...s, columns: s.layout === 'body' ? s.columns.map((c) => c.filter(kept)) : s.columns.map((c) => c.filter(kept)).filter((c) => c.length) }))
      .filter((s) => s.columns.some((c) => c.length)),
  };
  const links = {};
  for (const id of idsIn(values)) {
    const other = linked.get(id);
    links[id] = other
      ? { name: revealed(other, 'name') ? other.name : null, image: revealed(other, 'image') ? other.values?.image ?? null : null }
      : { name: null, image: null };
  }
  return {
    id: entity.id,
    kind: entity.kind,
    name: revealed(entity, 'name') ? entity.name : null,
    category: revealed(entity, 'category') ? entity.category : null,
    sheet,
    values,
    shown,
    links,
  };
}

/** One card in a pushed list: name, picture and summary, each only as its field allows. */
export function rosterEntry(entity) {
  const vis = (id) => fieldOf(entity, id)?.visibility;
  const summary = vis('summary') === 'revealed' ? text(entity.values?.summary, 400) : vis('summary') === 'shown' ? text(entity.shown?.summary || fieldOf(entity, 'summary')?.shown, 400) : '';
  return {
    id: entity.id,
    name: vis('name') === 'revealed' ? entity.name : null,
    image: vis('image') === 'revealed' ? entity.values?.image ?? null : null,
    summary,
  };
}

/** A short line for what's on screen (the GM's top bar, the player window's title). */
export const displayLabel = (d) => (d?.mode && d.mode !== 'ambient' ? d.title || 'Pushed view' : 'Standing by');
