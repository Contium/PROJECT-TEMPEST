// The Planar map system (#/planes): planes and realms, and the ways between them.
// Pure data + functions, shared by the GM window, the player screen and the
// server, which checks every save with normalizePlane() / normalizeWay().
//
// Plane { id: plane_…, name, kind, x, y, description, revealed, maps, createdAt, updatedAt }
//   kind   material | elemental | outer | demiplane | pocket | unknown
//   x, y   where it sits on the GM's board (free layout, ±PLANAR_SPACE)
// Way { id: way_…, name, kind, from, to, oneWay, hint, description, revealed, maps, … }
//   kind   portal | gate | rift | path | ritual
//   from, to   the planes it joins (different ones); oneWay: only from → to
//   hint   while players don't know the way, they see a dashed "?" leading off a
//          plane they do know: there's a door here to somewhere
//
// Players see revealed planes, and a revealed way only when both its planes are
// revealed too (playerPlanar).

import { PlaceError, baseFields, oneOf, kindIn, within, round, placeCard } from './place-model.js';

export const PLANE_KINDS = [
  { id: 'material', label: 'Material plane', glyph: '◉' },
  { id: 'elemental', label: 'Elemental plane', glyph: '✦' },
  { id: 'outer', label: 'Outer plane', glyph: '✧' },
  { id: 'demiplane', label: 'Demiplane', glyph: '◇' },
  { id: 'pocket', label: 'Pocket realm', glyph: '◌' },
  { id: 'unknown', label: 'Unknown', glyph: '?' },
];
export const WAY_KINDS = [
  { id: 'portal', label: 'Portal', glyph: '○' },
  { id: 'gate', label: 'Gate', glyph: '⊓' },
  { id: 'rift', label: 'Rift', glyph: '≀' },
  { id: 'path', label: 'Path', glyph: '⋯' },
  { id: 'ritual', label: 'Ritual', glyph: '✶' },
];
export const PLANE_ID = /^plane_[0-9a-f]{8}$/;
export const WAY_ID = /^way_[0-9a-f]{8}$/;
export const PLANAR_SPACE = 10000;

export const planeKind = kindIn(PLANE_KINDS);
export const wayKind = (id) => WAY_KINDS.find((k) => k.id === id) ?? WAY_KINDS[0];

/** Check and tidy a plane. Throws PlaceError. */
export function normalizePlane(input) {
  if (!input || typeof input !== 'object') throw new PlaceError(['A plane must be an object']);
  const problems = [];
  const base = baseFields(input, { id: PLANE_ID, noun: 'plane', problems });
  const x = within(input.x, -PLANAR_SPACE, PLANAR_SPACE);
  const y = within(input.y, -PLANAR_SPACE, PLANAR_SPACE);
  if (!Number.isFinite(x) || !Number.isFinite(y)) problems.push('A plane needs a place on the board');
  if (problems.length) throw new PlaceError(problems);
  return { ...base, kind: oneOf(input.kind, PLANE_KINDS, 'unknown'), x: round(x, 1), y: round(y, 1) };
}

/** Check and tidy a way. Throws PlaceError. */
export function normalizeWay(input) {
  if (!input || typeof input !== 'object') throw new PlaceError(['A way must be an object']);
  const problems = [];
  const base = baseFields(input, { id: WAY_ID, noun: 'way', problems });
  if (!PLANE_ID.test(input.from ?? '') || !PLANE_ID.test(input.to ?? '')) problems.push('A way needs a plane at each end');
  else if (input.from === input.to) problems.push('A way must lead to another plane');
  if (problems.length) throw new PlaceError(problems);
  return { ...base, kind: oneOf(input.kind, WAY_KINDS), from: input.from, to: input.to, oneWay: input.oneWay === true, hint: input.hint === true };
}

export const planesForPlayers = (planes) => planes.filter((p) => p.revealed);

/** Can players see this way? Revealed, with both of its planes revealed. */
export const wayVisible = (way, shown) => way.revealed && shown.has(way.from) && shown.has(way.to);

/**
 * The players' copy of the board: { planes, ways, hints }.
 *   planes  [{ id, name, kind, x, y }]          revealed ones
 *   ways    [{ id, name, kind, from, to, oneWay }]  visible ones (wayVisible)
 *   hints   [{ id, at, angle, inbound }]        a hinted way players don't know yet, leading off
 *           a plane they do (at); angle (radians) points towards its other end, so the "?"
 *           sits on the right side; inbound marks a one-way way that only comes in.
 * Nothing else: no descriptions or maps here (see planarCard), no hidden planes' names or places.
 */
export function playerPlanar(planes, ways) {
  const shown = new Map(planesForPlayers(planes).map((p) => [p.id, p]));
  const all = new Map(planes.map((p) => [p.id, p]));
  const out = { planes: [...shown.values()].map(({ id, name, kind, x, y }) => ({ id, name, kind, x, y })), ways: [], hints: [] };
  for (const w of ways) {
    if (!all.has(w.from) || !all.has(w.to)) continue;
    if (wayVisible(w, shown)) {
      out.ways.push({ id: w.id, name: w.name, kind: w.kind, from: w.from, to: w.to, oneWay: w.oneWay });
      continue;
    }
    if (!w.hint) continue;
    const ends = [w.from, w.to].filter((id) => shown.has(id));
    if (ends.length !== 1) continue; // both known: the way itself is still hidden, and a "?" would say there is one between them
    const at = ends[0];
    const here = all.get(at);
    const there = all.get(at === w.from ? w.to : w.from);
    out.hints.push({ id: w.id, at, angle: round(Math.atan2(there.y - here.y, there.x - here.x), 2), inbound: w.oneWay && at === w.to });
  }
  return out;
}

/** The players' card of a plane or a way, or null if they can't see it. */
export function planarCard(id, planes, ways) {
  const shown = new Map(planesForPlayers(planes).map((p) => [p.id, p]));
  if (PLANE_ID.test(id)) {
    const p = shown.get(id);
    if (!p) return null;
    const k = planeKind(p.kind);
    const links = ways.filter((w) => wayVisible(w, shown) && (w.from === id || w.to === id)).length;
    return placeCard({ id, type: 'plane', name: p.name, glyph: k.glyph, label: k.label, where: links ? `${links} known way${links === 1 ? '' : 's'} in or out` : '', description: p.description, maps: p.maps });
  }
  const w = ways.find((x) => x.id === id);
  if (!w || !wayVisible(w, shown)) return null;
  const k = wayKind(w.kind);
  const [a, b] = [shown.get(w.from).name, shown.get(w.to).name];
  return placeCard({ id, type: 'way', name: w.name, glyph: k.glyph, label: k.label, where: w.oneWay ? `From ${a} to ${b} (one way)` : `Between ${a} and ${b}`, description: w.description, maps: w.maps });
}
