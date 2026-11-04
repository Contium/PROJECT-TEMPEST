// A universe: one SQLite file holding a setting, its Time-Line and every
// change ever made to it.
//
// Writes are atomic batches of ops (create / update / delete / restore) recorded
// as rows in `changes` at an in-game time. The `entities` table is a projection
// of those changes as of the world clock; any other moment is reconstructed by
// folding history ("time travel"). Undo marks a batch as undone instead of
// deleting it, so history always shows what happened and what was retracted.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { openDb, transaction } = require('./db');
const T = require('./types');
const E = require('./encounter');
const time = require('./time');
const { badRequest, notFound, conflict } = require('./errors');

// Version of the entity model (types + field keys) stored in meta.model.
//   1: region/location/faction/npc  2: the 16-level Universe model  3: image fields
//   4: Article type (screamsheets)  5: map galleries on places, sessions and articles
//   6: Mob type, player characters and combat stats (Initiative Tracker)
const MODEL_VERSION = 6;

// Images accepted for upload, identified by their leading bytes (never by the
// client's claimed type alone). SVG is excluded: it can carry script.
const IMAGE_SIGNATURES = [
  ['image/png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/gif', (b) => b.subarray(0, 4).toString('latin1') === 'GIF8'],
  ['image/webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// What the shared player screen can show. Presentation only: not part of history.
const DISPLAY_MODES = ['ambient', 'entity', 'roster', 'handout', 'message'];
const MESSAGE_TONES = ['info', 'success', 'warning', 'danger'];

const PATCH_KEY = /^(name|visibility|secretFields|data\.[a-z][a-z0-9_]{0,47})$/;
const ENTITY_ID = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const EDITABLE_META = ['name', 'system', 'summary', 'theme', 'calendar', 'active_session'];
const MAX_DEPTH = 64;
const SORTS = {
  name: 'name COLLATE NOCASE',
  recent: 'updated_at DESC, name COLLATE NOCASE',
  created: 'created_at DESC, name COLLATE NOCASE',
};

const parse = (s) => (s == null ? null : JSON.parse(s));
const newId = (type) => `${type.slice(0, 4)}_${crypto.randomBytes(5).toString('hex')}`;

function prefixData(data = {}) {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [`data.${k}`, v]));
}

function applyPatch(state, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'type') continue;
    if (key.startsWith('data.')) {
      const field = key.slice(5);
      if (value === null) delete state.data[field];
      else state.data[field] = value;
    } else {
      state[key] = value;
    }
  }
}

/** Fold ordered change rows for one entity into its state (null if never created). */
function fold(rows) {
  let state = null;
  for (const row of rows) {
    const patch = parse(row.patch);
    if (row.op === 'create') {
      state = {
        id: row.entity_id, type: patch.type, name: '', visibility: 'hidden', secretFields: [], data: {},
        deleted: false, createdAt: row.game_time, updatedAt: row.game_time,
      };
      applyPatch(state, patch);
      continue;
    }
    if (!state) continue; // its create was undone
    if (row.op === 'update') applyPatch(state, patch);
    if (row.op === 'delete') state.deleted = true;
    if (row.op === 'restore') state.deleted = false;
    state.updatedAt = row.game_time;
  }
  return state;
}

/** Fold rows ordered by (entity_id, game_time, seq) into one state per entity. */
function foldEach(rows) {
  const states = [];
  for (let i = 0; i < rows.length; ) {
    let j = i;
    while (j < rows.length && rows[j].entity_id === rows[i].entity_id) j++;
    const state = fold(rows.slice(i, j));
    if (state) states.push(state);
    i = j;
  }
  return states;
}

function searchText(state) {
  return Object.values(state.data)
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((v) => typeof v === 'string')
    .join(' ');
}

// User text → safe FTS5 prefix query ("kab tyg" → "kab"* "tyg"*).
function ftsQuery(q) {
  const terms = String(q).match(/[\p{L}\p{N}]+/gu) ?? [];
  return terms.map((t) => `"${t}"*`).join(' ');
}

function matchesText(state, q) {
  const needle = String(q).toLowerCase();
  return `${state.name} ${searchText(state)}`.toLowerCase().includes(needle);
}

class Universe {
  #db;
  #stmts = new Map();
  #types = null;

  /** Create a new universe file with the core entity types. */
  static create(file, { name, system = null, summary = null, theme = null, calendar = time.DEFAULT_CALENDAR } = {}) {
    if (!name || typeof name !== 'string') throw badRequest('Universe name is required');
    const calendarError = time.validateCalendar(calendar);
    if (calendarError) throw badRequest(calendarError);
    if (fs.existsSync(file)) throw conflict(`Universe file already exists: ${path.basename(file)}`);

    const universe = new Universe(file, { fresh: true });
    transaction(universe.#db, () => {
      const meta = {
        name: name.trim(), system, summary, theme, calendar, clock: 0, active_session: null,
        model: MODEL_VERSION, created_at: new Date().toISOString(),
      };
      for (const [key, value] of Object.entries(meta)) universe.#writeMeta(key, value);
      T.CORE_TYPES.forEach((def, i) => universe.#insertType(def, true, i));
    });
    return universe;
  }

  constructor(file, { fresh = false } = {}) {
    this.file = file;
    this.id = path.basename(file, '.tempest');
    this.#db = openDb(file);
    if (!fresh) this.#upgradeModel();
  }

  close() {
    this.#db.close();
  }

  #stmt(sql) {
    let stmt = this.#stmts.get(sql);
    if (!stmt) {
      stmt = this.#db.prepare(sql);
      this.#stmts.set(sql, stmt);
    }
    return stmt;
  }

  // ------------------------------------------------------- model upgrades

  #upgradeModel() {
    const model = this.#metaValue('model') ?? 1;
    if (model >= MODEL_VERSION) return;
    transaction(this.#db, () => {
      if (model < 2) this.#upgradeToV2();
      else this.#refreshCoreTypes(); // v2+ → current: core type definitions only (image fields, Article)
      this.#writeMeta('model', MODEL_VERSION);
    });
  }

  #refreshCoreTypes() {
    this.#db.exec('DELETE FROM entity_types WHERE builtin = 1');
    T.CORE_TYPES.forEach((def, i) => this.#insertType(def, true, i));
  }

  // v1 → v2: Location→Place, Faction→Group, NPC→Individual, with field keys
  // aligned to the new model. History itself is rewritten so time travel,
  // diffs and undo keep working across the upgrade.
  #upgradeToV2() {
    const retype = (from, to) =>
      this.#db.prepare(`UPDATE changes SET patch = json_set(patch, '$.type', ?) WHERE op = 'create' AND json_extract(patch, '$.type') = ?`).run(to, from);
    const rekey = (type, from, to) => {
      for (const col of ['patch', 'prior']) {
        this.#db.prepare(
          `UPDATE changes SET ${col} = json_remove(json_set(${col}, '$."data.${to}"', json(${col} -> '$."data.${from}"')), '$."data.${from}"')
           WHERE ${col} IS NOT NULL AND json_type(${col}, '$."data.${from}"') IS NOT NULL
             AND entity_id IN (SELECT entity_id FROM changes WHERE op = 'create' AND json_extract(patch, '$.type') = ?)`,
        ).run(type);
      }
    };
    retype('location', 'place');
    retype('faction', 'group');
    retype('npc', 'individual');
    rekey('place', 'region', 'parent');
    rekey('individual', 'faction', 'affiliation');

    this.#refreshCoreTypes();

    this.#db.exec('DELETE FROM entities; DELETE FROM relations; DELETE FROM entities_fts;');
    for (const { entity_id } of this.#db.prepare('SELECT DISTINCT entity_id FROM changes').all()) this.#project(entity_id);
  }

  // ---------------------------------------------------------------- meta

  meta() {
    const rows = this.#stmt('SELECT key, value FROM meta').all();
    const meta = Object.fromEntries(rows.map((r) => [r.key, parse(r.value)]));
    const era = this.eraAt(meta.clock);
    return {
      id: this.id,
      ...meta,
      clockLabel: time.formatGameTime(meta.clock, meta.calendar),
      era: era ? { id: era.id, name: era.name } : null,
    };
  }

  get clock() {
    return parse(this.#stmt('SELECT value FROM meta WHERE key = ?').get('clock').value);
  }

  #metaValue(key) {
    return parse(this.#stmt('SELECT value FROM meta WHERE key = ?').get(key)?.value);
  }

  #writeMeta(key, value) {
    this.#stmt('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  setMeta(patch = {}) {
    for (const key of Object.keys(patch)) {
      if (!EDITABLE_META.includes(key)) throw badRequest(`"${key}" cannot be changed here`);
    }
    if ('name' in patch && !(typeof patch.name === 'string' && patch.name.trim())) throw badRequest('name cannot be empty');
    if ('calendar' in patch) {
      const err = time.validateCalendar(patch.calendar);
      if (err) throw badRequest(err);
    }
    if (patch.active_session != null) {
      const session = this.#stateAt(patch.active_session, this.clock);
      if (!session || session.deleted || session.type !== 'session') throw badRequest('active_session must be a session');
    }
    transaction(this.#db, () => {
      for (const [key, value] of Object.entries(patch)) this.#writeMeta(key, value);
    });
    return this.meta();
  }

  // --------------------------------------------------------------- types

  #insertType(def, builtin, ord) {
    this.#stmt('INSERT INTO entity_types (id, name, plural, lex_key, fields, builtin, hidden, ord, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(def.id, def.name, def.plural ?? `${def.name}s`, def.lexKey ?? null, JSON.stringify(def.fields), builtin ? 1 : 0,
        def.hidden ? 1 : 0, ord, def.category ?? 'extra');
    this.#types = null;
  }

  types({ includeHidden = false } = {}) {
    if (!this.#types) {
      this.#types = new Map(
        this.#stmt('SELECT * FROM entity_types ORDER BY ord, name').all().map((r) => [
          r.id,
          {
            id: r.id, name: r.name, plural: r.plural, lexKey: r.lex_key, category: r.category, fields: parse(r.fields),
            builtin: !!r.builtin, hidden: !!r.hidden,
          },
        ]),
      );
    }
    return [...this.#types.values()].filter((t) => includeHidden || !t.hidden);
  }

  type(id) {
    this.types();
    const type = this.#types.get(id);
    if (!type) throw badRequest(`Unknown entity type "${id}"`);
    return type;
  }

  /** Add a custom entity type (e.g. a game-specific "netrun" or "ship"). */
  defineType(def) {
    T.validateTypeDef(def);
    this.types();
    if (this.#types.has(def.id)) throw conflict(`Type "${def.id}" already exists`);
    transaction(this.#db, () => this.#insertType({ category: 'extra', ...def }, false, 1000 + this.#types.size));
    return this.type(def.id);
  }

  // -------------------------------------------------------------- assets

  /** Store an uploaded image (deduplicated by content). Returns { id, mime, size }. */
  addAsset(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw badRequest('No image data received');
    if (buffer.length > MAX_IMAGE_BYTES) throw badRequest(`Images must be ${MAX_IMAGE_BYTES / 1024 / 1024} MB or smaller`);
    const mime = IMAGE_SIGNATURES.find(([, test]) => test(buffer))?.[0];
    if (!mime) throw badRequest('Only PNG, JPEG, GIF and WebP images are supported');
    const id = `img_${crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 24)}`;
    this.#stmt('INSERT OR IGNORE INTO assets (id, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, mime, buffer.length, buffer, new Date().toISOString());
    return { id, mime, size: buffer.length };
  }

  /** { mime, data } for an image, or a 404. */
  asset(id) {
    const row = this.#stmt('SELECT mime, data FROM assets WHERE id = ?').get(id);
    if (!row) throw notFound(`No image "${id}"`);
    return { mime: row.mime, data: Buffer.from(row.data) };
  }

  // ------------------------------------------------------------- display

  /** What the shared player screen shows right now. */
  display() {
    return this.#metaValue('display') ?? { mode: 'ambient' };
  }

  /**
   * Push a view to the player screen:
   *   { mode: 'ambient' }                              clear back to the default
   *   { mode: 'entity', id }                           a dossier card (must be visible to players)
   *   { mode: 'roster', type }                         every player-visible entity of a type
   *   { mode: 'handout', asset, caption? }             an image, full size
   *   { mode: 'message', text, title?, tone? }         an announcement / alert
   */
  setDisplay(input = {}) {
    const mode = input.mode;
    if (!DISPLAY_MODES.includes(mode)) throw badRequest(`mode must be one of ${DISPLAY_MODES.join(', ')}`);
    const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    let display;
    if (mode === 'ambient') display = { mode };
    if (mode === 'entity') {
      const state = this.#stateAt(input.id, this.clock);
      if (!state || state.deleted) throw notFound(`No entity "${input.id}"`);
      if (state.visibility === 'hidden') throw conflict(`"${state.name}" is GM only. Reveal it before pushing it to players.`);
      display = { mode, id: state.id, type: state.type };
    }
    if (mode === 'roster') display = { mode, type: this.type(input.type).id };
    if (mode === 'handout') {
      this.asset(input.asset);
      display = { mode, asset: input.asset, caption: text(input.caption, 200) };
    }
    if (mode === 'message') {
      const body = text(input.text, 2000);
      if (!body) throw badRequest('A message needs some text');
      const tone = input.tone ?? 'info';
      if (!MESSAGE_TONES.includes(tone)) throw badRequest(`tone must be one of ${MESSAGE_TONES.join(', ')}`);
      display = { mode, text: body, title: text(input.title, 120), tone };
    }
    display.pushedAt = new Date().toISOString();
    transaction(this.#db, () => this.#writeMeta('display', display));
    return display;
  }

  // ------------------------------------------------------------ encounter

  /** The Initiative Tracker. view: 'gm' (everything) | 'player' (the turn bar: no hidden or defeated, coarse health). */
  encounter({ view = 'gm' } = {}) {
    const state = this.#metaValue('encounter') ?? E.empty();
    return view === 'player' ? E.playerView(state) : state;
  }

  /** Apply one tracker action (see world/encounter.js). `add` with an entityId copies its combat stats. */
  encounterAct(action = {}) {
    let source = null;
    if (action.action === 'add' && action.entityId != null) {
      const state = this.#stateAt(action.entityId, this.clock);
      if (!state || state.deleted) throw notFound(`No entity "${action.entityId}"`);
      source = E.sourceFrom(state);
    }
    const next = E.act(this.encounter(), action, { source });
    transaction(this.#db, () => this.#writeMeta('encounter', next));
    return next;
  }

  // ---------------------------------------------------------------- eras

  /**
   * Eras on the Time-Line, earliest first. Eras describe the Time-Line itself,
   * so they apply at every moment regardless of when they were recorded
   * (rewinding the clock into the past still shows the right era).
   */
  eras() {
    const rows = this.#stmt(
      `SELECT entity_id, op, patch, game_time FROM changes
       WHERE undone_at IS NULL AND entity_id IN (SELECT entity_id FROM changes WHERE op = 'create' AND json_extract(patch, '$.type') = 'era')
       ORDER BY entity_id, game_time, seq`,
    ).all();
    return foldEach(rows)
      .filter((e) => !e.deleted)
      .sort((a, b) => a.data.start - b.data.start);
  }

  /** The era a game time falls in (latest-starting one if eras overlap). */
  eraAt(t) {
    return this.eras().filter((e) => e.data.start <= t && (e.data.end == null || t < e.data.end)).at(-1) ?? null;
  }

  // ------------------------------------------------------------- history

  #rowsFor(id, t) {
    return this.#stmt(
      'SELECT entity_id, op, patch, game_time FROM changes WHERE entity_id = ? AND game_time <= ? AND undone_at IS NULL ORDER BY game_time, seq',
    ).all(id, t);
  }

  #stateAt(id, t) {
    return fold(this.#rowsFor(id, t));
  }

  #allStatesAt(t) {
    const rows = this.#stmt(
      'SELECT entity_id, op, patch, game_time FROM changes WHERE game_time <= ? AND undone_at IS NULL ORDER BY entity_id, game_time, seq',
    ).all(t);
    return foldEach(rows);
  }

  #exists(id) {
    return !!this.#stmt('SELECT 1 FROM changes WHERE entity_id = ? LIMIT 1').get(id);
  }

  // -------------------------------------------------------------- writes

  /**
   * Apply ops atomically at one in-game time (default: the world clock).
   *   ops:   [{ op:'create', type, name, data?, visibility?, secretFields?, id? },
   *           { op:'update', id, patch?: {name|visibility|secretFields|'data.key'}, data?: {...} },
   *           { op:'delete', id }, { op:'restore', id }]
   *   event: optional { name, data, visibility } — creates an Event entity that
   *          every change in this batch is attributed to.
   * A gameTime later than the clock schedules the batch: it takes effect when
   * the clock reaches it.
   */
  applyBatch({ ops = [], note = null, gameTime, event } = {}) {
    if (!Array.isArray(ops)) throw badRequest('ops must be an array');
    if (!ops.length && !event) throw badRequest('Nothing to apply');
    const t = gameTime ?? this.clock;
    if (!Number.isInteger(t)) throw badRequest('gameTime must be whole minutes');

    const ctx = {
      batch: crypto.randomUUID(),
      t,
      note: note == null ? null : String(note),
      recordedAt: new Date().toISOString(),
      sessionId: this.#metaValue('active_session'),
      eventId: null,
    };

    return transaction(this.#db, () => {
      const touched = new Set();
      if (event) {
        ctx.eventId = event.id ?? newId('event');
        touched.add(this.#create({ ...event, id: ctx.eventId, type: 'event' }, ctx));
      }
      ops.forEach((op, i) => {
        try {
          touched.add(this.#applyOp(op, ctx));
        } catch (err) {
          if (err.status) err.message = `ops[${i}]: ${err.message}`;
          throw err;
        }
      });
      for (const id of touched) this.#project(id);
      return {
        batch: ctx.batch,
        eventId: ctx.eventId,
        gameTime: t,
        scheduled: t > this.clock,
        entities: [...touched].map((id) => this.#stateAt(id, t)),
      };
    });
  }

  #applyOp(op, ctx) {
    switch (op?.op) {
      case 'create':
        return this.#create(op, ctx);
      case 'update':
        return this.#update(op, ctx);
      case 'delete':
      case 'restore': {
        const cur = this.#stateAt(op.id, ctx.t);
        if (!cur) throw notFound(`No entity "${op.id}"`);
        if (op.op === 'delete' && cur.deleted) throw conflict(`"${cur.name}" is already deleted`);
        if (op.op === 'restore' && !cur.deleted) throw conflict(`"${cur.name}" is not deleted`);
        this.#insertChange(ctx, op.id, op.op, {}, null);
        return op.id;
      }
      default:
        throw badRequest(`Unknown op "${op?.op}"`);
    }
  }

  #create(op, ctx) {
    const type = this.type(op.type);
    const id = op.id ?? newId(type.id);
    if (!ENTITY_ID.test(id)) throw badRequest(`Invalid id "${id}"`);
    if (this.#exists(id)) throw conflict(`Entity "${id}" already exists`);
    if (!(typeof op.name === 'string' && op.name.trim())) throw badRequest('name is required');

    const visibility = op.visibility ?? 'hidden';
    if (!T.VISIBILITY.includes(visibility)) throw badRequest(`visibility must be one of ${T.VISIBILITY.join(', ')}`);
    const secretFields = op.secretFields ?? [];
    if (!Array.isArray(secretFields) || secretFields.some((k) => typeof k !== 'string')) {
      throw badRequest('secretFields must be a list of field keys');
    }
    const data = Object.fromEntries(Object.entries(op.data ?? {}).filter(([, v]) => v !== null && v !== undefined));
    T.validateData(type, data, { creating: true });
    this.#checkRefs(type, data, ctx.t, id);
    this.#checkImages(type, data);
    this.#checkEra(type, data);

    const patch = { type: type.id, name: op.name.trim(), visibility, secretFields, ...prefixData(data) };
    this.#insertChange(ctx, id, 'create', patch, null);
    return id;
  }

  #update(op, ctx) {
    const cur = this.#stateAt(op.id, ctx.t);
    if (!cur) throw notFound(`No entity "${op.id}"`);
    if (cur.deleted) throw conflict(`"${cur.name}" is deleted; restore it first`);

    const patch = { ...(op.patch ?? {}), ...prefixData(op.data) };
    const keys = Object.keys(patch);
    if (!keys.length) throw badRequest('Update has no changes');
    const dataPatch = {};
    for (const key of keys) {
      if (!PATCH_KEY.test(key)) throw badRequest(`"${key}" cannot be patched`);
      const value = patch[key];
      if (value === undefined) throw badRequest(`"${key}" is undefined; use null to clear a field`);
      if (key === 'name' && !(typeof value === 'string' && value.trim())) throw badRequest('name cannot be empty');
      if (key === 'visibility' && !T.VISIBILITY.includes(value)) throw badRequest(`visibility must be one of ${T.VISIBILITY.join(', ')}`);
      if (key === 'secretFields' && !(Array.isArray(value) && value.every((k) => typeof k === 'string'))) {
        throw badRequest('secretFields must be a list of field keys');
      }
      if (key.startsWith('data.')) dataPatch[key.slice(5)] = value;
    }
    const type = this.type(cur.type);
    T.validateData(type, dataPatch);
    this.#checkRefs(type, dataPatch, ctx.t, op.id);
    this.#checkImages(type, dataPatch);
    this.#checkEra(type, { ...cur.data, ...dataPatch });

    const prior = Object.fromEntries(keys.map((k) => [k, k.startsWith('data.') ? cur.data[k.slice(5)] ?? null : cur[k]]));
    this.#insertChange(ctx, op.id, 'update', patch, prior);
    return op.id;
  }

  #checkRefs(type, data, t, selfId) {
    for (const ref of T.refsIn(type, data)) {
      if (ref.id === selfId) throw badRequest(`${ref.label} can't point to itself`);
      const target = this.#stateAt(ref.id, t);
      if (!target || target.deleted) throw badRequest(`${ref.label} points to unknown entity "${ref.id}"`);
      if (ref.refTypes && !ref.refTypes.includes(target.type)) {
        const allowed = ref.refTypes.map((id) => this.type(id).name).join(', ');
        throw badRequest(`${ref.label} must be a ${allowed}, not a ${this.type(target.type).name}`);
      }
      if (ref.key === 'parent') this.#checkNoCycle(selfId, target, t);
    }
  }

  // Containment must stay a tree: walking up from the new parent must never
  // reach the entity itself.
  #checkNoCycle(selfId, parentState, t) {
    let cursor = parentState;
    for (let depth = 0; cursor && depth < MAX_DEPTH; depth++) {
      if (cursor.id === selfId) throw badRequest(`That would place "${parentState.name}" inside itself`);
      cursor = cursor.data.parent ? this.#stateAt(cursor.data.parent, t) : null;
    }
  }

  #checkImages(type, data) {
    for (const img of T.imagesIn(type, data)) {
      if (!this.#stmt('SELECT 1 FROM assets WHERE id = ?').get(img.id)) throw badRequest(`${img.label} points to an image that isn't in this universe`);
    }
  }

  #checkEra(type, data) {
    if (type.id === 'era' && data.end != null && data.start != null && data.end <= data.start) {
      throw badRequest('An era must end after it begins');
    }
  }

  #insertChange(ctx, entityId, op, patch, prior) {
    this.#stmt(
      `INSERT INTO changes (batch, event_id, game_time, recorded_at, session_id, entity_id, op, patch, prior, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(ctx.batch, ctx.eventId, ctx.t, ctx.recordedAt, ctx.sessionId, entityId, op, JSON.stringify(patch),
      prior == null ? null : JSON.stringify(prior), ctx.note);
  }

  /** Rebuild the projection rows for one entity as of the clock. */
  #project(id) {
    const state = this.#stateAt(id, this.clock);
    this.#stmt('DELETE FROM entities_fts WHERE id = ?').run(id);
    if (!state) {
      this.#stmt('DELETE FROM entities WHERE id = ?').run(id);
      this.#stmt('DELETE FROM relations WHERE id = ?').run(id);
      return;
    }
    this.#stmt(
      `INSERT INTO entities (id, type, name, visibility, secret_fields, data, deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET type = excluded.type, name = excluded.name, visibility = excluded.visibility,
         secret_fields = excluded.secret_fields, data = excluded.data, deleted = excluded.deleted,
         created_at = excluded.created_at, updated_at = excluded.updated_at`,
    ).run(id, state.type, state.name, state.visibility, JSON.stringify(state.secretFields), JSON.stringify(state.data),
      state.deleted ? 1 : 0, state.createdAt, state.updatedAt);
    if (!state.deleted) this.#stmt('INSERT INTO entities_fts (id, name, body) VALUES (?, ?, ?)').run(id, state.name, searchText(state));
    if (state.type === 'relation') {
      const { from, to, kind, value = null } = state.data;
      this.#stmt(
        `INSERT INTO relations (id, from_id, to_id, kind, value, deleted) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET from_id = excluded.from_id, to_id = excluded.to_id, kind = excluded.kind,
           value = excluded.value, deleted = excluded.deleted`,
      ).run(id, from, to, kind, value, state.deleted ? 1 : 0);
    }
  }

  #reprojectBetween(a, b) {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const ids = this.#stmt('SELECT DISTINCT entity_id FROM changes WHERE game_time > ? AND game_time <= ?').all(lo, hi);
    for (const { entity_id } of ids) this.#project(entity_id);
    return ids.length;
  }

  /** Move the world clock (forwards applies scheduled changes; backwards un-applies them). */
  setClock(t) {
    if (!Number.isInteger(t)) throw badRequest('clock must be whole minutes');
    return transaction(this.#db, () => {
      const old = this.clock;
      this.#writeMeta('clock', t);
      const affected = this.#reprojectBetween(old, t);
      return { ...this.meta(), affected };
    });
  }

  advanceClock(duration) {
    return this.setClock(this.clock + time.parseDuration(duration));
  }

  #setUndone(batch, undoneAt) {
    const ids = this.#stmt('SELECT DISTINCT entity_id FROM changes WHERE batch = ?').all(batch);
    if (!ids.length) throw notFound(`No batch "${batch}"`);
    return transaction(this.#db, () => {
      this.#stmt('UPDATE changes SET undone_at = ? WHERE batch = ?').run(undoneAt, batch);
      for (const { entity_id } of ids) this.#project(entity_id);
      return { batch, undone: undoneAt !== null, entities: ids.map((r) => r.entity_id) };
    });
  }

  undo(batch) {
    return this.#setUndone(batch, new Date().toISOString());
  }

  redo(batch) {
    return this.#setUndone(batch, null);
  }

  // --------------------------------------------------------------- reads

  #rowToState(row) {
    return {
      id: row.id, type: row.type, name: row.name, visibility: row.visibility,
      secretFields: parse(row.secret_fields), data: parse(row.data), deleted: !!row.deleted,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  #isNow(at) {
    return at == null || at === this.clock;
  }

  #visibleIds(at) {
    if (this.#isNow(at)) {
      return new Set(this.#stmt("SELECT id FROM entities WHERE deleted = 0 AND visibility != 'hidden'").all().map((r) => r.id));
    }
    return new Set(this.#allStatesAt(at).filter((s) => !s.deleted && s.visibility !== 'hidden').map((s) => s.id));
  }

  /** What players may see of an entity, or null. Strips secret fields and refs to hidden entities. */
  #playerFilter(state, visible) {
    if (!state || state.deleted || state.visibility === 'hidden') return null;
    if (state.type === 'relation' && !(visible.has(state.data.from) && visible.has(state.data.to))) return null;
    const base = { id: state.id, type: state.type, name: state.name, visibility: state.visibility, createdAt: state.createdAt, updatedAt: state.updatedAt };
    if (state.visibility === 'rumored') return { ...base, data: state.data.rumor ? { rumor: state.data.rumor } : {} };

    const type = this.type(state.type);
    const fields = new Map(type.fields.map((fd) => [fd.key, fd]));
    const secret = new Set([...type.fields.filter((fd) => fd.secret).map((fd) => fd.key), ...state.secretFields]);
    const data = {};
    for (const [key, value] of Object.entries(state.data)) {
      if (secret.has(key)) continue;
      const kind = fields.get(key)?.type;
      if (kind === 'ref') {
        if (visible.has(value)) data[key] = value;
      } else if (kind === 'refs') {
        data[key] = value.filter((id) => visible.has(id));
      } else if (kind === 'gallery') {
        // Only revealed images, without the GM's reveal flags.
        const shown = value.filter((item) => item.revealed).map(({ image, label }) => ({ image, ...(label ? { label } : {}) }));
        if (shown.length) data[key] = shown;
      } else {
        data[key] = value;
      }
    }
    return { ...base, data };
  }

  /** One entity, now or at game time `at`. view: 'gm' (everything) | 'player' (filtered). */
  get(id, { at, view = 'gm' } = {}) {
    const state = this.#isNow(at)
      ? (() => {
          const row = this.#stmt('SELECT * FROM entities WHERE id = ?').get(id);
          return row ? this.#rowToState(row) : null;
        })()
      : this.#stateAt(id, at);
    const out = view === 'player' ? this.#playerFilter(state, this.#visibleIds(at)) : state;
    if (!out) throw notFound(`No entity "${id}"`);
    return out;
  }

  list({ type, q, at, view = 'gm', includeDeleted = false, sort = 'name', limit = 500 } = {}) {
    if (!SORTS[sort]) throw badRequest(`sort must be one of ${Object.keys(SORTS).join(', ')}`);
    if (type) this.type(type);
    let states;
    let textFiltered = false;

    if (this.#isNow(at)) {
      const where = [];
      const params = [];
      if (!includeDeleted) where.push('deleted = 0');
      if (type) {
        where.push('type = ?');
        params.push(type);
      }
      const fts = q && view === 'gm' ? ftsQuery(q) : '';
      if (fts) {
        where.push('id IN (SELECT id FROM entities_fts WHERE entities_fts MATCH ?)');
        params.push(fts);
        textFiltered = true;
      }
      const sql = `SELECT * FROM entities ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${SORTS[sort]}`;
      states = this.#stmt(sql).all(...params).map((r) => this.#rowToState(r));
    } else {
      const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      const comparators = {
        name: byName,
        recent: (a, b) => b.updatedAt - a.updatedAt || byName(a, b),
        created: (a, b) => b.createdAt - a.createdAt || byName(a, b),
      };
      states = this.#allStatesAt(at)
        .filter((s) => (includeDeleted || !s.deleted) && (!type || s.type === type))
        .sort(comparators[sort]);
    }

    if (view === 'player') {
      const visible = this.#visibleIds(at);
      states = states.map((s) => this.#playerFilter(s, visible)).filter(Boolean);
    }
    // Player search runs on the filtered view so it can't match secret text.
    if (q && !textFiltered) states = states.filter((s) => matchesText(s, q));
    return states.slice(0, limit);
  }

  /** Relations touching an entity (optionally of one kind), with both endpoints' names. */
  relations(entityId, { kind, at, view = 'gm' } = {}) {
    let rels;
    if (this.#isNow(at)) {
      const ids = this.#stmt(
        `SELECT id FROM relations WHERE deleted = 0 AND (from_id = ? OR to_id = ?) ${kind ? 'AND kind = ?' : ''}`,
      ).all(...[entityId, entityId, kind].filter((v) => v !== undefined));
      rels = ids.map((r) => this.get(r.id));
    } else {
      rels = this.#allStatesAt(at).filter(
        (s) => s.type === 'relation' && !s.deleted && (s.data.from === entityId || s.data.to === entityId) && (!kind || s.data.kind === kind),
      );
    }
    if (view === 'player') {
      const visible = this.#visibleIds(at);
      rels = rels.map((r) => this.#playerFilter(r, visible)).filter(Boolean);
    }
    const names = new Map();
    const nameOf = (id) => {
      if (!names.has(id)) {
        try {
          names.set(id, this.get(id, { at }).name);
        } catch {
          names.set(id, null);
        }
      }
      return names.get(id);
    };
    return rels
      .map((r) => ({ ...r, fromName: nameOf(r.data.from), toName: nameOf(r.data.to) }))
      .sort((a, b) => (b.data.value ?? 0) - (a.data.value ?? 0));
  }

  /** Every recorded change to one entity, oldest first (GM only). */
  history(id) {
    const rows = this.#stmt('SELECT * FROM changes WHERE entity_id = ? ORDER BY game_time, seq').all(id);
    if (!rows.length) throw notFound(`No entity "${id}"`);
    const calendar = this.#metaValue('calendar');
    return rows.map((r) => ({
      seq: r.seq, batch: r.batch, eventId: r.event_id, op: r.op,
      gameTime: r.game_time, gameTimeLabel: time.formatGameTime(r.game_time, calendar),
      recordedAt: r.recorded_at, sessionId: r.session_id,
      patch: parse(r.patch), prior: parse(r.prior), note: r.note, undone: r.undone_at !== null,
    }));
  }

  /** Batches between two game times, newest first (GM only). */
  timeline({ from = Number.MIN_SAFE_INTEGER, to = Number.MAX_SAFE_INTEGER, limit = 100 } = {}) {
    const rows = this.#stmt(
      `SELECT batch, MIN(game_time) AS game_time, MIN(seq) AS seq, MAX(recorded_at) AS recorded_at,
              MAX(note) AS note, MAX(event_id) AS event_id, MAX(session_id) AS session_id,
              MAX(undone_at) AS undone_at, json_group_array(json_object('entity', entity_id, 'op', op)) AS items
       FROM changes WHERE game_time BETWEEN ? AND ?
       GROUP BY batch ORDER BY game_time DESC, seq DESC LIMIT ?`,
    ).all(from, to, limit);
    const clock = this.clock;
    const calendar = this.#metaValue('calendar');
    // Scheduled (future) entities aren't in the projection yet; name them as of their own time.
    const name = (id, t) => this.#stmt('SELECT name FROM entities WHERE id = ?').get(id)?.name ?? this.#stateAt(id, t)?.name ?? null;
    return rows.map((r) => ({
      batch: r.batch,
      gameTime: r.game_time,
      gameTimeLabel: time.formatGameTime(r.game_time, calendar),
      recordedAt: r.recorded_at,
      note: r.note,
      eventId: r.event_id,
      eventName: r.event_id ? name(r.event_id, r.game_time) : null,
      sessionId: r.session_id,
      scheduled: r.game_time > clock,
      undone: r.undone_at !== null,
      changes: parse(r.items).map((c) => ({ ...c, name: name(c.entity, r.game_time) })),
    }));
  }
}

module.exports = { Universe, fold, MODEL_VERSION };
