const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UniverseLibrary } = require('../world/universes');
const { Universe } = require('../world/universe');
const { openDb } = require('../world/db');
const { parseDuration, formatGameTime, DAY } = require('../world/time');

let dir;
let lib;
let u;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-test-'));
  lib = new UniverseLibrary(dir);
  u = lib.create({ name: 'Test City', calendar: { type: 'gregorian', epoch: '2045-08-01T00:00' } });
});

afterEach(() => {
  lib.closeAll();
  fs.rmSync(dir, { recursive: true, force: true });
});

function seedBasics() {
  const { entities } = u.applyBatch({
    note: 'setup',
    ops: [
      { op: 'create', id: 'sys_sol', type: 'system', name: 'Sol', visibility: 'known' },
      { op: 'create', id: 'wld_earth', type: 'world', name: 'Earth', visibility: 'known', data: { parent: 'sys_sol' } },
      { op: 'create', id: 'reg_kabuki', type: 'region', name: 'Kabuki', visibility: 'known', data: { parent: 'wld_earth', threat: 3, population: 48200 } },
      { op: 'create', id: 'grp_claws', type: 'group', name: 'Tyger Claws', visibility: 'known', data: { goals: 'Own all of Kabuki' } },
      { op: 'create', id: 'grp_secret', type: 'group', name: 'Hidden Cabal', visibility: 'hidden' },
      {
        op: 'create', id: 'ind_okada', type: 'individual', name: 'Wakako Okada', visibility: 'known',
        data: { role: 'Fixer', affiliation: 'grp_claws', motive: 'Revenge', tier: 5 },
      },
    ],
  });
  return entities;
}

test('new universe has the 16-level model in reading order, plus extras', () => {
  const meta = u.meta();
  assert.equal(meta.name, 'Test City');
  assert.equal(meta.clock, 0);
  assert.equal(meta.model, 6);
  assert.equal(meta.clockLabel, '2045-08-01 00:00');
  assert.deepEqual(
    u.types().map((t) => t.id),
    ['era', 'system', 'world', 'religion', 'global_faction', 'nation', 'regional_faction', 'region', 'community', 'event',
      'place', 'group', 'team', 'relation', 'individual', 'combatant', 'campaign', 'session', 'article', 'item'],
  );
  assert.equal(u.type('nation').category, 'powers');
});

test('universe ids are slugged and unique', () => {
  assert.equal(u.id, 'test-city');
  assert.equal(lib.create({ name: 'Test City' }).id, 'test-city-2');
});

test('create, update and history record prior values', () => {
  seedBasics();
  u.applyBatch({ note: 'raid', ops: [{ op: 'update', id: 'reg_kabuki', data: { threat: 4 } }] });
  assert.equal(u.get('reg_kabuki').data.threat, 4);
  const history = u.history('reg_kabuki');
  assert.equal(history.length, 2);
  assert.deepEqual(history[1].patch, { 'data.threat': 4 });
  assert.deepEqual(history[1].prior, { 'data.threat': 3 });
  assert.equal(history[1].note, 'raid');
});

test('null clears a field', () => {
  seedBasics();
  u.applyBatch({ ops: [{ op: 'update', id: 'reg_kabuki', data: { population: null } }] });
  assert.equal('population' in u.get('reg_kabuki').data, false);
});

test('validation: bad values, unknown refs, and refs to disallowed types', () => {
  seedBasics();
  assert.throws(() => u.applyBatch({ ops: [{ op: 'update', id: 'reg_kabuki', data: { threat: 9 } }] }), /Threat must be a whole number 1–5/);
  assert.throws(() => u.applyBatch({ ops: [{ op: 'update', id: 'ind_okada', data: { affiliation: 'nope_123' } }] }), /unknown entity/);
  assert.throws(
    () => u.applyBatch({ ops: [{ op: 'update', id: 'ind_okada', data: { affiliation: 'reg_kabuki' } }] }),
    /Primary affiliation must be a Global Faction, Nation, Regional Faction, Group, Team, not a Region/,
  );
  assert.throws(() => u.applyBatch({ ops: [{ op: 'update', id: 'ind_okada', patch: { type: 'region' } }] }), /cannot be patched/);
});

test('multi-type refs accept any listed type', () => {
  seedBasics();
  u.applyBatch({
    ops: [
      { op: 'create', id: 'nat_nusa', type: 'nation', name: 'NUSA', data: { parent: 'wld_earth' } },
      { op: 'create', id: 'reg_norcal', type: 'region', name: 'NorCal', data: { parent: 'nat_nusa' } },
      { op: 'create', id: 'com_town', type: 'community', name: 'Town', data: { parent: 'wld_earth' } },
    ],
  });
  assert.equal(u.get('reg_norcal').data.parent, 'nat_nusa');
  assert.equal(u.get('com_town').data.parent, 'wld_earth');
});

test('containment cannot loop or contain itself', () => {
  u.applyBatch({
    ops: [
      { op: 'create', id: 'reg_a', type: 'region', name: 'A' },
      { op: 'create', id: 'reg_b', type: 'region', name: 'B', data: { parent: 'reg_a' } },
      { op: 'create', id: 'reg_c', type: 'region', name: 'C', data: { parent: 'reg_b' } },
    ],
  });
  assert.throws(() => u.applyBatch({ ops: [{ op: 'update', id: 'reg_a', data: { parent: 'reg_c' } }] }), /inside itself/);
  assert.throws(() => u.applyBatch({ ops: [{ op: 'update', id: 'reg_a', data: { parent: 'reg_a' } }] }), /can't point to itself/);
});

test('required fields are enforced on create and cannot be cleared', () => {
  seedBasics();
  assert.throws(() => u.applyBatch({ ops: [{ op: 'create', type: 'relation', name: 'x', data: { from: 'grp_claws' } }] }), /To is required; Kind is required/);
  assert.throws(() => u.applyBatch({ ops: [{ op: 'create', type: 'era', name: 'Undated' }] }), /Begins is required/);
  u.applyBatch({ ops: [{ op: 'create', id: 'rel_x', type: 'relation', name: 'x', data: { from: 'grp_claws', to: 'reg_kabuki', kind: 'controls' } }] });
  assert.throws(() => u.applyBatch({ ops: [{ op: 'update', id: 'rel_x', data: { kind: null } }] }), /Kind is required/);
});

test('eras: current era in meta, negative (pre-epoch) history, ordering, validity', () => {
  u.applyBatch({
    ops: [
      { op: 'create', id: 'era_war', type: 'era', name: '4th Corporate War', visibility: 'known', data: { start: -22 * 365 * DAY, end: -20 * 365 * DAY } },
      { op: 'create', id: 'era_red', type: 'era', name: 'Time of the Red', visibility: 'known', data: { start: -20 * 365 * DAY } },
    ],
  });
  assert.deepEqual(u.eras().map((e) => e.id), ['era_war', 'era_red']);
  assert.equal(u.meta().era.name, 'Time of the Red');
  assert.equal(u.eraAt(-21 * 365 * DAY).id, 'era_war');
  assert.equal(u.eraAt(-30 * 365 * DAY), null);
  assert.throws(() => u.applyBatch({ ops: [{ op: 'update', id: 'era_war', data: { end: -23 * 365 * DAY } }] }), /must end after it begins/);

  // history recorded before the epoch, and a clock that can go there
  u.applyBatch({ gameTime: -21 * 365 * DAY, ops: [{ op: 'create', id: 'evt_old', type: 'event', name: 'Arasaka Tower nuked', visibility: 'known' }] });
  assert.equal(u.get('evt_old').createdAt, -21 * 365 * DAY);
  u.setClock(-21 * 365 * DAY);
  assert.equal(u.meta().era.name, '4th Corporate War');
  assert.match(u.meta().clockLabel, /^2024-/);
});

test('batches are atomic: one failing op rolls back the rest', () => {
  seedBasics();
  assert.throws(() =>
    u.applyBatch({
      ops: [
        { op: 'update', id: 'reg_kabuki', data: { threat: 5 } },
        { op: 'update', id: 'missing_id', data: { threat: 1 } },
      ],
    }),
  );
  assert.equal(u.get('reg_kabuki').data.threat, 3);
  assert.equal(u.history('reg_kabuki').length, 1);
});

test('refs can point at entities created earlier in the same batch', () => {
  u.applyBatch({
    ops: [
      { op: 'create', id: 'grp_new', type: 'group', name: 'New Gang' },
      { op: 'create', id: 'ind_boss', type: 'individual', name: 'Boss', data: { affiliation: 'grp_new' } },
    ],
  });
  assert.equal(u.get('ind_boss').data.affiliation, 'grp_new');
});

test('time travel: state at an earlier game time', () => {
  seedBasics();
  u.advanceClock('2d');
  u.applyBatch({ ops: [{ op: 'update', id: 'reg_kabuki', data: { threat: 5 } }] });
  assert.equal(u.get('reg_kabuki').data.threat, 5);
  assert.equal(u.get('reg_kabuki', { at: parseDuration('1d') }).data.threat, 3);
  assert.equal(u.list({ type: 'region', at: parseDuration('1d') })[0].data.threat, 3);
});

test('backdated changes slot into history without overriding later ones', () => {
  seedBasics();
  u.advanceClock('3d');
  u.applyBatch({ ops: [{ op: 'update', id: 'reg_kabuki', data: { threat: 5 } }] });
  u.applyBatch({ gameTime: parseDuration('1d'), ops: [{ op: 'update', id: 'reg_kabuki', data: { threat: 4 } }] });
  assert.equal(u.get('reg_kabuki').data.threat, 5);
  assert.equal(u.get('reg_kabuki', { at: parseDuration('2d') }).data.threat, 4);
});

test('scheduled changes apply when the clock reaches them, and un-apply on rewind', () => {
  seedBasics();
  const res = u.applyBatch({ gameTime: parseDuration('1d'), ops: [{ op: 'update', id: 'reg_kabuki', data: { threat: 5 } }] });
  assert.equal(res.scheduled, true);
  assert.equal(u.get('reg_kabuki').data.threat, 3);
  assert.equal(u.timeline()[0].scheduled, true);
  u.advanceClock('1d');
  assert.equal(u.get('reg_kabuki').data.threat, 5);
  u.setClock(0);
  assert.equal(u.get('reg_kabuki').data.threat, 3);
});

test('scheduled create is invisible until its time', () => {
  u.applyBatch({ gameTime: 60, ops: [{ op: 'create', id: 'ind_late', type: 'individual', name: 'Latecomer' }] });
  assert.throws(() => u.get('ind_late'), /No entity/);
  u.advanceClock('1h');
  assert.equal(u.get('ind_late').name, 'Latecomer');
});

test('undo and redo a batch', () => {
  seedBasics();
  const { batch } = u.applyBatch({ ops: [{ op: 'update', id: 'reg_kabuki', data: { threat: 5 } }, { op: 'delete', id: 'ind_okada' }] });
  assert.equal(u.get('ind_okada').deleted, true);
  u.undo(batch);
  assert.equal(u.get('reg_kabuki').data.threat, 3);
  assert.equal(u.get('ind_okada').deleted, false);
  assert.equal(u.history('reg_kabuki')[1].undone, true);
  u.redo(batch);
  assert.equal(u.get('reg_kabuki').data.threat, 5);
});

test('deleted entities drop out of lists and can be restored', () => {
  seedBasics();
  u.applyBatch({ ops: [{ op: 'delete', id: 'ind_okada' }] });
  assert.equal(u.list({ type: 'individual' }).length, 0);
  assert.equal(u.list({ type: 'individual', includeDeleted: true }).length, 1);
  assert.throws(() => u.applyBatch({ ops: [{ op: 'update', id: 'ind_okada', data: { tier: 1 } }] }), /restore it first/);
  u.applyBatch({ ops: [{ op: 'restore', id: 'ind_okada' }] });
  assert.equal(u.list({ type: 'individual' }).length, 1);
});

test('events attribute every change in their batch', () => {
  seedBasics();
  const res = u.applyBatch({
    event: { name: 'Maelstrom raid', visibility: 'known', data: { severity: 4, location: 'reg_kabuki' } },
    ops: [{ op: 'update', id: 'reg_kabuki', data: { threat: 5 } }],
  });
  assert.equal(u.get(res.eventId).type, 'event');
  assert.equal(u.history('reg_kabuki')[1].eventId, res.eventId);
  assert.equal(u.timeline()[0].eventName, 'Maelstrom raid');
});

test('player view: hidden excluded, rumoured reduced, secrets and hidden refs stripped', () => {
  seedBasics();
  u.applyBatch({
    ops: [
      { op: 'create', id: 'ind_ghost', type: 'individual', name: 'Ghost', visibility: 'rumored', data: { rumor: 'A netrunner nobody has seen', role: 'Netrunner' } },
      { op: 'create', id: 'ind_mole', type: 'individual', name: 'The Mole', visibility: 'known', data: { affiliation: 'grp_secret', role: 'Bartender' }, secretFields: ['role'] },
    ],
  });
  const people = u.list({ type: 'individual', view: 'player' });
  assert.deepEqual(people.map((n) => n.name), ['Ghost', 'The Mole', 'Wakako Okada']);
  assert.deepEqual(people.find((n) => n.id === 'ind_ghost').data, { rumor: 'A netrunner nobody has seen' });

  const okada = u.get('ind_okada', { view: 'player' });
  assert.equal(okada.data.motive, undefined, 'type-level secret field');
  assert.equal(okada.data.affiliation, 'grp_claws');

  const mole = u.get('ind_mole', { view: 'player' });
  assert.equal(mole.data.role, undefined, 'entity-level secret field');
  assert.equal(mole.data.affiliation, undefined, 'ref to a hidden group');
  assert.equal(mole.secretFields, undefined);

  assert.throws(() => u.get('grp_secret', { view: 'player' }), /No entity/);
  assert.equal(u.list({ type: 'group', view: 'player' }).length, 1);
});

test('player search cannot match secret text', () => {
  seedBasics();
  assert.equal(u.list({ q: 'revenge' }).length, 1);
  assert.equal(u.list({ q: 'revenge', view: 'player' }).length, 0);
});

test('revealing is a tracked change', () => {
  seedBasics();
  u.applyBatch({ note: 'Players found the cabal', ops: [{ op: 'update', id: 'grp_secret', patch: { visibility: 'known' } }] });
  assert.equal(u.get('grp_secret', { view: 'player' }).name, 'Hidden Cabal');
  assert.deepEqual(u.history('grp_secret')[1].prior, { visibility: 'hidden' });
});

test('relationships: indexed both ways, tracked over time, filtered for players', () => {
  seedBasics();
  u.applyBatch({
    ops: [
      { op: 'create', id: 'rel_claws_kabuki', type: 'relation', name: 'Claws control Kabuki', visibility: 'known', data: { from: 'grp_claws', to: 'reg_kabuki', kind: 'controls', value: 0.62 } },
      { op: 'create', id: 'rel_cabal_kabuki', type: 'relation', name: 'Cabal in Kabuki', visibility: 'known', data: { from: 'grp_secret', to: 'reg_kabuki', kind: 'controls', value: 0.1 } },
    ],
  });
  u.advanceClock('1d');
  u.applyBatch({ ops: [{ op: 'update', id: 'rel_claws_kabuki', data: { value: 0.5 } }] });

  const now = u.relations('reg_kabuki', { kind: 'controls' });
  assert.deepEqual(now.map((r) => [r.fromName, r.data.value]), [['Tyger Claws', 0.5], ['Hidden Cabal', 0.1]]);
  assert.equal(u.relations('grp_claws').length, 1);
  assert.equal(u.relations('reg_kabuki', { kind: 'controls', at: 0 })[0].data.value, 0.62);
  assert.equal(u.relations('reg_kabuki', { view: 'player' }).length, 1, 'relationship with a hidden group is hidden');
  assert.ok(u.types().some((t) => t.id === 'relation'), 'relationships are a visible type');
});

test('full-text search with prefixes', () => {
  seedBasics();
  assert.deepEqual(u.list({ q: 'tyg' }).map((e) => e.id), ['grp_claws']);
  assert.deepEqual(u.list({ q: 'fixer' }).map((e) => e.id), ['ind_okada']);
  assert.equal(u.list({ q: '"; DROP TABLE' }).length, 0);
});

test('custom types validate like core ones and sort after them', () => {
  u.defineType({ id: 'netrun', name: 'NET Architecture', fields: [{ key: 'floors', type: 'number', label: 'Floors' }, { key: 'ice', type: 'enum', label: 'ICE', options: ['hellhound', 'kraken'] }] });
  u.applyBatch({ ops: [{ op: 'create', id: 'net_arasaka', type: 'netrun', name: 'Tower subnet', data: { floors: 8, ice: 'kraken' } }] });
  assert.equal(u.get('net_arasaka').data.floors, 8);
  assert.throws(() => u.applyBatch({ ops: [{ op: 'update', id: 'net_arasaka', data: { ice: 'goblin' } }] }), /must be one of/);
  assert.throws(() => u.defineType({ id: 'nation', name: 'Dup', fields: [] }), /already exists/);
  assert.equal(u.types().at(-1).id, 'netrun');
  assert.equal(u.type('netrun').category, 'extra');
});

test('changes record the active session', () => {
  const { entities } = u.applyBatch({ ops: [{ op: 'create', id: 'ses_01', type: 'session', name: 'Session 1', data: { number: 1 } }] });
  assert.equal(entities[0].id, 'ses_01');
  u.setMeta({ active_session: 'ses_01' });
  seedBasics();
  assert.equal(u.history('reg_kabuki')[0].sessionId, 'ses_01');
  assert.throws(() => u.setMeta({ active_session: 'reg_kabuki' }), /must be a session/);
});

test('data persists across reopen', () => {
  seedBasics();
  lib.closeAll();
  const reopened = new UniverseLibrary(dir).open('test-city');
  assert.equal(reopened.get('ind_okada').name, 'Wakako Okada');
  reopened.close();
});

test('v1 files upgrade: Location→Place, Faction→Group, NPC→Individual, history rewritten', () => {
  const file = path.join(dir, 'legacy.tempest');
  const db = openDb(file);
  const meta = { name: 'Old', calendar: { type: 'days' }, clock: 100, active_session: null };
  for (const [k, v] of Object.entries(meta)) db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(k, JSON.stringify(v));
  const change = (seq, entity, op, patch, prior = null, t = 0) =>
    db.prepare('INSERT INTO changes (batch, game_time, recorded_at, entity_id, op, patch, prior) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`b${seq}`, t, '2026-01-01T00:00:00Z', entity, op, JSON.stringify(patch), prior && JSON.stringify(prior));
  const base = { visibility: 'known', secretFields: [] };
  change(1, 'reg_k', 'create', { type: 'region', name: 'Kabuki', ...base });
  change(2, 'loc_m', 'create', { type: 'location', name: 'Market', ...base, 'data.region': 'reg_k', 'data.kind': 'Market' });
  change(3, 'fac_c', 'create', { type: 'faction', name: 'Claws', ...base });
  change(4, 'fac_m', 'create', { type: 'faction', name: 'Maelstrom', ...base });
  change(5, 'npc_o', 'create', { type: 'npc', name: 'Okada', ...base, 'data.faction': 'fac_c' });
  change(6, 'npc_o', 'update', { 'data.faction': 'fac_m' }, { 'data.faction': 'fac_c' }, 50);
  db.close();

  const old = new Universe(file);
  assert.equal(old.meta().model, 6);
  assert.equal(old.get('loc_m').type, 'place');
  assert.equal(old.get('loc_m').data.parent, 'reg_k');
  assert.equal(old.get('fac_c').type, 'group');
  const okada = old.get('npc_o');
  assert.equal(okada.type, 'individual');
  assert.equal(okada.data.affiliation, 'fac_m');
  assert.equal(okada.data.faction, undefined);
  assert.equal(old.get('npc_o', { at: 10 }).data.affiliation, 'fac_c', 'time travel still works');
  assert.deepEqual(old.history('npc_o')[1].prior, { 'data.affiliation': 'fac_c' });
  assert.equal(old.list({ type: 'place' }).length, 1);
  old.close();
});

// Smallest valid PNG (1×1 transparent pixel).
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

test('images: stored once by content, sniffed by bytes, required to exist when referenced', () => {
  const a = u.addAsset(PNG);
  assert.match(a.id, /^img_[0-9a-f]{24}$/);
  assert.equal(a.mime, 'image/png');
  assert.equal(u.addAsset(PNG).id, a.id, 'same bytes → same id');
  assert.deepEqual(u.asset(a.id).data, PNG);
  assert.throws(() => u.addAsset(Buffer.from('<svg onload="alert(1)"></svg>')), /Only PNG, JPEG, GIF and WebP/);
  assert.throws(() => u.addAsset(Buffer.alloc(0)), /No image data/);

  seedBasics();
  u.applyBatch({ ops: [{ op: 'update', id: 'ind_okada', data: { image: a.id } }] });
  assert.equal(u.get('ind_okada').data.image, a.id);
  assert.equal(u.get('ind_okada', { view: 'player' }).data.image, a.id);
  assert.throws(() => u.applyBatch({ ops: [{ op: 'update', id: 'ind_okada', data: { image: 'img_missing' } }] }), /Portrait points to an image/);
  assert.equal(u.type('individual').fields[0].label, 'Portrait');
});

test('maps: labelled galleries on places, sessions and articles; players get only revealed ones', () => {
  const a = u.addAsset(PNG);
  const b = u.addAsset(Buffer.concat([PNG, Buffer.from([0])])); // a second, distinct image
  for (const id of ['place', 'session', 'article']) assert.ok(u.type(id).fields.some((f) => f.key === 'maps' && f.type === 'gallery'), id);
  assert.ok(!u.type('individual').fields.some((f) => f.key === 'maps'));

  u.applyBatch({
    ops: [{
      op: 'create', id: 'plc_tower', type: 'place', name: 'Arasaka Tower', visibility: 'known',
      data: { maps: [{ image: a.id, label: 'Lobby', revealed: true }, { image: b.id, label: 'Vault', revealed: false }] },
    }],
  });
  assert.equal(u.get('plc_tower').data.maps.length, 2, 'GM sees every map');
  assert.deepEqual(u.get('plc_tower', { view: 'player' }).data.maps, [{ image: a.id, label: 'Lobby' }], 'players see revealed maps, without flags');

  // Revealing is an ordinary, tracked (and undoable) change
  const { batch } = u.applyBatch({ ops: [{ op: 'update', id: 'plc_tower', data: { maps: [{ image: a.id, label: 'Lobby', revealed: true }, { image: b.id, label: 'Vault', revealed: true }] } }] });
  assert.equal(u.get('plc_tower', { view: 'player' }).data.maps.length, 2);
  u.undo(batch);
  assert.equal(u.get('plc_tower', { view: 'player' }).data.maps.length, 1);

  // Nothing revealed → no maps key at all for players
  u.applyBatch({ ops: [{ op: 'update', id: 'plc_tower', data: { maps: [{ image: a.id, label: 'Lobby' }] } }] });
  assert.equal('maps' in u.get('plc_tower', { view: 'player' }).data, false);

  assert.throws(() => u.applyBatch({ ops: [{ op: 'update', id: 'plc_tower', data: { maps: [{ image: 'img_missing', label: 'X' }] } }] }), /Maps points to an image/);
  assert.throws(() => u.applyBatch({ ops: [{ op: 'update', id: 'plc_tower', data: { maps: [{ image: a.id, secret: 'x' }] } }] }), /list of \{ image, label, revealed \}/);
  assert.throws(() => u.applyBatch({ ops: [{ op: 'update', id: 'plc_tower', data: { maps: 'img' } }] }), /list of \{ image, label, revealed \}/);
});

test('display: push views to the player screen, never a GM-only entity', () => {
  seedBasics();
  assert.deepEqual(u.display(), { mode: 'ambient' });
  const pushed = u.setDisplay({ mode: 'entity', id: 'ind_okada' });
  assert.equal(pushed.type, 'individual');
  assert.ok(pushed.pushedAt);
  assert.equal(u.display().id, 'ind_okada');
  assert.throws(() => u.setDisplay({ mode: 'entity', id: 'grp_secret' }), /GM only. Reveal it/);
  assert.equal(u.setDisplay({ mode: 'roster', type: 'individual' }).type, 'individual');
  assert.throws(() => u.setDisplay({ mode: 'roster', type: 'nope' }), /Unknown entity type/);
  const img = u.addAsset(PNG);
  assert.equal(u.setDisplay({ mode: 'handout', asset: img.id, caption: '  Map of Kabuki ' }).caption, 'Map of Kabuki');
  assert.throws(() => u.setDisplay({ mode: 'handout', asset: 'img_missing' }), /No image/);
  assert.equal(u.setDisplay({ mode: 'message', text: 'Red alert', tone: 'danger' }).tone, 'danger');
  assert.throws(() => u.setDisplay({ mode: 'message', text: '  ' }), /needs some text/);
  assert.throws(() => u.setDisplay({ mode: 'party' }), /mode must be one of/);
  assert.equal(u.setDisplay({ mode: 'ambient' }).mode, 'ambient');
});

test('v2 universes gain image fields on open', () => {
  const file = path.join(dir, 'v2.tempest');
  const v2 = Universe.create(file, { name: 'V2' });
  v2.close();
  const db = openDb(file);
  db.prepare("UPDATE meta SET value = '2' WHERE key = 'model'").run();
  db.prepare("UPDATE entity_types SET fields = json_remove(fields, '$[0]') WHERE id = 'individual'").run();
  db.close();
  const reopened = new Universe(file);
  assert.equal(reopened.meta().model, 6);
  assert.equal(reopened.type('individual').fields[0].key, 'image');
  reopened.close();
});

test('time helpers: durations, calendars, negative time', () => {
  assert.equal(parseDuration('1d 6h 30m'), 1830);
  assert.equal(parseDuration('2w'), 20160);
  assert.equal(parseDuration('-1y'), -365 * DAY);
  assert.equal(parseDuration(90), 90);
  assert.throws(() => parseDuration('3 fortnights'), /Unknown time unit/);
  assert.equal(formatGameTime(1830, { type: 'days' }), 'Day 2, 06:30');
  const dr = { type: 'years', epochYear: 1492, daysPerYear: 365, suffix: 'DR' };
  assert.equal(formatGameTime(0, dr), '1492 DR · Day 1, 00:00');
  assert.equal(formatGameTime(400 * DAY + 90, dr), '1493 DR · Day 36, 01:30');
  assert.equal(formatGameTime(-DAY, dr), '1491 DR · Day 365, 00:00');
  assert.equal(formatGameTime(-60, { type: 'gregorian', epoch: '2045-08-01T00:00' }), '2045-07-31 23:00');
});
