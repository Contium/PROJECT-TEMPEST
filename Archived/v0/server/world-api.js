// HTTP routes for universes and their contents.
//
//   GET   /api/universes                                   list
//   POST  /api/universes                                   create {name, system?, summary?, theme?, calendar?}
//   GET   /api/universes/:u                                meta (name, theme, calendar, clock, current era…)
//   PATCH /api/universes/:u                                update meta
//   GET   /api/universes/:u/types                          entity types (in presentation order)
//   POST  /api/universes/:u/types                          define a custom type
//   GET   /api/universes/:u/eras                           eras on the Time-Line, earliest first
//   GET   /api/universes/:u/entities?type&q&at&view&sort&limit&includeDeleted
//   GET   /api/universes/:u/entities/:id?at&view
//   GET   /api/universes/:u/entities/:id/history           (GM only)
//   GET   /api/universes/:u/entities/:id/relations?kind&at&view
//   POST  /api/universes/:u/batches                        {ops, note?, gameTime?, event?}
//   POST  /api/universes/:u/batches/:batch/undo | redo
//   GET   /api/universes/:u/timeline?from&to&limit         (GM only)
//   POST  /api/universes/:u/clock                          {advance: "1d 6h"} | {set: minutes}
//   GET   /api/universes/:u/display                        what the shared player screen shows
//   PUT   /api/universes/:u/display                        push a view {mode: ambient|entity|roster|handout|message, …}
//   GET   /api/universes/:u/encounter?view                 the Initiative Tracker (view=player: the players' turn bar)
//   POST  /api/universes/:u/encounter                      a tracker action {action: add|remove|update|hp|slot|condition|move|roll|start|next|prev|end|rest|clear, …}
//   POST  /api/universes/:u/assets                       upload an image (raw PNG/JPEG/GIF/WebP body) → {id}
//   GET   /api/universes/:u/assets/:id                     the image bytes
//   GET   /api/universes/:u/stream                         server-sent "change" (world), "display" (screen) and "encounter" (tracker) events
//
// view=player returns only what the players may see; it is enforced here, not
// in the browser, so a player-facing screen can't leak GM secrets.

const { UniverseLibrary } = require('../world/universes');
const { WorldError, badRequest } = require('../world/errors');

const library = new UniverseLibrary();

// Live updates: every open window (GM screens, player display) subscribes to its
// universe and refetches when told something changed.
const streams = new Map();

function subscribe(uid, req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  if (!streams.has(uid)) streams.set(uid, new Set());
  streams.get(uid).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    streams.get(uid)?.delete(res);
  });
}

function notify(uid, detail, event = 'change') {
  const payload = `event: ${event}\ndata: ${JSON.stringify(detail)}\n\n`;
  for (const res of streams.get(uid) ?? []) res.write(payload);
}

function intParam(params, key) {
  if (!params.has(key)) return undefined;
  const n = Number(params.get(key));
  if (!Number.isInteger(n)) throw badRequest(`${key} must be a whole number`);
  return n;
}

function viewParam(params) {
  const view = params.get('view') ?? 'gm';
  if (view !== 'gm' && view !== 'player') throw badRequest('view must be gm or player');
  return view;
}

function gmOnly(params) {
  if (viewParam(params) === 'player') throw new WorldError(403, 'Not available in the player view');
}

const ROUTES = [
  ['GET', /^$/, () => library.list()],
  ['POST', /^$/, ({ body }) => library.create(body).meta(), 201],
  ['GET', /^\/(?<u>[^/]+)$/, ({ u }) => u.meta()],
  ['PATCH', /^\/(?<u>[^/]+)$/, ({ u, body }) => u.setMeta(body)],
  ['GET', /^\/(?<u>[^/]+)\/types$/, ({ u }) => u.types()],
  ['POST', /^\/(?<u>[^/]+)\/types$/, ({ u, body }) => u.defineType(body), 201],
  ['GET', /^\/(?<u>[^/]+)\/eras$/, ({ u }) => u.eras()],
  ['GET', /^\/(?<u>[^/]+)\/display$/, ({ u }) => u.display()],
  ['PUT', /^\/(?<u>[^/]+)\/display$/, ({ u, body }) => u.setDisplay(body)],
  ['GET', /^\/(?<u>[^/]+)\/encounter$/, ({ u, params }) => u.encounter({ view: viewParam(params) })],
  ['POST', /^\/(?<u>[^/]+)\/encounter$/, ({ u, body }) => u.encounterAct(body)],
  [
    'GET', /^\/(?<u>[^/]+)\/entities$/,
    ({ u, params }) => u.list({
      type: params.get('type') || undefined,
      q: params.get('q') || undefined,
      at: intParam(params, 'at'),
      view: viewParam(params),
      sort: params.get('sort') || undefined,
      limit: intParam(params, 'limit'),
      includeDeleted: params.get('includeDeleted') === 'true',
    }),
  ],
  ['GET', /^\/(?<u>[^/]+)\/entities\/(?<id>[^/]+)$/, ({ u, id, params }) => u.get(id, { at: intParam(params, 'at'), view: viewParam(params) })],
  ['GET', /^\/(?<u>[^/]+)\/entities\/(?<id>[^/]+)\/history$/, ({ u, id, params }) => (gmOnly(params), u.history(id))],
  [
    'GET', /^\/(?<u>[^/]+)\/entities\/(?<id>[^/]+)\/relations$/,
    ({ u, id, params }) => u.relations(id, { kind: params.get('kind') || undefined, at: intParam(params, 'at'), view: viewParam(params) }),
  ],
  ['POST', /^\/(?<u>[^/]+)\/batches$/, ({ u, body }) => u.applyBatch(body), 201],
  ['POST', /^\/(?<u>[^/]+)\/batches\/(?<batch>[^/]+)\/undo$/, ({ u, batch }) => u.undo(batch)],
  ['POST', /^\/(?<u>[^/]+)\/batches\/(?<batch>[^/]+)\/redo$/, ({ u, batch }) => u.redo(batch)],
  [
    'GET', /^\/(?<u>[^/]+)\/timeline$/,
    ({ u, params }) => (gmOnly(params), u.timeline({ from: intParam(params, 'from'), to: intParam(params, 'to'), limit: intParam(params, 'limit') })),
  ],
  [
    'POST', /^\/(?<u>[^/]+)\/clock$/,
    ({ u, body }) => {
      if (body.advance != null) return u.advanceClock(body.advance);
      if (body.set != null) return u.setClock(body.set);
      throw badRequest('Send {advance: "1d 6h"} or {set: minutes}');
    },
  ],
];

/**
 * Handle /api/universes/* — `rest` is the path after /api/universes.
 * Returns true when a route matched (response sent), false otherwise.
 */
async function handleWorld(req, res, rest, params, { readJson, readRaw, sendJson }) {
  const stream = req.method === 'GET' && rest.match(/^\/([^/]+)\/stream$/);
  if (stream) {
    try {
      library.open(stream[1]);
    } catch (err) {
      sendJson(res, err.status ?? 500, { error: err.message });
      return true;
    }
    subscribe(stream[1], req, res);
    return true;
  }

  // Images travel as raw bytes, not JSON.
  const asset = rest.match(/^\/([^/]+)\/assets(?:\/([^/]+))?$/);
  if (asset) {
    try {
      const u = library.open(decodeURIComponent(asset[1]));
      if (req.method === 'POST' && !asset[2]) {
        sendJson(res, 201, u.addAsset(await readRaw(req)));
      } else if (req.method === 'GET' && asset[2]) {
        const { mime, data } = u.asset(decodeURIComponent(asset[2]));
        // Ids are content hashes, so a given URL never changes.
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
        res.end(data);
      } else {
        return false;
      }
    } catch (err) {
      if (err instanceof WorldError) sendJson(res, err.status, { error: err.message });
      else throw err;
    }
    return true;
  }

  for (const [method, pattern, handler, status = 200] of ROUTES) {
    const match = rest.match(pattern);
    if (!match || req.method !== method) continue;
    try {
      const groups = Object.fromEntries(Object.entries(match.groups ?? {}).map(([k, v]) => [k, decodeURIComponent(v)]));
      const ctx = { ...groups, params, body: method === 'GET' ? null : await readJson(req) };
      if (groups.u) ctx.u = library.open(groups.u);
      sendJson(res, status, await handler(ctx));
      if (method !== 'GET' && groups.u) {
        // Screen pushes don't change the world; tell windows apart so GM views don't refetch.
        if (/\/display$/.test(rest)) notify(groups.u, ctx.u.display(), 'display');
        // The tracker holds GM secrets, and player screens share this stream: send no state, each window refetches its own view.
        else if (/\/encounter$/.test(rest)) notify(groups.u, { at: Date.now() }, 'encounter');
        else notify(groups.u, { route: rest, at: Date.now() });
      }
    } catch (err) {
      if (err instanceof WorldError) sendJson(res, err.status, { error: err.message, details: err.details });
      else if (err instanceof SyntaxError) sendJson(res, 400, { error: 'Request body is not valid JSON' });
      else throw err;
    }
    return true;
  }
  return false;
}

module.exports = { handleWorld, library };
