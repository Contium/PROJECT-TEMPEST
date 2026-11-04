// Points of interest on the World View globe. Pure data + functions, shared by
// the World View and the server, which checks every save with normalizePoi().
//
// Poi { id, name, type, lon, lat, description, revealed, maps, createdAt, updatedAt }
//   type      city | landmark | poi | other | unknown
//   revealed  players can see it (hidden POIs are the GM's alone)
//   maps      [{ image, caption }]: attached maps / pictures (uploaded images)
//
// Unique POIs (UNIQUE_POIS) are built in rather than saved: they come from the
// project's settings (on/off, revealed) and can't be moved, renamed or deleted.
// Each leads to a system of its own (Night City: its City Map).

import { ASSET_ID } from '../forge/preset-model.js';

export const POI_TYPES = [
  { id: 'city', label: 'City', glyph: '■' },
  { id: 'landmark', label: 'Landmark', glyph: '▲' },
  { id: 'poi', label: 'Point of Interest', glyph: '◆' },
  { id: 'other', label: 'Other', glyph: '●' },
  { id: 'unknown', label: 'Unknown', glyph: '?' },
];
export const POI_ID = /^poi_[0-9a-f]{8}$/;
export const MAX_MAPS = 12;

/** Attached maps: [{ image: img_…, caption }], at most MAX_MAPS, each image once. */
export function cleanMaps(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .filter((m) => m && ASSET_ID.test(m.image ?? '') && !seen.has(m.image) && seen.add(m.image))
    .slice(0, MAX_MAPS)
    .map((m) => ({ image: m.image, caption: typeof m.caption === 'string' ? m.caption.trim().slice(0, 120) : '' }));
}

export class PoiError extends Error {
  constructor(problems) {
    super(problems.join('; '));
    this.problems = problems;
  }
}

export const typeOf = (id) => POI_TYPES.find((t) => t.id === id) ?? POI_TYPES[2];

/** Check and tidy a POI. Throws PoiError for what can't be repaired. */
export function normalizePoi(input) {
  if (!input || typeof input !== 'object') throw new PoiError(['A point of interest must be an object']);
  const problems = [];
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
  if (!name) problems.push('A point of interest needs a name');
  const lon = Number(input.lon);
  const lat = Number(input.lat);
  if (!Number.isFinite(lon) || lon < -180 || lon > 180 || !Number.isFinite(lat) || lat < -90 || lat > 90) problems.push('A point of interest needs a place on the globe');
  if (problems.length) throw new PoiError(problems);
  const now = new Date().toISOString();
  return {
    id: POI_ID.test(input.id ?? '') ? input.id : null,
    name,
    type: POI_TYPES.some((t) => t.id === input.type) ? input.type : 'poi',
    lon: Math.round(lon * 1e5) / 1e5,
    lat: Math.round(lat * 1e5) / 1e5,
    description: typeof input.description === 'string' ? input.description.trim().slice(0, 1000) : '',
    revealed: input.revealed === true,
    maps: cleanMaps(input.maps),
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : now,
  };
}

/** What players get: only revealed POIs. */
export const forPlayers = (pois) => pois.filter((p) => p.revealed);

/** Built-in POIs, keyed into settings.maps (e.g. maps.nightCity). */
export const UNIQUE_POIS = [
  {
    id: 'unique_nightcity', key: 'nightCity', slug: 'nightcity',
    name: 'Night City', type: 'city', lat: 35.3658, lon: -120.8499,
    description: 'The Free City of Night City, on the coast of the Free State of Northern California.',
    modes: ['planetary', 'galactic'],
  },
];
export const isUnique = (id) => UNIQUE_POIS.some((u) => u.id === id);

/** The unique POIs a project shows, from its settings: [{ …poi, unique: true, revealed }]. */
export function uniquePois(settings) {
  const maps = settings?.maps ?? {};
  return UNIQUE_POIS
    .filter((u) => u.modes.includes(maps.mode) && maps[u.key]?.enabled !== false)
    .map((u) => ({
      id: u.id, name: u.name, type: u.type, lon: u.lon, lat: u.lat, description: u.description,
      revealed: maps[u.key]?.revealed !== false, unique: true, slug: u.slug, maps: [],
    }));
}