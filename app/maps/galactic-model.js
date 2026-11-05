// The Galactic map system (#/starmap): star systems, sectors and the lanes between
// them, on a top-down star map. Pure data + functions, shared by the GM window,
// the player screen and the server, which checks every save.
//
// Star { id: star_…, name, kind, x, y, description, revealed, maps, createdAt, updatedAt }
//   kind   star | planet | station | settlement | anomaly | nebula | unknown
//   x, y   on the map (±GALAXY), in "light years" as far as the readout is concerned
// Lane { id: lane_…, name, kind, from, to, travel, description, revealed, maps, … }
//   kind   hyperlane | jump | wormhole;  travel: free text ("3 days"), optional
//   from, to   the systems it joins: star_… or a unique place (unique_nightcity)
// Sector { id: sector_…, name, color, points, description, revealed, maps, … }
//   points  its outline, [[x, y]…], 3 to MAX_SECTOR_POINTS corners
//
// Night City stays a unique place here (uniqueStars): built in, revealed or hidden
// from Project settings, can't be renamed or deleted, but can be moved; where it
// sits is kept in settings.maps.nightCity.galactic.
//
// Players see revealed systems and sectors, and a revealed lane only when both
// its ends are revealed too (playerStarmap).

import { PlaceError, baseFields, oneOf, kindIn, within, round, str, cleanPoints, placeCard, inPolygon, AREA_COLORS } from './place-model.js';
import { UNIQUE_POIS } from './poi-model.js';

export const STAR_KINDS = [
  { id: 'star', label: 'Star system', glyph: '✷' },
  { id: 'planet', label: 'Planet', glyph: '●' },
  { id: 'station', label: 'Station', glyph: '⬡' },
  { id: 'settlement', label: 'Settlement', glyph: '■' },
  { id: 'anomaly', label: 'Anomaly', glyph: '✺' },
  { id: 'nebula', label: 'Nebula', glyph: '≋' },
  { id: 'unknown', label: 'Unknown', glyph: '?' },
];
export const LANE_KINDS = [
  { id: 'hyperlane', label: 'Hyperlane', glyph: '═' },
  { id: 'jump', label: 'Jump route', glyph: '⤳' },
  { id: 'wormhole', label: 'Wormhole', glyph: '◎' },
];
export const STAR_ID = /^star_[0-9a-f]{8}$/;
export const LANE_ID = /^lane_[0-9a-f]{8}$/;
export const SECTOR_ID = /^sector_[0-9a-f]{8}$/;
const UNIQUE_ID = /^unique_[a-z0-9_]+$/;
const END_ID = (id) => STAR_ID.test(id ?? '') || UNIQUE_ID.test(id ?? '');
export const GALAXY = 10000;
export const MAX_SECTOR_POINTS = 64;
const SPACE = { x0: -GALAXY, y0: -GALAXY, x1: GALAXY, y1: GALAXY };

export const starKind = kindIn(STAR_KINDS);
export const laneKind = (id) => LANE_KINDS.find((k) => k.id === id) ?? LANE_KINDS[0];

export function normalizeStar(input) {
  if (!input || typeof input !== 'object') throw new PlaceError(['A star system must be an object']);
  const problems = [];
  const base = baseFields(input, { id: STAR_ID, noun: 'star system', problems });
  const x = within(input.x, -GALAXY, GALAXY);
  const y = within(input.y, -GALAXY, GALAXY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) problems.push('A star system needs a place on the map');
  if (problems.length) throw new PlaceError(problems);
  return { ...base, kind: oneOf(input.kind, STAR_KINDS, 'star'), x: round(x, 1), y: round(y, 1) };
}

export function normalizeLane(input) {
  if (!input || typeof input !== 'object') throw new PlaceError(['A lane must be an object']);
  const problems = [];
  const base = baseFields(input, { id: LANE_ID, noun: 'lane', problems });
  if (!END_ID(input.from) || !END_ID(input.to)) problems.push('A lane needs a system at each end');
  else if (input.from === input.to) problems.push('A lane must lead to another system');
  if (problems.length) throw new PlaceError(problems);
  return { ...base, kind: oneOf(input.kind, LANE_KINDS), from: input.from, to: input.to, travel: str(input.travel, 40) };
}

export function normalizeSector(input) {
  if (!input || typeof input !== 'object') throw new PlaceError(['A sector must be an object']);
  const problems = [];
  const base = baseFields(input, { id: SECTOR_ID, noun: 'sector', problems });
  const points = cleanPoints(input.points, SPACE, MAX_SECTOR_POINTS, 1);
  if (points.length < 3) problems.push('A sector needs an outline of at least three corners');
  if (problems.length) throw new PlaceError(problems);
  return { ...base, color: oneOf(input.color, AREA_COLORS), points };
}

/** Where a unique place sits on the star map (from settings), or the centre. */
export function uniqueSpot(settings, key) {
  const g = settings?.maps?.[key]?.galactic;
  const x = within(g?.x, -GALAXY, GALAXY);
  const y = within(g?.y, -GALAXY, GALAXY);
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

/** The unique places a Galactic project shows, from its settings: [{ …star, unique: true, slug }]. */
export function uniqueStars(settings) {
  const maps = settings?.maps ?? {};
  if (maps.mode !== 'galactic') return [];
  return UNIQUE_POIS
    .filter((u) => u.modes.includes('galactic') && maps[u.key]?.enabled !== false)
    .map((u) => ({
      id: u.id, name: u.name, kind: 'settlement', ...uniqueSpot(settings, u.key), description: u.description,
      revealed: maps[u.key]?.revealed !== false, unique: true, slug: u.slug, maps: [],
    }));
}

/** The first revealed-or-not sector (in list order) whose outline holds the point. */
export const sectorAt = (sectors, point) => sectors.find((s) => inPolygon(s.points, point)) ?? null;

/**
 * The players' copy of the map: { stars, lanes, sectors }.
 *   stars    [{ id, name, kind, x, y, unique?, slug? }]   revealed ones
 *   lanes    [{ id, name, kind, from, to, travel }]       revealed, with both ends revealed
 *   sectors  [{ id, name, color, points }]                revealed ones
 */
export function playerStarmap(stars, lanes, sectors) {
  const shown = new Map(stars.filter((s) => s.revealed).map((s) => [s.id, s]));
  return {
    stars: [...shown.values()].map(({ id, name, kind, x, y, unique, slug }) => ({ id, name, kind, x, y, ...(unique ? { unique, slug } : {}) })),
    lanes: lanes.filter((l) => l.revealed && shown.has(l.from) && shown.has(l.to)).map(({ id, name, kind, from, to, travel }) => ({ id, name, kind, from, to, travel })),
    sectors: sectors.filter((s) => s.revealed).map(({ id, name, color, points }) => ({ id, name, color, points })),
  };
}

/** The players' card of a system, lane or sector, or null if they can't see it. */
export function galacticCard(id, stars, lanes, sectors) {
  const map = playerStarmap(stars, lanes, sectors);
  const known = sectors.filter((s) => s.revealed);
  const star = map.stars.find((s) => s.id === id);
  if (star) {
    const full = stars.find((s) => s.id === id);
    const k = starKind(star.kind);
    const sector = sectorAt(known, [star.x, star.y]);
    return placeCard({ id, type: 'star', name: star.name, glyph: k.glyph, label: star.unique ? `Unique ${k.label}` : k.label, where: sector ? `${sector.name} sector` : '', description: full.description, maps: full.maps });
  }
  if (map.lanes.some((l) => l.id === id)) {
    const l = lanes.find((x) => x.id === id);
    const k = laneKind(l.kind);
    const name = (sid) => map.stars.find((s) => s.id === sid).name;
    return placeCard({ id, type: 'lane', name: l.name, glyph: k.glyph, label: k.label, where: `${name(l.from)} ⇄ ${name(l.to)}${l.travel ? ` · ${l.travel}` : ''}`, description: l.description, maps: l.maps });
  }
  const s = known.find((x) => x.id === id);
  if (!s) return null;
  const inside = map.stars.filter((x) => inPolygon(s.points, [x.x, x.y])).length;
  return placeCard({ id, type: 'sector', name: s.name, glyph: '⬚', label: 'Sector', where: inside ? `${inside} known system${inside === 1 ? '' : 's'}` : '', description: s.description, maps: s.maps });
}
