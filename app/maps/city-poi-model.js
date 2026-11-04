// Points of interest on a City Map (Night City's, for now). Pure data +
// functions, shared by the City Map and the server, which checks every save
// with normalizeCityPoi().
//
// CityPoi {
//   id: cpoi_xxxxxxxx, city: 'nightcity',
//   name, icon, description,
//   x, y          where on the map, 0..1 across and down the atlas
//   district      the district it sits in (an id from the city's districts.json),
//                 found from x, y when placed or moved; null outside every district
//   revealed      players can see it (hidden ones are the GM's alone)
//   refs: [{ id, note }]       GM-only links to anything in the project (characters,
//                              events, stories, rumors, items), with an optional note
//   maps: [{ image, caption }] attached maps / pictures (uploaded images)
//   createdAt, updatedAt
// }

import { ENTITY_ID } from '../forge/preset-model.js';
import { cleanMaps, MAX_MAPS } from './poi-model.js';

export { MAX_MAPS };

export const CITY_POI_ID = /^cpoi_[0-9a-f]{8}$/;
export const CITY_SLUG = /^[a-z0-9-]{1,32}$/;
const DISTRICT_ID = /^[a-z0-9-]{1,64}$/;
export const MAX_REFS = 40;

// Twelve icons, drawn in a 24 x 24 box with strokes (currentColor) so they take
// the theme's colours. `d` is SVG path data.
export const CITY_POI_ICONS = [
  { id: 'pin', label: 'Point of interest', d: 'M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z M12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z' },
  { id: 'landmark', label: 'Landmark', d: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z' },
  { id: 'bar', label: 'Bar / club', d: 'M5 4h14l-7 8z M12 12v7 M8 20h8 M7.5 6.5h9' },
  { id: 'shop', label: 'Shop / market', d: 'M5 8h14l-1 12H6z M9 8V6a3 3 0 0 1 6 0v2' },
  { id: 'clinic', label: 'Clinic / ripperdoc', d: 'M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z' },
  { id: 'gang', label: 'Gang turf', d: 'M12 3a7 7 0 0 0-7 7c0 2.6 1.4 4.3 3 5.2V19h8v-3.8c1.6-.9 3-2.6 3-5.2a7 7 0 0 0-7-7z M9 10.5h.01 M15 10.5h.01 M10.5 19v-2 M13.5 19v-2' },
  { id: 'corp', label: 'Corporate', d: 'M6 21V4h8v17 M14 9h4v12 M4 21h16 M8.5 7h3 M8.5 10.5h3 M8.5 14h3 M8.5 17.5h3' },
  { id: 'safehouse', label: 'Safehouse / home', d: 'M4 11l8-7 8 7 M6 9.5V20h12V9.5 M10 20v-5h4v5' },
  { id: 'contact', label: 'Contact / fixer', d: 'M4 5h16v11h-9l-5 4v-4H4z M8 9.5h8 M8 12.5h5' },
  { id: 'net', label: 'Net / data', d: 'M7 7h10v10H7z M10 10h4v4h-4z M10 4v3 M14 4v3 M10 17v3 M14 17v3 M4 10h3 M4 14h3 M17 10h3 M17 14h3' },
  { id: 'police', label: 'Police / security', d: 'M12 3l7 3v5c0 4.6-3 8.3-7 10-4-1.7-7-5.4-7-10V6z M9 12l2 2 4-4' },
  { id: 'danger', label: 'Danger', d: 'M12 4l9 16H3z M12 10v4.5 M12 17.2h.01' },
];
export const iconOf = (id) => CITY_POI_ICONS.find((i) => i.id === id) ?? CITY_POI_ICONS[0];

export class CityPoiError extends Error {
  constructor(problems) {
    super(problems.join('; '));
    this.problems = problems;
  }
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Check and tidy a city POI. Throws CityPoiError for what can't be repaired. */
export function normalizeCityPoi(input) {
  if (!input || typeof input !== 'object') throw new CityPoiError(['A point of interest must be an object']);
  const problems = [];
  const name = text(input.name, 80);
  if (!name) problems.push('A point of interest needs a name');
  if (!CITY_SLUG.test(input.city ?? '')) problems.push('A point of interest needs a city');
  const x = Number(input.x);
  const y = Number(input.y);
  if (!Number.isFinite(x) || x < 0 || x > 1 || !Number.isFinite(y) || y < 0 || y > 1) problems.push('A point of interest needs a place on the map');
  if (problems.length) throw new CityPoiError(problems);

  const seen = new Set();
  const refs = (Array.isArray(input.refs) ? input.refs : [])
    .map((r) => (typeof r === 'string' ? { id: r } : r))
    .filter((r) => r && ENTITY_ID.test(r.id ?? '') && !seen.has(r.id) && seen.add(r.id))
    .slice(0, MAX_REFS)
    .map((r) => ({ id: r.id, note: text(r.note, 200) }));
  const maps = cleanMaps(input.maps);


  const now = new Date().toISOString();
  return {
    id: CITY_POI_ID.test(input.id ?? '') ? input.id : null,
    city: input.city,
    name,
    icon: iconOf(input.icon).id,
    x: Math.round(x * 1e5) / 1e5,
    y: Math.round(y * 1e5) / 1e5,
    district: DISTRICT_ID.test(input.district ?? '') ? input.district : null,
    description: text(input.description, 2000),
    revealed: input.revealed === true,
    refs,
    maps,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : now,
  };
}

/** What players get: revealed POIs only, without the GM's references. */
export const forPlayers = (pois) => pois.filter((p) => p.revealed).map(({ refs, ...rest }) => ({ ...rest, refs: [] }));

/** POIs grouped by district id ('' for those outside every district). */
export function byDistrict(pois) {
  const out = new Map();
  for (const p of pois) {
    const key = p.district ?? '';
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(p);
  }
  return out;
}
