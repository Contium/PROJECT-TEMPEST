// Combat › Initiative: the tracker's rules (initiative-model.js), the project's
// encounter route, and the turn order every player screen carries while a fight is on.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectLibrary, handleProjects } = require('../server/projects');
const { createDisplay } = require('../server/display');

const load = async () => ({
  M: await import('../app/combat/initiative-model.js'),
  E: await import('../app/forge/entity-model.js'),
  P: await import('../app/forge/preset-model.js'),
  T: await import('../app/forge/templates/cyberpunk-red-player.js'),
});

/** A seeded rng: the same rolls every run. */
const seeded = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

test('adding, rolling and starting: highest first, ties by bonus, PCs keep their own rolls', async () => {
  const { M } = await load();
  let s = M.empty({ die: 'd10' });
  s = M.act(s, { action: 'add', name: 'Ganger', hp: 20, initBonus: 4, count: 2 });
  assert.deepEqual(s.combatants.map(M.nameOf), ['Ganger #1', 'Ganger #2']);
  s = M.act(s, { action: 'add', name: 'Ganger', hp: 20, initBonus: 4 });
  assert.equal(M.nameOf(s.combatants[2]), 'Ganger #3', 'copies keep counting');
  const pc = { entityId: 'char_00000001', hpField: 'cpr_hp', name: 'Brick', image: null, pc: true, side: 'pc', hp: 30, maxHp: 45, armor: 11, initBonus: 8, slots: [] };
  s = M.act(s, { action: 'add', entityId: pc.entityId }, { source: pc });
  assert.throws(() => M.act(s, { action: 'add', entityId: pc.entityId }, { source: pc }), /already in the fight/);
  s = M.act(s, { action: 'update', id: s.combatants[3].id, patch: { init: 15 } });
  // d10: 1 + floor(0.95 * 10) + 4 = 14, 1 + 0 + 4 = 5, 1 + floor(0.5 * 10) + 4 = 10
  s = M.act(s, { action: 'start' }, { rng: seeded(0.95, 0, 0.5) });
  assert.equal(s.active, true);
  assert.equal(s.round, 1);
  assert.deepEqual(s.combatants.map((c) => c.init), [15, 14, 10, 5]);
  assert.equal(s.current, s.combatants[0].id);
  assert.equal(s.combatants[0].hp, 30, 'a PC joins with the wounds on their sheet');
});

test('turns, rounds, conditions, damage and the attack players see', async () => {
  const { M } = await load();
  let s = M.empty();
  s = M.act(s, { action: 'add', name: 'Alpha', hp: 10, init: 20 });
  s = M.act(s, { action: 'add', name: 'Beta', hp: 10, init: 10 });
  s = M.act(s, { action: 'add', name: 'Gamma', hp: 10, init: 5 });
  const [a, b, c] = s.combatants.map((x) => x.id);
  s = M.act(s, { action: 'start' });
  s = M.act(s, { action: 'condition', id: b, name: 'Prone', rounds: 1 });
  s = M.act(s, { action: 'next' });
  assert.equal(s.current, b);
  assert.equal(s.combatants[1].conditions.length, 0, 'a one-round condition ends when its turn starts');
  s = M.act(s, { action: 'update', id: b, patch: { tempHp: 3 } });
  s = M.act(s, { action: 'attack', attackerId: a, targetId: b, result: 'hit', damage: 5 }, { now: () => 1000 });
  assert.equal(s.combatants[1].hp, 8, 'temporary hit points soak damage first');
  s = M.act(s, { action: 'attack', attackerId: a, targetId: b, result: 'crit', damage: 50 });
  assert.equal(s.combatants[1].out, true, 'a foe at 0 drops out');
  assert.equal(s.current, c, 'the turn moves on from the fallen');
  s = M.act(s, { action: 'next' });
  assert.equal(s.current, a);
  assert.equal(s.round, 2, 'wrapping round starts a new round');
  s = M.act(s, { action: 'prev' });
  assert.equal(s.round, 1);

  const view = M.playerView(s);
  assert.equal(view.active, true);
  assert.deepEqual(view.order.map((x) => x.name), ['Alpha', 'Gamma'], 'the defeated leave the bar');
  assert.equal(view.order[0].health, 'unhurt');
  assert.equal(view.order[0].hp, undefined, 'foes show a band, never numbers');
  assert.equal(view.attack.down, true);
  assert.equal(view.attack.target.after.band, 'down');
  assert.equal(view.attack.target.before.hp, undefined);

  s = M.act(s, { action: 'update', id: c, patch: { hidden: true } });
  assert.deepEqual(M.playerView(s).order.map((x) => x.name), ['Alpha']);
  s = M.act(s, { action: 'settings', screen: false });
  assert.equal(M.playerView(s).active, false, 'the GM can keep the bar off the screens');
  s = M.act(s, { action: 'end' });
  assert.equal(s.combatants.length, 0, 'foes leave when combat ends');
  assert.equal(M.playerView(s).active, false);
});

test('slots parse from text and are spent and restored', async () => {
  const { M } = await load();
  assert.deepEqual(M.parseSlots('4 3 2').map((p) => `${p.label}:${p.max}`), ['1st:4', '2nd:3', '3rd:2']);
  assert.deepEqual(M.parseSlots('Ki 5, Rage: 3').map((p) => `${p.label}:${p.max}`), ['Ki:5', 'Rage:3']);
  let s = M.act(M.empty(), { action: 'add', name: 'Monk', hp: 20 });
  const id = s.combatants[0].id;
  s = M.act(s, { action: 'update', id, patch: { slotsText: 'Ki 5' } });
  s = M.act(s, { action: 'slot', id, pool: 0, delta: 2 });
  s = M.act(s, { action: 'update', id, patch: { slotsText: 'Ki 6, Rage 2' } });
  assert.deepEqual(s.combatants[0].slots, [{ label: 'Ki', max: 6, used: 2 }, { label: 'Rage', max: 2, used: 0 }], 'retyped pools keep what was spent');
  assert.throws(() => M.act(s, { action: 'nope' }), /Unknown tracker action/);
});

test('a character sheet gives hit points, initiative (or REF) and armor, whatever the preset', async () => {
  const { M, E, T } = await load();
  const preset = T.build();
  const brick = E.forge(preset, { values: { ...E.defaultValues(preset), name: 'Brick', category: 'player', cpr_ref: { value: 8 }, cpr_hp: { value: 30, max: 45 } } });
  const src = M.sourceFrom(brick);
  assert.equal(src.pc, true);
  assert.equal(src.side, 'pc');
  assert.equal(src.hp, 30);
  assert.equal(src.maxHp, 45);
  assert.equal(src.hpField, 'cpr_hp');
  assert.equal(src.initBonus, 8, 'Cyberpunk RED: REF is the initiative bonus');
  const monster = M.sourceFrom({ id: 'char_00000002', name: 'Thing', category: 'monster', sheet: { fields: {
    a: { id: 'a', type: 'stat', label: 'HP' }, b: { id: 'b', type: 'stat', label: 'Initiative' }, c: { id: 'c', type: 'stat', label: 'Armor Class' } } },
  values: { a: { value: 22 }, b: { value: 3 }, c: { value: 15 } } });
  assert.deepEqual([monster.side, monster.hp, monster.maxHp, monster.initBonus, monster.armor], ['enemy', 22, 22, 3, 15]);
  const bare = M.sourceFrom({ id: 'char_00000003', name: 'Nobody', category: 'npc', sheet: { fields: {} }, values: {} });
  assert.deepEqual([bare.side, bare.hp, bare.initBonus, bare.armor], ['neutral', 10, 0, null]);
});

test('a saved encounter is checked on load; anything broken starts over', async () => {
  const { M } = await load();
  assert.deepEqual(M.normalizeEncounter(null, { die: 'd10' }).die, 'd10');
  assert.equal(M.normalizeEncounter({ combatants: [{ name: '', maxHp: 3 }] }).combatants.length, 0);
  const s = M.normalizeEncounter({ active: true, current: 'c_ffffffff', combatants: [{ id: 'c_00000001', name: 'A', maxHp: 5, hp: 9 }] });
  assert.equal(s.combatants[0].hp, 5);
  assert.equal(s.current, 'c_00000001', 'a missing current turn falls to the first who can act');
});

test('the encounter route: add a character, fight, and the turn order rides along with every display', async () => {
  const { E, T } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-init-'));
  try {
    const library = createProjectLibrary(dir);
    const display = createDisplay(path.join(dir, 'display.json'), library);
    library.onEncounter = (id, state) => display.setTracker(id, state);
    const project = await library.create({ name: 'Fight', theme: 'cyberpunk-red' });
    const stores = await library.open(project.id);
    const preset = T.build();
    const brick = await stores.characters.create(E.forge(preset, { values: { ...E.defaultValues(preset), name: 'Brick', category: 'player', cpr_ref: { value: 8 } } }));

    const call = async (method, body) => {
      const res = {};
      const handled = await handleProjects(library, { method }, res, `/${project.id}/encounter`, new URLSearchParams(), {
        readJson: async () => body, sendJson: (r, status, data) => Object.assign(r, { status, data }),
      });
      assert.equal(handled, true);
      return res;
    };
    const fresh = await call('GET');
    assert.equal(fresh.data.die, 'd10', 'a Cyberpunk RED project rolls a d10');
    assert.equal((await call('POST', { action: 'add', entityId: 'char_0000dead' })).status, 404);
    await call('POST', { action: 'add', entityId: brick.id });
    await call('POST', { action: 'add', name: 'Ganger', hp: 25, count: 2, initBonus: 5 });
    assert.equal(display.get().tracker, null, 'nothing on screen before combat starts');
    const started = await call('POST', { action: 'start' });
    assert.equal(started.data.active, true);
    assert.equal(started.data.combatants.length, 3);

    const now = display.get('Alex');
    assert.equal(now.mode, 'ambient', 'the push itself is untouched');
    assert.equal(now.tracker.projectId, project.id);
    assert.deepEqual(now.tracker.order.map((c) => c.name).sort(), ['Brick', 'Ganger', 'Ganger']);
    const pushed = await display.push({ mode: 'message', text: 'Ambush!', tone: 'danger' });
    assert.equal(pushed.tracker.round, 1, 'and stays up whatever is pushed');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'display.json'), 'utf8')).tracker.round, 1, 'kept across restarts');

    // End combat with "keep wounds": Brick's sheet gets the tracker's hit points.
    const brickId = started.data.combatants.find((c) => c.pc).id;
    await call('POST', { action: 'hp', id: brickId, delta: -12 });
    const ended = await call('POST', { action: 'end', save: true });
    assert.equal(ended.data.combatants.length, 1);
    assert.equal((await stores.characters.get(brick.id)).values.cpr_hp.value, 35 - 12);
    assert.equal(display.get().tracker, null, 'the bar leaves when combat ends');
    assert.equal((await call('POST', { action: 'next' })).status, 400);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
