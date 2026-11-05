// NET architectures (Combat › Netrunning): the GM puts net cards together into a
// network in the Network Builder, keeps it under Networks, and reveals it to the
// players one node at a time. Pure data + functions (no DOM), shared by the
// browser and the server, which checks every save with normalizeNetwork().
//
// Network {
//   format: 'tempest.network', version: 1, id: 'net_…', name, description,
//   nodes: [{
//     id: 'n…',        unique in the network
//     card,            the net card it shows (ncard_…), or null for an empty slot
//     label,           what the node is called on the map, instead of the card's name
//                      ("Control Node (Cameras)"); players read it once the node is revealed
//     dv,              the node's DV, instead of the card's ("8")
//     count,           how many of it there are (Hellhound ×2)
//     note,            GM only: what happens here, never sent to players
//     parents: [id],   the nodes above it; a node with none starts a branch at the top.
//                      Two parents merge two branches into one node.
//   }],
//   revealed: [nodeId],   what the players have found so far
//   hints: bool,          players also see a blank box for each node the next step down
//   createdAt, updatedAt
// }
// The links never loop: normalizeNetwork() drops any link that would.

import { NET_CARD_TYPES } from '../forge/preset-model.js';

export const NETWORK_FORMAT = 'tempest.network';
export const NETWORK_VERSION = 1;
export const NET_ID = /^net_[0-9a-f]{8}$/;
export const NODE_ID = /^n[0-9a-f]{6}$/;
const CARD_ID = /^ncard_[0-9a-f]{8}$/;
export const MAX_NODES = 120;
const MAX_PARENTS = 6;

export class NetworkError extends Error {
  constructor(problems) {
    super(problems.length === 1 ? problems[0] : `This network has ${problems.length} problems: ${problems.join('; ')}`);
    this.problems = problems;
  }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
function hex(bytes) {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A node with an id no other node in `net` uses. */
export function newNode(net, { card = null, parents = [], label = '' } = {}) {
  let id;
  do id = `n${hex(3)}`;
  while (net?.nodes?.some((n) => n.id === id));
  return { id, card, label, dv: '', count: 1, note: '', parents: [...parents] };
}

/** An empty network. */
export function newNetwork(name = 'New network') {
  const now = new Date().toISOString();
  return { format: NETWORK_FORMAT, version: NETWORK_VERSION, name, description: '', nodes: [], revealed: [], hints: false, createdAt: now, updatedAt: now };
}

/** Is `ancestor` above `id` (following parents)? */
function isAbove(parentsOf, ancestor, id, seen = new Set()) {
  for (const p of parentsOf.get(id) ?? []) {
    if (p === ancestor) return true;
    if (!seen.has(p)) {
      seen.add(p);
      if (isAbove(parentsOf, ancestor, p, seen)) return true;
    }
  }
  return false;
}

/** Check and tidy a network. Throws NetworkError for what can't be repaired. */
export function normalizeNetwork(input) {
  if (!isObj(input)) throw new NetworkError(['A network must be a JSON object']);
  const problems = [];
  if (input.format != null && input.format !== NETWORK_FORMAT) problems.push('This is not a TEMPEST network');
  if (input.version != null && input.version > NETWORK_VERSION) problems.push(`This network was made by a newer TEMPEST (format ${input.version})`);
  const name = str(input.name, 80).trim();
  if (!name) problems.push('A network needs a name');
  const raw = Array.isArray(input.nodes) ? input.nodes : [];
  if (raw.length > MAX_NODES) problems.push(`A network holds at most ${MAX_NODES} nodes`);
  if (problems.length) throw new NetworkError(problems);

  const nodes = [];
  const ids = new Set();
  for (const n of raw) {
    if (!isObj(n) || !NODE_ID.test(n.id ?? '') || ids.has(n.id)) continue;
    ids.add(n.id);
    const count = Number.isInteger(n.count) ? Math.min(99, Math.max(1, n.count)) : 1;
    nodes.push({
      id: n.id,
      card: CARD_ID.test(n.card ?? '') ? n.card : null,
      label: str(n.label, 60).trim(),
      dv: str(n.dv, 8).trim(),
      count,
      note: str(n.note, 2000),
      parents: Array.isArray(n.parents) ? n.parents : [],
    });
  }
  // Links: only to nodes that exist, once each, never to itself, never in a loop.
  const parentsOf = new Map(nodes.map((n) => [n.id, []]));
  for (const n of nodes) {
    for (const p of n.parents) {
      const mine = parentsOf.get(n.id);
      if (typeof p !== 'string' || p === n.id || !ids.has(p) || mine.includes(p) || mine.length >= MAX_PARENTS) continue;
      if (isAbove(parentsOf, n.id, p)) continue; // n is already above p: this link would loop
      mine.push(p);
    }
  }
  for (const n of nodes) n.parents = parentsOf.get(n.id);

  const now = new Date().toISOString();
  return {
    format: NETWORK_FORMAT, version: NETWORK_VERSION,
    ...(NET_ID.test(input.id ?? '') ? { id: input.id } : {}),
    name,
    description: str(input.description, 400).trim(),
    nodes,
    revealed: [...new Set((Array.isArray(input.revealed) ? input.revealed : []).filter((id) => ids.has(id)))],
    hints: input.hints === true,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : now,
  };
}

// --- editing (each returns a new network) ---------------------------------------------------

const clone = (v) => structuredClone(v);
const childrenOf = (net, id) => net.nodes.filter((n) => n.parents.includes(id));

/** Add a node under `parentId` (or at the top, with null). Returns { net, id }. */
export function addNode(net, parentId, card = null) {
  const next = clone(net);
  const node = newNode(next, { card, parents: parentId && next.nodes.some((n) => n.id === parentId) ? [parentId] : [] });
  // Keep it next to its siblings, so it lays out beside them.
  const after = parentId ? Math.max(next.nodes.findIndex((n) => n.id === parentId), ...next.nodes.map((n, i) => (n.parents.includes(parentId) ? i : -1))) : next.nodes.length - 1;
  next.nodes.splice(after + 1, 0, node);
  return { net: next, id: node.id };
}

/** Put a new node between `id` and its parents. Returns { net, id }. */
export function insertAbove(net, id, card = null) {
  const next = clone(net);
  const target = next.nodes.find((n) => n.id === id);
  if (!target) return { net: next, id: null };
  const node = newNode(next, { card, parents: target.parents });
  target.parents = [node.id];
  next.nodes.splice(next.nodes.indexOf(target), 0, node);
  return { net: next, id: node.id };
}

/** Change a node's own settings (card, label, dv, count, note). */
export function updateNode(net, id, patch) {
  const next = clone(net);
  const n = next.nodes.find((x) => x.id === id);
  if (n) for (const k of ['card', 'label', 'dv', 'count', 'note']) if (k in patch) n[k] = patch[k];
  return next;
}

/** Can `from` be linked above `to` (no loop, not already linked)? */
export function canLink(net, from, to) {
  if (from === to) return false;
  const parentsOf = new Map(net.nodes.map((n) => [n.id, n.parents]));
  if (!parentsOf.has(from) || !parentsOf.has(to) || parentsOf.get(to).includes(from)) return false;
  return !isAbove(parentsOf, to, from);
}

/** Link `from` above `to`, merging a branch into it. */
export function link(net, from, to) {
  if (!canLink(net, from, to)) return net;
  const next = clone(net);
  next.nodes.find((n) => n.id === to).parents.push(from);
  return next;
}

export function unlink(net, from, to) {
  const next = clone(net);
  const n = next.nodes.find((x) => x.id === to);
  if (n) n.parents = n.parents.filter((p) => p !== from);
  return next;
}

/** Remove a node; what hung below it moves up to its parents, so no branch is cut loose. */
export function removeNode(net, id) {
  const next = clone(net);
  const gone = next.nodes.find((n) => n.id === id);
  if (!gone) return next;
  next.nodes = next.nodes.filter((n) => n.id !== id);
  for (const n of next.nodes) {
    if (!n.parents.includes(id)) continue;
    n.parents = [...new Set([...n.parents.filter((p) => p !== id), ...gone.parents])];
  }
  next.revealed = next.revealed.filter((r) => r !== id);
  return next; // its parents were above its children already: no loop can appear
}

/** Remove a node and everything only it leads to. */
export function removeBranch(net, id) {
  let next = clone(net);
  const doomed = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of next.nodes) {
      if (!doomed.has(n.id) && n.parents.length && n.parents.every((p) => doomed.has(p))) {
        doomed.add(n.id);
        grew = true;
      }
    }
  }
  next.nodes = next.nodes.filter((n) => !doomed.has(n.id)).map((n) => ({ ...n, parents: n.parents.filter((p) => !doomed.has(p)) }));
  next.revealed = next.revealed.filter((r) => !doomed.has(r));
  return next;
}

/** Swap a node with its neighbour among its siblings (by = -1 left, +1 right). */
export function nudge(net, id, by) {
  const next = clone(net);
  const node = next.nodes.find((n) => n.id === id);
  if (!node) return next;
  const same = (n) => (n.parents[0] ?? null) === (node.parents[0] ?? null);
  const siblings = next.nodes.filter(same);
  const j = siblings.indexOf(node) + by;
  if (j < 0 || j >= siblings.length) return next;
  const a = next.nodes.indexOf(node);
  const b = next.nodes.indexOf(siblings[j]);
  [next.nodes[a], next.nodes[b]] = [next.nodes[b], next.nodes[a]];
  return next;
}

// --- layout -------------------------------------------------------------------------------------

/**
 * Where each node sits: { [id]: { x, y } } in grid units (x may be a half step), plus
 * the grid's size { cols, rows }. Rows are depths (a merged node sits below every
 * branch that leads to it); each node is centred over its branches, and a single
 * line runs straight down, as an architecture is drawn in the rulebook.
 */
export function layout(net) {
  const nodes = net.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map();
  const depthOf = (id, trail = new Set()) => {
    if (depth.has(id)) return depth.get(id);
    trail.add(id);
    const ps = (byId.get(id)?.parents ?? []).filter((p) => byId.has(p) && !trail.has(p));
    const d = ps.length ? 1 + Math.max(...ps.map((p) => depthOf(p, trail))) : 0;
    depth.set(id, d);
    return d;
  };
  nodes.forEach((n) => depthOf(n.id));

  // A tree on each node's first parent; extra parents only add links.
  const primary = (n) => n.parents.find((p) => byId.has(p)) ?? null;
  const kids = new Map(nodes.map((n) => [n.id, []]));
  for (const n of nodes) if (primary(n)) kids.get(primary(n)).push(n.id);
  const width = new Map();
  const widthOf = (id) => {
    if (!width.has(id)) width.set(id, Math.max(1, kids.get(id).reduce((sum, k) => sum + widthOf(k), 0)));
    return width.get(id);
  };
  const pos = {};
  const place = (id, left) => {
    let at = left;
    for (const k of kids.get(id)) {
      place(k, at);
      at += widthOf(k);
    }
    pos[id] = { x: left + (widthOf(id) - 1) / 2, y: depth.get(id) };
  };
  let left = 0;
  for (const n of nodes) {
    if (primary(n)) continue;
    place(n.id, left);
    left += widthOf(n.id);
  }

  // A node that merges branches moves between them, with what hangs below it, if there's room.
  const subtree = (id) => [id, ...kids.get(id).flatMap(subtree)];
  for (const n of nodes) {
    const ps = n.parents.filter((p) => byId.has(p));
    if (ps.length < 2) continue;
    const delta = ps.reduce((sum, p) => sum + pos[p].x, 0) / ps.length - pos[n.id].x;
    if (!delta) continue;
    const moving = new Set(subtree(n.id));
    const clear = [...moving].every((m) => nodes.every((o) => moving.has(o.id) || pos[o.id].y !== pos[m].y || Math.abs(pos[o.id].x - (pos[m].x + delta)) >= 1));
    if (clear) for (const m of moving) pos[m].x += delta;
  }

  const xs = Object.values(pos).map((p) => p.x);
  const shift = xs.length ? Math.min(...xs) : 0;
  for (const p of Object.values(pos)) p.x -= shift;
  return {
    pos,
    cols: xs.length ? Math.max(...xs) - shift + 1 : 0,
    rows: nodes.length ? Math.max(...nodes.map((n) => depth.get(n.id))) + 1 : 0,
  };
}

/** Nodes in the order a run usually meets them: top to bottom, left to right. */
export function readingOrder(net) {
  const { pos } = layout(net);
  return [...net.nodes].sort((a, b) => pos[a.id].y - pos[b.id].y || pos[a.id].x - pos[b.id].x);
}

/** The next hidden node to reveal: the first in reading order that is hidden and reachable (top, or under a revealed node). */
export function nextToReveal(net) {
  const shown = new Set(net.revealed);
  const order = readingOrder(net).filter((n) => !shown.has(n.id));
  return order.find((n) => !n.parents.length || n.parents.some((p) => shown.has(p))) ?? order[0] ?? null;
}

// --- players' copy -------------------------------------------------------------------------------

/**
 * What players see of a network: its revealed nodes (and, with hints, a blank box for
 * each hidden node at the top or right under a revealed one). Revealed nodes carry
 * their label or, failing that, the card's name and type as the card's own sheet allows;
 * `cards` maps card ids to full net cards, `toPlayer` makes a card's players' copy
 * (push-model's playerEntity). GM notes never leave.
 */
export function playerNetwork(net, cards = new Map(), toPlayer = null, { focus = null } = {}) {
  const shown = new Set(net.revealed);
  const keep = new Set();
  for (const n of net.nodes) {
    if (shown.has(n.id)) keep.add(n.id);
    else if (net.hints && (!n.parents.length || n.parents.some((p) => shown.has(p)))) keep.add(n.id);
  }
  const nodes = net.nodes.filter((n) => keep.has(n.id)).map((n) => {
    const parents = n.parents.filter((p) => keep.has(p));
    if (!shown.has(n.id)) return { id: n.id, parents, hidden: true };
    const card = n.card ? cards.get(n.card) ?? null : null;
    const player = card && toPlayer ? toPlayer(card) : null;
    const open = (id) => card?.sheet?.fields?.[id]?.visibility === 'revealed';
    const type = open('category') ? NET_CARD_TYPES.find((t) => t.id === card.category)?.label ?? null : null;
    return {
      id: n.id, parents, hidden: false,
      title: n.label || (open('name') ? card.name : null) || type || 'Unknown',
      type: type ?? null,
      dv: n.dv || (open('dv') ? String(card.values?.dv ?? '') : ''),
      count: n.count,
      image: open('image') ? card.values?.image ?? null : null,
      card: player,
    };
  });
  return { id: net.id ?? null, name: net.name, nodes, focus: shown.has(focus) ? focus : null };
}

/** What the GM calls a node: its label, else its card's name, else an empty slot. */
export const nodeTitle = (node, card) => node.label || card?.name || (node.card ? 'Missing card' : 'Empty slot');

/** Stores' player lists: networks are never listed to players (they're pushed instead). */
export const forPlayers = () => [];
