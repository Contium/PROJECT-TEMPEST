// Entity storage, one store per kind: one JSON file per entity in
// <project>/<kind>/<id>.json (characters/, stories/, items/). Every save is checked with
// normalizeEntity() (app/forge/entity-model.js), the same rules the browser uses.
//
//   GET    /api/projects/:p/<kind>?category=npc   list  [summary]
//   GET    /api/projects/:p/<kind>/:id            one entity
//   POST   /api/projects/:p/<kind>                create (always gets a fresh id) → entity
//   PUT    /api/projects/:p/<kind>/:id            save → entity
//   DELETE /api/projects/:p/<kind>/:id
//   GET    /api/projects/:p/entities              every entity of every kind, as summaries
//                                                 (for pickers and links that can point at anything)

const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { StoreError } = require('./presets');

const modelUrl = (file) => pathToFileURL(path.join(__dirname, '..', 'app', 'forge', file)).href;
const loadEntityModel = () => import(modelUrl('entity-model.js'));
const loadPresetModel = () => import(modelUrl('preset-model.js'));

/** What lists show of an entity: enough for cards, pickers and links. */
const summary = (e) => ({
  id: e.id, kind: e.kind ?? 'characters', name: e.name, category: e.category,
  image: e.values?.image ?? null, summary: e.values?.summary ?? '',
  species: e.values?.species ?? '', size: e.values?.size ?? '',
  start: e.values?.start ?? null, end: e.values?.end ?? null,
  itemtype: e.values?.itemtype ?? '', rarity: rarityOf(e), dv: e.values?.dv ?? '',
  leader: e.values?.leader ?? '', founded: e.values?.founded ?? null,
  presetName: e.presetName ?? '', known: e.known === true, updatedAt: e.updatedAt,
});

/** An item's rarity as lists show it: { id, name, color, style } from its own sheet, or null. */
function rarityOf(e) {
  const field = e.sheet?.fields?.rarity;
  const pick = e.values?.rarity?.rarity;
  return (field?.type === 'rarity' && field.rarities?.find((r) => r.id === pick)) || null;
}

function createEntityStore(dir, kind) {
  const ready = fsp.mkdir(dir, { recursive: true });
  const noun = { stories: 'entry', items: 'item', factions: 'faction', netcards: 'net card' }[kind] ?? 'character';
  const fileOf = async (id) => {
    const { idPattern } = await loadEntityModel();
    if (!idPattern(kind).test(id)) throw new StoreError(404, `No such ${noun}`);
    await ready;
    return path.join(dir, `${id}.json`);
  };
  const check = async (input) => {
    const { normalizeEntity } = await loadEntityModel();
    const { PresetError } = await loadPresetModel();
    try {
      return normalizeEntity({ kind, ...input }, { kind });
    } catch (err) {
      if (err instanceof PresetError) throw new StoreError(400, err.message, err.problems);
      throw err;
    }
  };
  const write = async (file, data) => {
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, file);
    return data;
  };

  return {
    kind,
    async list({ category } = {}) {
      await ready;
      const out = [];
      for (const name of await fsp.readdir(dir)) {
        if (!name.endsWith('.json')) continue;
        try {
          const e = JSON.parse(await fsp.readFile(path.join(dir, name), 'utf8'));
          if (!category || e.category === category) out.push(summary({ kind, ...e }));
        } catch {
          /* unreadable file: skip it rather than break the list */
        }
      }
      return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    },
    async get(id) {
      try {
        return { kind, ...JSON.parse(await fsp.readFile(await fileOf(id), 'utf8')) };
      } catch (err) {
        if (err.code === 'ENOENT') throw new StoreError(404, `No such ${noun}`);
        throw err;
      }
    },
    async create(input) {
      const { newId, kindOf } = await loadPresetModel();
      const now = new Date().toISOString();
      const entity = await check({ ...input, id: newId(kindOf(kind).idPrefix), createdAt: now, updatedAt: now });
      return write(await fileOf(entity.id), entity);
    },
    async save(id, input) {
      const before = await this.get(id);
      const entity = await check({ ...input, id, createdAt: before.createdAt, updatedAt: new Date().toISOString() });
      return write(await fileOf(id), entity);
    },
    async remove(id) {
      try {
        await fsp.unlink(await fileOf(id));
      } catch (err) {
        if (err.code === 'ENOENT') throw new StoreError(404, `No such ${noun}`);
        throw err;
      }
      return { ok: true };
    },
  };
}

/** Route /api/projects/:p/<kind>[/:id]; `rest` is the path after the kind. Returns true when handled. */
async function handleEntities(store, req, res, rest, params, { readJson, sendJson }) {
  const m = rest.match(/^(?:\/([^/]+))?$/);
  if (!m) return false;
  const id = m[1] ? decodeURIComponent(m[1]) : null;
  try {
    const route = `${req.method} ${id ? 'one' : 'all'}`;
    if (route === 'GET all') return sendJson(res, 200, await store.list({ category: params.get('category') || undefined })), true;
    if (route === 'GET one') return sendJson(res, 200, await store.get(id)), true;
    if (route === 'POST all') return sendJson(res, 201, await store.create(await readJson(req))), true;
    if (route === 'PUT one') return sendJson(res, 200, await store.save(id, await readJson(req))), true;
    if (route === 'DELETE one') return sendJson(res, 200, await store.remove(id)), true;
    return false;
  } catch (err) {
    if (err instanceof StoreError) return sendJson(res, err.status, { error: err.message, problems: err.problems }), true;
    throw err;
  }
}

module.exports = { createEntityStore, handleEntities };
