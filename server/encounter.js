// The Initiative Tracker's encounter (Combat › Initiative): one per project, in
// <project>/encounter.json. Every change is an action applied with act()
// (app/combat/initiative-model.js), one at a time, so quick clicks never race.
//
//   GET  /api/projects/:p/encounter    the encounter (the GM's full copy)
//   POST /api/projects/:p/encounter    apply { action, … } → the new encounter
//
// Adding a character ({ action: 'add', entityId }) reads its sheet here, so the
// tracker starts from the character's own hit points, initiative and armor.
// Ending combat with { save: true } writes the player characters' hit points back
// to their sheets. After every change the library's onEncounter hook runs, which
// puts the players' copy of the turn order on the player screens (server/display.js).

const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { StoreError } = require('./presets');

const loadModel = () => import(pathToFileURL(path.join(__dirname, '..', 'app', 'combat', 'initiative-model.js')).href);

function createEncounterStore(file, { defaults = async () => ({}) } = {}) {
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => null);
    return run;
  };

  async function read() {
    const M = await loadModel();
    const base = await defaults();
    try {
      return M.normalizeEncounter(JSON.parse(await fsp.readFile(file, 'utf8')), base);
    } catch {
      return M.empty(base); // none yet, or unreadable: a fresh tracker
    }
  }
  async function write(state) {
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, file);
    return state;
  }

  return {
    get: () => serial(read),
    /** Apply one action. `lookup(entityId)` resolves a character for 'add'; `saveSheets(updates)` writes HP back on 'end'. */
    act: (action, { lookup, saveSheets } = {}) => serial(async () => {
      const M = await loadModel();
      const state = await read();
      let source = null;
      if (action?.action === 'add' && action.entityId != null) {
        const entity = typeof action.entityId === 'string' ? await lookup(action.entityId).catch(() => null) : null;
        if (!entity) throw new StoreError(404, 'That character no longer exists');
        source = M.sourceFrom(entity);
      }
      if (action?.action === 'end' && action.save === true && saveSheets) await saveSheets(M.sheetUpdates(state));
      let next;
      try {
        next = M.act(state, action ?? {}, { source });
      } catch (err) {
        if (err instanceof M.InitiativeError) throw new StoreError(err.status, err.message);
        throw err;
      }
      return write(next);
    }),
  };
}

/** Route /api/projects/:p/encounter; `rest` is what follows. Returns true when handled. */
async function handleEncounter(store, req, res, rest, { readJson, sendJson }, { lookup, saveSheets, changed }) {
  if (rest) return false;
  if (req.method === 'GET') return sendJson(res, 200, await store.get()), true;
  if (req.method === 'POST') {
    const state = await store.act(await readJson(req), { lookup, saveSheets });
    await changed(state);
    return sendJson(res, 200, state), true;
  }
  return false;
}

module.exports = { createEncounterStore, handleEncounter };
