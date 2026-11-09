// The players' Codex: everything the players know of in the campaign, which each
// player screen can browse on its own (the Codex button), whatever the GM pushes.
//
//   GET /api/codex          the list: { project, groups, entries: [{ id, type, group, sub, title, image, summary, at }] }
//   GET /api/codex/:id      one entry, as players see it
//
// It covers the project the GM opened last (the campaign at the table), and holds:
//   players, npcs, monsters, creatures (people when the category is hidden),
//   world, items           characters, stories/rumors/events and items marked known
//                          (entity.known; pushing an entry makes it known), each only as
//                          its own sheet allows (playerEntity / rosterEntry)
//   news                   revealed screamsheets, as printed
//   places                 revealed places of the project's map system: points of interest on the
//                          globe and the City Maps, or planes and ways, charts with their pins and
//                          regions, star systems, lanes and sectors (server/atlas.js)
//   handouts               revealed handouts (Sessions › Handouts), obscured text left out
//   sessions               session recaps the GM shared ("Previously…")
// Like pushes, every copy is built here, so nothing GM-only reaches a player screen.

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { StoreError } = require('./presets');

const appModule = (rel) => import(pathToFileURL(path.join(__dirname, '..', 'app', rel)).href);

// Characters get a tab per category (Characters › Players / NPCs / Monsters / Creatures), when
// their sheet lets players see the category; the rest go under People, so a tab never gives away
// what a sheet keeps hidden.
const GROUPS = [
  { id: 'players', label: 'Players' },
  { id: 'npcs', label: 'NPCs' },
  { id: 'monsters', label: 'Monsters' },
  { id: 'creatures', label: 'Creatures' },
  { id: 'people', label: 'People' },
  { id: 'world', label: 'World' },
  { id: 'factions', label: 'Factions' },
  { id: 'items', label: 'Items' },
  { id: 'news', label: 'News' },
  { id: 'places', label: 'Places' },
  { id: 'handouts', label: 'Handouts' },
  { id: 'sessions', label: 'Sessions' },
];
const GROUP_OF = { characters: 'people', stories: 'world', items: 'items', factions: 'factions' };
const ENTITY_KINDS = Object.keys(GROUP_OF);
const ASSET = /img_[0-9a-f]{24}/g;
const atlas = require('./atlas');
// The globe's places count with Planetary maps, or before a map system is chosen; City Map
// POIs wherever Night City can be (Planetary, Galactic, or none chosen yet).
const globeMode = (mode) => mode === null || mode === 'planetary';
const cityMode = (mode) => mode === null || mode === 'planetary' || mode === 'galactic';

function createCodex(library) {
  const cache = new Map(); // projectId -> { at, assets: Set }

  /** The project at the table: the one the GM opened last. */
  async function project() {
    const [latest] = await library.list();
    if (!latest) throw new StoreError(404, 'No campaign yet');
    return latest;
  }

  async function knownEntities(stores) {
    const out = [];
    for (const kind of ENTITY_KINDS) {
      for (const s of await stores[kind].list()) {
        if (!s.known) continue;
        const e = await stores[kind].get(s.id).catch(() => null);
        if (e?.known) out.push(e);
      }
    }
    return out;
  }

  async function list() {
    const meta = await project();
    const stores = await library.open(meta.id);
    const M = await appModule('push/push-model.js');
    const { KINDS } = await appModule('forge/preset-model.js');
    const { typeOf } = await appModule('maps/poi-model.js');
    const { UNIQUE_POIS } = await appModule('maps/poi-model.js');
    const entries = [];

    for (const e of await knownEntities(stores)) {
      const card = M.rosterEntry(e);
      const shownCategory = e.sheet?.fields?.category?.visibility === 'revealed';
      const category = shownCategory ? KINDS[e.kind].categories.find((c) => c.id === e.category) : null;
      const group = e.kind === 'characters' ? (category && GROUPS.some((g) => g.id === category.tab) ? category.tab : 'people') : GROUP_OF[e.kind];
      entries.push({ id: e.id, type: 'entity', group, sub: category?.label ?? KINDS[e.kind].entity.replace(/^./, (c) => c.toUpperCase()), title: card.name, image: card.image, summary: card.summary, at: e.updatedAt });
    }
    const { playerCopy: printed } = await appModule('screamsheets/screamsheet-model.js');
    for (const s of await stores.screamsheets.list()) {
      if (!s.revealed) continue;
      const p = printed(s); // obscured or hidden parts are blank here
      const more = p.items.filter((it) => it.type === 'article').length;
      entries.push({ id: s.id, type: 'article', group: 'news', sub: `${p.outlet || 'Screamsheet'}${more ? ` · ${more + 1} stories` : ''}`, title: p.headline || null, image: null, summary: String(p.body ?? '').split(/\n\s*\n/)[0].slice(0, 240), at: s.updatedAt ?? s.createdAt });
    }
    // Places come from the map system the project uses now: the globe's (Planetary, or none chosen),
    // or the board, charts or star map of the other three; City Map POIs while Night City is on the map.
    const mode = meta.settings?.maps?.mode ?? null;
    if (globeMode(mode)) {
      for (const p of await library.listPois(meta.id, { view: 'player' })) {
        entries.push({ id: p.id, type: 'poi', group: 'places', sub: typeOf(p.type).label, title: p.name, image: p.maps?.[0]?.image ?? null, summary: String(p.description ?? '').slice(0, 240), at: p.updatedAt ?? null });
      }
    }
    entries.push(...await atlas.codexEntries(library, meta.id, mode));
    for (const p of cityMode(mode) ? await stores.citypois.list({ view: 'player' }) : []) {
      const city = UNIQUE_POIS.find((u) => u.slug === p.city)?.name ?? 'City';
      entries.push({ id: p.id, type: 'citypoi', group: 'places', sub: city, title: p.name, image: p.maps?.[0]?.image ?? null, summary: String(p.description ?? '').slice(0, 240), at: p.updatedAt ?? null });
    }
    const S = await appModule('sessions/session-model.js');
    for (const h of await stores.handouts.list({ view: 'player' })) {
      const full = await stores.handouts.get(h.id).catch(() => null);
      entries.push({
        id: h.id, type: 'handout', group: 'handouts', sub: S.STYLES.find((x) => x.id === h.style)?.label ?? 'Handout', title: h.title, image: h.image,
        summary: h.obscure ? `${S.OBSCURE_STYLES.find((x) => x.id === h.obscure)?.label ?? 'Unreadable'}` : (S.paragraphs(h.text)[0] ?? h.caption ?? '').slice(0, 240),
        at: full?.updatedAt ?? null,
      });
    }
    for (const r of await stores.sessions.list({ view: 'player' })) {
      entries.push({ id: r.id, type: 'recap', group: 'sessions', sub: [`Session ${r.number}`, S.dayOf(r.date)].filter(Boolean).join(' · '), title: r.title || `Session ${r.number}`, image: null, summary: (S.paragraphs(r.recap)[0] ?? '').slice(0, 240), at: null, order: r.number });
    }
    // Every tab shows, even before anything is known in it; People only holds characters whose category is hidden.
    const groups = GROUPS.filter((g) => g.id !== 'people' || entries.some((x) => x.group === g.id));
    return { project: { id: meta.id, name: meta.name, theme: meta.theme ?? null }, groups, entries };
  }

  async function entry(id) {
    const meta = await project();
    const stores = await library.open(meta.id);
    const M = await appModule('push/push-model.js');
    const base = { projectId: meta.id, id };
    if (/^ss_[0-9a-f]{8}$/.test(id)) {
      const sheet = await stores.screamsheets.get(id).catch(() => null);
      if (!sheet?.revealed) throw new StoreError(404, 'Not in the Codex');
      const { playerCopy } = await appModule('screamsheets/screamsheet-model.js');
      // Link lines lead to entries in the Codex, and to nothing the players don't know of.
      const known = new Set((await knownEntities(stores)).map((e) => e.id));
      return { ...base, type: 'article', article: playerCopy(sheet, { known }), known: [...known] };
    }
    if (/^hand_[0-9a-f]{8}$/.test(id) || /^sess_[0-9a-f]{8}$/.test(id)) {
      const S = await appModule('sessions/session-model.js');
      if (id.startsWith('hand_')) {
        const h = await stores.handouts.get(id).catch(() => null);
        if (!h?.revealed) throw new StoreError(404, 'Not in the Codex');
        return { ...base, type: 'handout', handout: S.playerHandout(h) };
      }
      const s = await stores.sessions.get(id).catch(() => null);
      if (!s?.recapShared || !s.recap) throw new StoreError(404, 'Not in the Codex');
      return { ...base, type: 'recap', recap: S.playerRecap(s) };
    }
    const mode = meta.settings?.maps?.mode ?? null;
    if (/^(poi_[0-9a-f]{8}|unique_[a-z0-9_]+)$/.test(id) && globeMode(mode)) {
      const poi = (await library.listPois(meta.id, { view: 'player' })).find((p) => p.id === id);
      if (!poi) throw new StoreError(404, 'Not in the Codex');
      return { ...base, type: 'poi', poi };
    }
    if (atlas.systemOf(id)) {
      const place = atlas.systemOf(id) === mode ? await atlas.card(library, meta.id, id) : null;
      if (!place) throw new StoreError(404, 'Not in the Codex');
      return { ...base, type: 'place', place };
    }
    if (/^cpoi_[0-9a-f]{8}$/.test(id)) {
      if (!cityMode(mode)) throw new StoreError(404, 'Not in the Codex');
      const poi = (await stores.citypois.list({ view: 'player' })).find((p) => p.id === id);
      if (!poi) throw new StoreError(404, 'Not in the Codex');
      const { UNIQUE_POIS } = await appModule('maps/poi-model.js');
      return { ...base, type: 'citypoi', poi, cityName: UNIQUE_POIS.find((u) => u.slug === poi.city)?.name ?? 'City' };
    }
    const { kindOfId } = await appModule('forge/entity-model.js');
    const kind = kindOfId(id);
    if (!ENTITY_KINDS.includes(kind)) throw new StoreError(404, 'Not in the Codex');
    const entity = await stores[kind].get(id).catch(() => null);
    if (!entity?.known) throw new StoreError(404, 'Not in the Codex');
    // Linked entries show by name and picture as their own sheets allow, and open in the Codex only if known.
    const linked = new Map();
    for (const other of M.idsIn(M.playerEntity(entity).values)) {
      const k = kindOfId(other);
      const e = k && stores[k] ? await stores[k].get(other).catch(() => null) : null;
      if (e) linked.set(other, e);
    }
    const view = M.playerEntity(entity, linked);
    const known = [...linked.values()].filter((e) => e.known && ENTITY_KINDS.includes(e.kind)).map((e) => e.id);
    return { ...base, type: 'entity', entity: view, known };
  }

  /** Whether a picture of this project is part of the Codex (for the network player screen). */
  async function allows(projectId, image) {
    let c = cache.get(projectId);
    if (!c || Date.now() - c.at > 5000) {
      let text = '';
      try {
        const all = await list();
        if (all.project.id === projectId) {
          text = JSON.stringify(all);
          for (const e of all.entries) text += JSON.stringify(await entry(e.id).catch(() => null));
        }
      } catch {
        /* no campaign: nothing allowed */
      }
      c = { at: Date.now(), assets: new Set(text.match(ASSET) ?? []) };
      cache.set(projectId, c);
    }
    return c.assets.has(image);
  }

  return { list, entry, allows };
}

/** Route GET /api/codex[/:id]. Returns true when handled. */
async function handleCodex(codex, req, res, pathname, { sendJson }) {
  if (req.method !== 'GET') return false;
  try {
    if (pathname === '/api/codex') return sendJson(res, 200, await codex.list()), true;
    const m = pathname.match(/^\/api\/codex\/([A-Za-z0-9_]{1,64})$/);
    if (m) return sendJson(res, 200, await codex.entry(m[1])), true;
    return false;
  } catch (err) {
    if (err instanceof StoreError) return sendJson(res, err.status, { error: err.message }), true;
    throw err;
  }
}

module.exports = { createCodex, handleCodex, GROUPS };
