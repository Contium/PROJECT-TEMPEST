// The player screen's display: what the GM last pushed, as the players' copy.
//
//   GET /api/display[?screen=Name]          what's on screen now (on that named screen)
//   PUT /api/display                        push { mode, …, to? } (app/push/push-model.js); → the new display
//   GET /api/display/stream[?screen=Name]   server-sent "display" events, one per push (and one on connect)
//   GET /api/display/screens                the named screens: who's watching, and what each shows
//
// Screens are named: each player screen asks its viewer for a name when it loads and
// follows the stream under it. A push goes to every screen (to: 'all', the default,
// which also drops anything pushed to one screen alone) or to some of them by name
// (to: ['Alex', 'Table TV']), which they keep until the next push that reaches them.
// The GM's own streams (no name) get the "everyone" display, plus "screens" events.
//
// The server builds every display itself from the project's data, so a push can
// never carry GM-only contents: entries go through playerEntity(), lists through
// rosterEntry(), POIs come from the players' lists (hidden ones are refused),
// networks through playerNetwork() (revealed nodes only, never the GM's notes), and the
// Planar, Cartographer and Galactic maps through server/atlas.js (revealed places only; a
// chart under fog only as its baked players' copy).
// The displays are kept in <data>/v1/display.json, so a restart keeps them.
//
// Beside what's pushed, every display carries `tracker`: the turn order of a fight
// under way (Combat › Initiative), as playerView() gives it, or null. Player screens
// draw it as a bar along the top whatever else they show; setTracker() changes it.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { StoreError } = require('./presets');
const { buildDisplay: buildAtlasDisplay } = require('./atlas');

const appModule = (rel) => import(pathToFileURL(path.join(__dirname, '..', 'app', rel)).href);
const ASSETS = path.join(__dirname, '..', 'assets', 'maps');
const APP = path.join(__dirname, '..', 'app');

// The app's "build": when any of its files last changed. Player screens compare it with the one
// they loaded with, and reload themselves when TEMPEST has been updated under them.
let build = { at: 0, value: '' };
function currentBuild() {
  if (Date.now() - build.at < 2000) return build.value;
  let newest = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|css|html)$/.test(entry.name)) newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  try {
    walk(APP);
  } catch {
    /* unreadable: keep the last one */
  }
  build = { at: Date.now(), value: newest ? Math.round(newest).toString(36) : build.value };
  return build.value;
}
/** The display as sent: what's on screen, plus the app's build. */
const withBuild = (state) => ({ ...state, build: currentBuild() });

/** A screen's name as given (trimmed, at most 32 characters, no control characters), or null. */
function screenName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
  return name || null;
}
/** Names match whatever their case: "alex" and "Alex" are one screen. */
const keyOf = (name) => name.toLowerCase();

function createDisplay(file, library) {
  let state = { mode: 'ambient', seq: 0, at: new Date().toISOString() };
  const personal = new Map(); // key -> display pushed to that screen alone
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved.all) {
      state = saved.all;
      for (const [k, d] of Object.entries(saved.personal ?? {})) personal.set(k, d);
    } else state = saved; // before named screens: the file was the display itself
  } catch {
    /* first run, or unreadable: stand by */
  }
  // The turn order on every screen while combat is on (Combat › Initiative): { projectId, …playerView } or null.
  // It rides along with whatever is pushed, so it stays up whatever the screens show.
  let tracker = null;
  try {
    tracker = JSON.parse(fs.readFileSync(file, 'utf8')).tracker ?? null;
  } catch {
    /* none */
  }
  const out = (d) => ({ ...withBuild(d), tracker });
  let seq = Math.max(state.seq ?? 0, ...[...personal.values()].map((d) => d.seq ?? 0));
  const clients = new Set(); // { res, key|null }
  // Screens seen since the server started: key -> { name, streams, seenAt }.
  const screens = new Map();
  const ONLINE_MS = 10000; // a polling screen counts as watching this long after it last asked
  const showing = (key) => (key && personal.get(key)) || state;
  const districtNames = new Map(); // city -> Map(id -> name)

  async function cityDistricts(city) {
    if (!districtNames.has(city)) {
      try {
        const data = JSON.parse(await fsp.readFile(path.join(ASSETS, city, 'districts.json'), 'utf8'));
        districtNames.set(city, new Map(data.districts.map((d) => [d.id, d.name])));
      } catch {
        districtNames.set(city, new Map());
      }
    }
    return districtNames.get(city);
  }

  /** Turn a checked request into the players' copy. */
  async function build(req) {
    const M = await appModule('push/push-model.js');
    if (req.mode === 'ambient') return {};
    if (req.mode === 'message') return { title: req.title || req.text.slice(0, 60), text: req.text, tone: req.tone, heading: req.title };
    const stores = await library.open(req.project);
    const project = (await library.get(req.project)).name;

    if (req.mode === 'entity') {
      const { kindOfId } = await appModule('forge/entity-model.js');
      const kind = kindOfId(req.id);
      if (!kind || !stores[kind]) throw new StoreError(404, 'No such entry');
      let entity = await stores[kind].get(req.id);
      // What the players have been shown, they know of: it joins their Codex (server/codex.js).
      if (!entity.known && ['characters', 'stories', 'items'].includes(kind)) {
        entity = await stores[kind].save(entity.id, { ...entity, known: true });
        req.madeKnown = true;
      }
      const linked = new Map();
      for (const id of M.idsIn(M.playerEntity(entity).values)) {
        const k = kindOfId(id);
        const other = k && stores[k] ? await stores[k].get(id).catch(() => null) : null;
        if (other) linked.set(id, other);
      }
      const view = M.playerEntity(entity, linked);
      return { project, entity: view, title: view.name ?? 'Unknown' };
    }
    if (req.mode === 'roster') {
      const { KINDS } = await appModule('forge/preset-model.js');
      const { plural } = await appModule('forge/entity-model.js');
      const summaries = await stores[req.kind].list({ category: req.category ?? undefined });
      const full = (await Promise.all(summaries.map((s) => stores[req.kind].get(s.id).catch(() => null)))).filter(Boolean);
      const category = KINDS[req.kind].categories.find((c) => c.id === req.category);
      const title = category ? plural(category.label) : KINDS[req.kind].label;
      return { project, kind: req.kind, category: req.category, title, entries: full.map(M.rosterEntry) };
    }
    if (req.mode === 'handout') {
      await stores.assets.get(req.image); // 404s if it's not this project's
      return { project, image: req.image, caption: req.caption, title: req.caption || 'Handout' };
    }
    if (req.mode === 'article') {
      const { playerCopy, playerTitle } = await appModule('screamsheets/screamsheet-model.js');
      const sheet = await stores.screamsheets.get(req.id);
      if (!sheet.revealed) throw new StoreError(409, 'That screamsheet is hidden from players: reveal it first');
      return { project, article: playerCopy(sheet), title: playerTitle(sheet) };
    }
    if (req.mode === 'network') {
      const { playerNetwork } = await appModule('netrun/network-model.js');
      const net = await stores.networks.get(req.id);
      // Only the cards of revealed nodes are read; their players' copies follow each card's own sheet.
      const cards = new Map();
      for (const n of net.nodes) {
        if (!n.card || !net.revealed.includes(n.id) || cards.has(n.card)) continue;
        const card = await stores.netcards.get(n.card).catch(() => null);
        if (card) cards.set(n.card, card);
      }
      return { project, network: playerNetwork(net, cards, M.playerEntity, { focus: req.focus }), title: net.name };
    }
    if (req.mode === 'globe' || req.mode === 'poi') {
      const seen = await library.listPois(req.project, { view: 'player' });
      if (req.mode === 'globe') return { project, view: req.view, zoom: req.zoom, focus: seen.some((p) => p.id === req.focus) ? req.focus : null, pois: seen, title: 'World View' };
      const poi = seen.find((p) => p.id === req.id);
      if (!poi) {
        const all = await library.listPois(req.project);
        throw all.some((p) => p.id === req.id) ? new StoreError(409, 'That point is hidden from players: reveal it first') : new StoreError(404, 'No such point of interest');
      }
      return { project, poi, title: poi.name };
    }
    if (req.mode === 'citymap' || req.mode === 'citypoi') {
      const { UNIQUE_POIS } = await appModule('maps/poi-model.js');
      const base = UNIQUE_POIS.find((u) => u.slug === req.city);
      if (!base) throw new StoreError(404, 'No such city map');
      const names = await cityDistricts(req.city);
      const pois = await stores.citypois.list({ city: req.city, view: 'player' });
      if (req.mode === 'citymap') {
        const district = names.has(req.district) ? req.district : null;
        return { project, city: req.city, cityName: base.name, layer: req.layer, district, districtName: names.get(district) ?? null, pois, title: district ? `${base.name} · ${names.get(district)}` : base.name };
      }
      const poi = pois.find((p) => p.id === req.id);
      if (!poi) {
        const all = await stores.citypois.list({ city: req.city });
        throw all.some((p) => p.id === req.id) ? new StoreError(409, 'That point is hidden from players: reveal it first') : new StoreError(404, 'No such point of interest');
      }
      return { project, city: req.city, cityName: base.name, poi, districtName: names.get(poi.district) ?? null, title: poi.name };
    }
    // The Planar, Cartographer and Galactic map systems (server/atlas.js).
    const atlas = await buildAtlasDisplay(library, req, project);
    if (atlas) return atlas;
    throw new StoreError(400, 'Unknown push');
  }

  /** A named screen asked or connected: remember it. */
  function seen(name, streams = 0) {
    const key = keyOf(name);
    const s = screens.get(key) ?? { name, streams: 0, seenAt: 0 };
    s.name = name; // the latest spelling
    s.streams += streams;
    s.seenAt = Date.now();
    screens.set(key, s);
    return key;
  }

  /** Who's watching, for the GM: [{ name, online, personal, title, mode }], online first. */
  function list() {
    const now = Date.now();
    const out = [];
    for (const [key, s] of screens) {
      const d = showing(key);
      out.push({ name: s.name, online: s.streams > 0 || now - s.seenAt < ONLINE_MS, personal: personal.has(key), mode: d.mode, title: d.title ?? null });
    }
    // Screens sent something of their own before a restart, not back yet.
    for (const [key, d] of personal) if (!screens.has(key)) out.push({ name: d.screen ?? key, online: false, personal: true, mode: d.mode, title: d.title ?? null });
    return out.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  }

  const event = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  function broadcast() {
    const screensChunk = event('screens', list());
    for (const c of clients) {
      if (c.key) c.res.write(event('display', out(showing(c.key))));
      else c.res.write(event('display', out(state)) + screensChunk);
    }
  }
  /** Tell the GM's streams the list of screens changed. */
  function announce() {
    const chunk = event('screens', list());
    for (const c of clients) if (!c.key) c.res.write(chunk);
  }

  async function save() {
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify({ all: state, personal: Object.fromEntries(personal), tracker }), 'utf8');
    await fsp.rename(tmp, file);
  }

  return {
    /** What's on screen: everyone's display, or what the named screen shows. */
    get(name) {
      const n = screenName(name);
      if (!n) return out(state);
      const key = seen(n);
      return out(showing(key));
    },
    screens: list,
    /**
     * Push. `to` is 'all' (the default: every screen, dropping anything pushed to one
     * alone) or a list of screen names. Resolves to the display pushed.
     */
    async push(input) {
      const { normalizePushRequest, PushError } = await appModule('push/push-model.js');
      const { to = 'all', ...rest } = input ?? {};
      let names = null;
      if (to !== 'all') {
        names = Array.isArray(to) ? [...new Map(to.map(screenName).filter(Boolean).map((n) => [keyOf(n), n])).values()] : [];
        if (!names.length) throw new StoreError(400, 'Choose who to push to: every screen, or at least one by name');
        if (names.length > 50) throw new StoreError(400, 'Too many screens');
      }
      let req;
      try {
        req = normalizePushRequest(rest);
      } catch (err) {
        if (err instanceof PushError) throw new StoreError(err.status, err.message);
        throw err;
      }
      const content = await build(req);
      const shown = {
        mode: req.mode,
        ...(req.project ? { projectId: req.project } : {}),
        ...(req.theme ? { theme: req.theme } : {}),
        ...content,
        seq: ++seq,
        at: new Date().toISOString(),
      };
      if (names) {
        for (const n of names) personal.set(keyOf(n), { ...shown, screen: (screens.get(keyOf(n))?.name ?? n) });
      } else {
        state = shown;
        personal.clear();
      }
      await save();
      broadcast();
      return out({ ...shown, to: names ?? 'all', ...(req.madeKnown ? { madeKnown: true } : {}) });
    },
    /** Hold a request open as an event stream; `name` makes it a named player screen. */
    subscribe(req, res, name) {
      const n = screenName(name);
      const key = n ? seen(n, 1) : null;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`retry: 2000\n${event('display', out(showing(key)))}${key ? '' : event('screens', list())}`);
      const client = { res, key };
      clients.add(client);
      if (key) announce();
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(client);
        if (key) {
          const s = screens.get(key);
          if (s) (s.streams = Math.max(0, s.streams - 1)), (s.seenAt = Date.now());
          announce();
        }
      });
    },
    /**
     * A project's encounter changed (or the project went: null). While its combat is on and
     * shown, its turn order goes up on every screen; when it ends, it comes down.
     */
    async setTracker(projectId, encounter) {
      const { playerView } = await appModule('combat/initiative-model.js');
      const view = encounter ? playerView(encounter) : null;
      let next = tracker;
      if (view?.active) next = { projectId, ...view };
      else if (tracker?.projectId === projectId) next = null;
      if (JSON.stringify(next) === JSON.stringify(tracker)) return;
      tracker = next;
      await save();
      broadcast();
    },
    /** Every display a screen could be showing now (for which pictures the network may fetch). */
    current: () => [state, ...personal.values(), ...(tracker ? [tracker] : [])],
  };
}

async function handleDisplay(display, req, res, pathname, { readJson, sendJson }) {
  try {
    const screen = new URL(req.url, 'http://local').searchParams.get('screen');
    if (pathname === '/api/display/stream' && req.method === 'GET') return display.subscribe(req, res, screen), true;
    if (pathname === '/api/display/screens' && req.method === 'GET') return sendJson(res, 200, display.screens()), true;
    if (pathname !== '/api/display') return false;
    if (req.method === 'GET') return sendJson(res, 200, display.get(screen)), true;
    if (req.method === 'PUT') return sendJson(res, 200, await display.push(await readJson(req))), true;
    return false;
  } catch (err) {
    if (err instanceof StoreError) return sendJson(res, err.status, { error: err.message, problems: err.problems }), true;
    throw err;
  }
}

module.exports = { createDisplay, handleDisplay, screenName };
