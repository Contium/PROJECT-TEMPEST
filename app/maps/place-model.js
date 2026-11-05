// What the Planar, Cartographer and Galactic map systems share: the checks every
// place goes through, and the players' card of one place. Pure data + functions,
// shared by the GM window, the player screen and the server.
//
// Every place has a name, a description, attached maps (uploaded pictures) and is
// Hidden from players until the GM reveals it. Each system adds its own fields
// (planar-model.js, chart-model.js, galactic-model.js).
//
// PlaceCard: one place as players see it, whatever the system (a push, the Codex):
//   { id, type, name, glyph, label, where, description, maps, image }
//   type   plane | way | chart | pin | region | star | lane | sector
//   label  what it is ("Portal", "Dungeon", "Star system"); where: the context
//          ("Between the Feywild and the Material Plane"), or ''
//   image  a picture of the place itself (a chart's players' copy), or null

import { cleanMaps } from './poi-model.js';

export class PlaceError extends Error {
  constructor(problems) {
    super(problems.join('; '));
    this.problems = problems;
  }
}

export const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const oneOf = (v, list, fallback = list[0].id) => (list.some((x) => x.id === v) ? v : fallback);
export const kindIn = (list) => (id) => list.find((k) => k.id === id) ?? list.at(-1);
const finite = (v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN;

/** A number within [lo, hi], or NaN. */
export function within(v, lo, hi) {
  const n = finite(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : NaN;
}
export const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * The fields every place has, checked: { id, name, description, revealed, maps, createdAt, updatedAt }.
 * `problems` collects what's wrong (a name is required).
 */
export function baseFields(input, { id, noun, problems, maxDescription = 2000 }) {
  const name = str(input.name, 80);
  if (!name) problems.push(`A ${noun} needs a name`);
  const now = new Date().toISOString();
  return {
    id: id.test(input.id ?? '') ? input.id : null,
    name,
    description: str(input.description, maxDescription),
    revealed: input.revealed === true,
    maps: cleanMaps(input.maps),
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : now,
  };
}

/** Points: [[x, y]…] within the box, rounded; at most `max` of them. */
export function cleanPoints(list, { x0, y0, x1, y1 }, max, places = 2) {
  return (Array.isArray(list) ? list : [])
    .filter((p) => Array.isArray(p) && Number.isFinite(within(p[0], x0, x1)) && Number.isFinite(within(p[1], y0, y1)))
    .slice(0, max)
    .map(([x, y]) => [round(Number(x), places), round(Number(y), places)]);
}

/** A box { x0, y0, x1, y1 } inside the limits with some size, or null. */
export function cleanBox(b, lo, hi) {
  if (!b || typeof b !== 'object') return null;
  const [x0, y0, x1, y1] = [b.x0, b.y0, b.x1, b.y1].map((v) => within(v, lo, hi));
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

/** The players' card of one place. */
export const placeCard = ({ id, type, name, glyph, label, where = '', description = '', maps = [], image = null }) => ({ id, type, name, glyph, label, where, description, maps, image });

/** Box around points [[x, y]…]. */
export function boundsOf(points) {
  if (!points.length) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Even-odd point-in-polygon. */
export function inPolygon(points, [px, py]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The colours regions and sectors can take (the themes draw them). */
export const AREA_COLORS = [
  { id: 'cyan', label: 'Cyan', hex: '#38d6f0' },
  { id: 'magenta', label: 'Magenta', hex: '#f04fb4' },
  { id: 'amber', label: 'Amber', hex: '#f0b43c' },
  { id: 'green', label: 'Green', hex: '#5ee07a' },
  { id: 'violet', label: 'Violet', hex: '#a07cf8' },
  { id: 'red', label: 'Red', hex: '#f0564b' },
];
export const colorOf = (id) => AREA_COLORS.find((c) => c.id === id) ?? AREA_COLORS[0];
