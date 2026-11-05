// The Cartographer map system (#/atlas): hand-drawn maps of lands, cities and
// dungeons. The GM uploads a map image (a chart), places pins and draws regions
// on it, and lifts the fog of war bit by bit. Pure data + functions, shared by
// the GM window, the player screen and the server, which checks every save.
//
// Chart { id: chart_…, name, kind, image, width, height, description, revealed, maps,
//         fog, ops, playerImage, bakedKey, createdAt, updatedAt }
//   kind         land | region | city | dungeon | other
//   image        the uploaded map (img_…), GM only while fog is on; width/height its size in pixels
//   fog          players see the map under fog of war (the default)
//   ops          the fog brush, in order: [[clear, x, y, r]…], clear 1 lifts the fog, 0 lays it
//                back; x, y in 0..1 across and down, r a share of the longer side
//   playerImage  the players' copy (img_…): the map with the fog baked in, drawn by the GM's
//                browser (fog.js). Players never get `image` while fog is on, only this, and
//                only while it is up to date: bakedKey must match fogKey() of the chart now.
// Pin { id: pin_…, chart, name, icon, x, y, link, description, revealed, maps, … }
//   link         another chart this pin opens (drill down from a land to a city), or null
// Region { id: region_…, chart, name, color, points, lift, description, revealed, maps, … }
//   points       its outline [[x, y]…] in 0..1;  lift: revealing it clears the fog inside it
//
// Players see a chart's pins and regions only while the chart itself is revealed.

import { PlaceError, baseFields, oneOf, kindIn, within, round, cleanPoints, placeCard, AREA_COLORS } from './place-model.js';
import { ASSET_ID } from '../forge/preset-model.js';
import { CITY_POI_ICONS } from './city-poi-model.js';

export const CHART_KINDS = [
  { id: 'land', label: 'Land', glyph: '◭' },
  { id: 'region', label: 'Region', glyph: '▦' },
  { id: 'city', label: 'City', glyph: '■' },
  { id: 'dungeon', label: 'Dungeon', glyph: '▣' },
  { id: 'other', label: 'Other', glyph: '●' },
];
const icon = (id, label) => ({ ...CITY_POI_ICONS.find((i) => i.id === id), label });
export const PIN_ICONS = [
  icon('pin', 'Point of interest'),
  icon('landmark', 'Landmark'),
  { id: 'town', label: 'Town / village', d: 'M3 20V11l4-3 4 3v9 M11 20V8l5-4 5 4v12 M2 20h20 M15 11h2 M15 15h2' },
  icon('shop', 'Shop / market'),
  icon('bar', 'Tavern / inn'),
  icon('safehouse', 'Home / refuge'),
  icon('contact', 'Contact'),
  { id: 'camp', label: 'Camp', d: 'M3 20L12 5l9 15z M12 5v15 M8.5 20l3.5-6 3.5 6' },
  { id: 'door', label: 'Door / entrance', d: 'M6 21V4h12v17 M4 21h16 M14.5 12.5h.01' },
  { id: 'stairs', label: 'Stairs', d: 'M3 20h5v-4h4v-4h4V8h5' },
  { id: 'treasure', label: 'Treasure', d: 'M4 10h16v10H4z M4 10l2-5h12l2 5 M11 13h2v3h-2z' },
  icon('gang', 'Lair / foes'),
  icon('danger', 'Danger'),
];
export const pinIcon = (id) => PIN_ICONS.find((i) => i.id === id) ?? PIN_ICONS[0];

export const CHART_ID = /^chart_[0-9a-f]{8}$/;
export const PIN_ID = /^pin_[0-9a-f]{8}$/;
export const REGION_ID = /^region_[0-9a-f]{8}$/;
export const MAX_FOG_OPS = 5000;
export const MAX_REGION_POINTS = 200;
const MAX_SIDE = 20000;
const UNIT = { x0: 0, y0: 0, x1: 1, y1: 1 };

export const chartKind = kindIn(CHART_KINDS);

export function normalizeChart(input) {
  if (!input || typeof input !== 'object') throw new PlaceError(['A chart must be an object']);
  const problems = [];
  const base = baseFields(input, { id: CHART_ID, noun: 'chart', problems });
  if (!ASSET_ID.test(input.image ?? '')) problems.push('A chart needs a map image');
  const width = Math.round(within(input.width, 1, MAX_SIDE));
  const height = Math.round(within(input.height, 1, MAX_SIDE));
  if (!Number.isFinite(width) || !Number.isFinite(height)) problems.push('A chart needs the size of its image');
  const raw = Array.isArray(input.ops) ? input.ops : [];
  if (raw.length > MAX_FOG_OPS) problems.push('That\'s more fog painting than a chart can keep: clear or cover the whole map and start again');
  if (problems.length) throw new PlaceError(problems);
  const ops = raw
    .filter((o) => Array.isArray(o) && (o[0] === 0 || o[0] === 1) && [within(o[1], 0, 1), within(o[2], 0, 1), within(o[3], 0.001, 0.5)].every(Number.isFinite))
    .map(([c, x, y, r]) => [c, round(Number(x), 4), round(Number(y), 4), round(Number(r), 4)]);
  return {
    ...base,
    kind: oneOf(input.kind, CHART_KINDS, 'land'),
    image: input.image,
    width,
    height,
    fog: input.fog !== false,
    ops,
    playerImage: ASSET_ID.test(input.playerImage ?? '') ? input.playerImage : null,
    bakedKey: typeof input.bakedKey === 'string' ? input.bakedKey.slice(0, 32) : null,
  };
}

export function normalizePin(input) {
  if (!input || typeof input !== 'object') throw new PlaceError(['A pin must be an object']);
  const problems = [];
  const base = baseFields(input, { id: PIN_ID, noun: 'pin', problems });
  if (!CHART_ID.test(input.chart ?? '')) problems.push('A pin needs a chart');
  const x = within(input.x, 0, 1);
  const y = within(input.y, 0, 1);
  if (!Number.isFinite(x) || !Number.isFinite(y)) problems.push('A pin needs a place on the map');
  if (problems.length) throw new PlaceError(problems);
  return { ...base, chart: input.chart, icon: pinIcon(input.icon).id, x: round(x, 5), y: round(y, 5), link: CHART_ID.test(input.link ?? '') && input.link !== input.chart ? input.link : null };
}

export function normalizeRegion(input) {
  if (!input || typeof input !== 'object') throw new PlaceError(['A region must be an object']);
  const problems = [];
  const base = baseFields(input, { id: REGION_ID, noun: 'region', problems });
  if (!CHART_ID.test(input.chart ?? '')) problems.push('A region needs a chart');
  const points = cleanPoints(input.points, UNIT, MAX_REGION_POINTS, 5);
  if (points.length < 3) problems.push('A region needs an outline of at least three corners');
  if (problems.length) throw new PlaceError(problems);
  return { ...base, chart: input.chart, color: oneOf(input.color, AREA_COLORS), points, lift: input.lift !== false };
}

/** The regions whose reveal clears the fog on this chart. */
export const liftedRegions = (chart, regions) => regions.filter((r) => r.chart === chart.id && r.revealed && r.lift);

/**
 * What the fog looks like, as a short key: the image, the brush and the lifted regions.
 * A players' copy baked from a different key is out of date.
 */
export function fogKey(chart, regions) {
  const lifted = liftedRegions(chart, regions).map((r) => [r.id, r.points]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const text = JSON.stringify([chart.image, chart.ops ?? [], lifted]);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** The picture players get for a chart: the map itself without fog, the up-to-date baked copy with it, else null. */
export function playerImageOf(chart, regions) {
  if (!chart.fog) return chart.image;
  return chart.playerImage && chart.bakedKey === fogKey(chart, regions) ? chart.playerImage : null;
}

/** Pins and regions players can see on a chart (only while it's revealed). */
export const visibleOn = (chart, list) => (chart?.revealed ? list.filter((x) => x.chart === chart.id && x.revealed) : []);

/**
 * The players' copy of a chart, or null while it's hidden:
 * { id, name, kind, description, width, height, image, covered, pins, regions }.
 *   image    playerImageOf(): never the GM's map while fog is on
 *   covered  fog is on and no up-to-date players' copy exists yet
 *   pins     [{ id, name, icon, x, y, link }]: link only to a revealed chart
 *   regions  [{ id, name, color, points }]
 */
export function playerChart(chart, pins, regions, charts = []) {
  if (!chart?.revealed) return null;
  const image = playerImageOf(chart, regions);
  const open = new Set(charts.filter((c) => c.revealed).map((c) => c.id));
  return {
    id: chart.id, name: chart.name, kind: chart.kind, description: chart.description, width: chart.width, height: chart.height,
    image, covered: !image,
    pins: visibleOn(chart, pins).map(({ id, name, icon: i, x, y, link }) => ({ id, name, icon: i, x, y, link: link && open.has(link) ? link : null })),
    regions: visibleOn(chart, regions).map(({ id, name, color, points }) => ({ id, name, color, points })),
  };
}

/** The players' card of a chart, pin or region, or null if they can't see it. */
export function chartCard(id, charts, pins, regions) {
  if (CHART_ID.test(id)) {
    const c = charts.find((x) => x.id === id);
    if (!c?.revealed) return null;
    const k = chartKind(c.kind);
    const n = visibleOn(c, pins).length;
    return placeCard({ id, type: 'chart', name: c.name, glyph: k.glyph, label: `${k.label} map`, where: n ? `${n} marked place${n === 1 ? '' : 's'}` : '', description: c.description, maps: c.maps, image: playerImageOf(c, regions) });
  }
  const isPin = PIN_ID.test(id);
  const item = (isPin ? pins : regions).find((x) => x.id === id);
  const chart = item && charts.find((c) => c.id === item.chart);
  if (!item || !visibleOn(chart, [item]).length) return null;
  if (isPin) {
    const i = pinIcon(item.icon);
    return placeCard({ id, type: 'pin', name: item.name, glyph: '⌖', label: i.label, where: `On ${chart.name}`, description: item.description, maps: item.maps });
  }
  return placeCard({ id, type: 'region', name: item.name, glyph: '⬚', label: 'Region', where: `On ${chart.name}`, description: item.description, maps: item.maps });
}
