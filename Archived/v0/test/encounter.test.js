const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const E = require('../world/encounter');
const { UniverseLibrary } = require('../world/universes');

// Deterministic d20s: each call returns the next value (1–20) from the list.
const dice = (...rolls) => {
  let i = 0;
  return { rng: () => (rolls[i++ % rolls.length] - 1) / 20 };
};

const raider = { entityId: 'comb_raider', type: 'combatant', name: 'Raider', image: null, pc: false, side: 'enemy', hp: 12, armor: 13, initBonus: 1, slots: [] };
const rook = { entityId: 'ind_rook', type: 'individual', name: 'Rook', image: null, pc: true, side: 'pc', hp: 30, armor: 15, initBonus: 3, slots: E.parseSlots('4 2') };

const ids = (s) => s.combatants.map((c) => E.displayName(c));

test('slot pools parse from level counts or named pools', () => {
  assert.deepEqual(E.parseSlots('4 3 2'), [{ label: '1st', max: 4, used: 0 }, { label: '2nd', max: 3, used: 0 }, { label: '3rd', max: 2, used: 0 }]);
  assert.deepEqual(E.parseSlots('Ki 5, Rage: 3'), [{ label: 'Ki', max: 5, used: 0 }, { label: 'Rage', max: 3, used: 0 }]);
  assert.deepEqual(E.parseSlots(''), []);
  assert.deepEqual(E.parseSlots('lots'), []);
});

test('entities become combatants: PCs, mobs and NPCs by disposition', () => {
  assert.equal(E.sourceFrom({ id: 'i', type: 'individual', name: 'A', data: { pc: true, hp: 22, armor: 14, initiative: 2, slots: '3' } }).side, 'pc');
  assert.equal(E.sourceFrom({ id: 'i', type: 'individual', name: 'B', data: { disposition: 'hostile' } }).side, 'enemy');
  assert.equal(E.sourceFrom({ id: 'i', type: 'individual', name: 'C', data: { disposition: 'allied' } }).side, 'ally');
  const mob = E.sourceFrom({ id: 'm', type: 'combatant', name: 'Drone', data: { hp: 8 } });
  assert.equal(mob.side, 'enemy');
  assert.equal(mob.hp, 8);
  assert.equal(E.sourceFrom({ id: 'm', type: 'combatant', name: 'Nobody', data: {} }).hp, 10, 'a default so the tracker always has a bar');
});

test('clones get unique numbers that are never reused', () => {
  let s = E.act(null, { action: 'add', count: 1 }, { source: raider });
  assert.deepEqual(ids(s), ['Raider'], 'one of a kind needs no number');
  s = E.act(s, { action: 'add', count: 2 }, { source: raider });
  assert.deepEqual(ids(s), ['Raider #1', 'Raider #2', 'Raider #3'], 'adding more numbers the first one too');
  s = E.act(s, { action: 'remove', id: s.combatants[1].id });
  s = E.act(s, { action: 'add' }, { source: raider });
  assert.deepEqual(ids(s), ['Raider #1', 'Raider #3', 'Raider #4']);
  // Custom (no entity) combatants number by name.
  s = E.act(s, { action: 'add', name: 'Rat', count: 2 });
  assert.deepEqual(ids(s).slice(-2), ['Rat #1', 'Rat #2']);
  assert.throws(() => E.act(s, { action: 'add', count: 99 }, { source: raider }), /Count/);
});

test('a player character joins once and is never numbered', () => {
  const s = E.act(null, { action: 'add' }, { source: rook });
  assert.deepEqual(ids(s), ['Rook']);
  assert.throws(() => E.act(s, { action: 'add' }, { source: rook }), /already in the fight/);
});

test('start rolls for the GM side, sorts, and turns go round-robin with rounds', () => {
  let s = E.act(null, { action: 'add', init: 14 }, { source: rook });
  s = E.act(s, { action: 'add', count: 2 }, { source: raider });
  s = E.act(s, { action: 'start' }, dice(19, 5)); // Raider #1: 19+1=20, Raider #2: 5+1=6
  assert.deepEqual(ids(s), ['Raider #1', 'Rook', 'Raider #2']);
  assert.equal(s.round, 1);
  assert.equal(s.current, s.combatants[0].id);
  s = E.act(s, { action: 'next' });
  s = E.act(s, { action: 'next' });
  assert.equal(E.displayName(s.combatants.find((c) => c.id === s.current)), 'Raider #2');
  s = E.act(s, { action: 'next' });
  assert.equal(s.round, 2, 'wrapping back to the top starts a new round');
  assert.equal(s.current, s.combatants[0].id);
  s = E.act(s, { action: 'prev' });
  assert.equal(s.round, 1);
});

test('damage hits temporary hit points first; mobs drop out at 0 and lose their turn', () => {
  let s = E.act(null, { action: 'add', init: 10 }, { source: rook });
  s = E.act(s, { action: 'add', count: 2, init: 5 }, { source: raider });
  const [pc, r1, r2] = s.combatants;
  s = E.act(s, { action: 'update', id: pc.id, patch: { tempHp: 5 } });
  s = E.act(s, { action: 'hp', id: pc.id, delta: -8 });
  assert.equal(s.combatants[0].tempHp, 0);
  assert.equal(s.combatants[0].hp, 27);
  s = E.act(s, { action: 'hp', id: pc.id, delta: 100 });
  assert.equal(s.combatants[0].hp, 30, 'healing stops at the maximum');
  s = E.act(s, { action: 'hp', id: pc.id, delta: -50 });
  assert.equal(s.combatants[0].out, false, 'player characters stay in at 0');

  s = E.act(s, { action: 'start' });
  s = E.act(s, { action: 'hp', id: r1.id, delta: -12 });
  assert.equal(s.combatants[1].out, true);
  s = E.act(s, { action: 'next' });
  assert.equal(s.current, r2.id, 'the defeated raider is skipped');
});

test('conditions with a duration tick down at the start of their bearer\'s turn', () => {
  let s = E.act(null, { action: 'add', init: 10 }, { source: rook });
  s = E.act(s, { action: 'add', init: 5 }, { source: raider });
  const raiderId = s.combatants[1].id;
  s = E.act(s, { action: 'condition', id: raiderId, name: 'Stunned', rounds: 1 });
  s = E.act(s, { action: 'condition', id: raiderId, name: 'Prone' });
  s = E.act(s, { action: 'start' });
  s = E.act(s, { action: 'next' }); // raider's turn starts: Stunned (1 round) ends
  assert.deepEqual(s.combatants[1].conditions, [{ name: 'Prone' }]);
  s = E.act(s, { action: 'condition', id: raiderId, name: 'prone', remove: true });
  assert.deepEqual(s.combatants[1].conditions, []);
});

test('slots spend and restore within their pool', () => {
  let s = E.act(null, { action: 'add' }, { source: rook });
  const id = s.combatants[0].id;
  s = E.act(s, { action: 'slot', id, pool: 1, delta: 1 });
  s = E.act(s, { action: 'slot', id, pool: 1, delta: 5 });
  assert.equal(s.combatants[0].slots[1].used, 2);
  s = E.act(s, { action: 'update', id, patch: { slotsText: '4 3 1' } });
  assert.deepEqual(s.combatants[0].slots.map((p) => [p.label, p.max, p.used]), [['1st', 4, 0], ['2nd', 3, 2], ['3rd', 1, 0]]);
});

test('ending combat sends the foes home; PCs keep their wounds until they rest', () => {
  let s = E.act(null, { action: 'add', init: 12 }, { source: rook });
  s = E.act(s, { action: 'add', count: 3 }, { source: raider });
  s = E.act(s, { action: 'start' });
  const pc = s.combatants.find((c) => c.pc).id;
  s = E.act(s, { action: 'hp', id: pc, delta: -10 });
  s = E.act(s, { action: 'slot', id: pc, pool: 0, delta: 2 });
  s = E.act(s, { action: 'end' });
  assert.equal(s.active, false);
  assert.deepEqual(ids(s), ['Rook']);
  assert.equal(s.combatants[0].hp, 20);
  assert.equal(s.combatants[0].init, null);
  s = E.act(s, { action: 'add', count: 2 }, { source: raider });
  assert.deepEqual(ids(s).slice(1), ['Raider #1', 'Raider #2'], 'numbering starts over in the next fight');
  s = E.act(s, { action: 'rest' });
  assert.equal(s.combatants[0].hp, 30);
  assert.equal(s.combatants[0].slots[0].used, 0);
});

test('the player view hides GM secrets: hidden and defeated foes, exact enemy health', () => {
  let s = E.act(null, { action: 'add', init: 15 }, { source: rook });
  s = E.act(s, { action: 'add', count: 3, init: 8 }, { source: raider });
  const [, r1, r2, r3] = s.combatants;
  assert.deepEqual(E.playerView(s), { active: false, round: 0, current: null, order: [] }, 'nothing shows before combat');
  s = E.act(s, { action: 'update', id: r2.id, patch: { hidden: true } });
  s = E.act(s, { action: 'hp', id: r3.id, delta: -12 });
  s = E.act(s, { action: 'hp', id: r1.id, delta: -5 });
  s = E.act(s, { action: 'start' });
  const view = E.playerView(s);
  assert.deepEqual(view.order.map((c) => E.displayName(c)), ['Rook', 'Raider #1']);
  assert.equal(view.order[0].hp, 30);
  assert.equal(view.order[1].hp, undefined);
  assert.equal(view.order[1].health, 'wounded');
  assert.equal(JSON.stringify(view).includes('armor":13'), false);

  // Turn passes to the hidden raider: the bar points at whoever is visible next.
  s = E.act(s, { action: 'next' }); // Raider #1
  s = E.act(s, { action: 'next' }); // Raider #2 (hidden)
  assert.equal(s.current, r2.id);
  assert.equal(E.playerView(s).current, s.combatants[0].id);
});

test('a universe stores the tracker outside history and copies stats from entities', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-test-'));
  const lib = new UniverseLibrary(dir);
  try {
    const u = lib.create({ name: 'Fight Club' });
    u.applyBatch({
      ops: [
        { op: 'create', id: 'ind_rook', type: 'individual', name: 'Rook', visibility: 'known', data: { pc: true, hp: 35, armor: 14, initiative: 2, slots: 'Ki 4' } },
        { op: 'create', id: 'comb_ganger', type: 'combatant', name: 'Ganger', data: { hp: 15, armor: 11 } },
      ],
    });
    const before = u.timeline().length;
    u.encounterAct({ action: 'add', entityId: 'ind_rook' });
    const s = u.encounterAct({ action: 'add', entityId: 'comb_ganger', count: 2 });
    assert.deepEqual(s.combatants.map((c) => [E.displayName(c), c.side, c.maxHp]), [['Rook', 'pc', 35], ['Ganger #1', 'enemy', 15], ['Ganger #2', 'enemy', 15]]);
    assert.deepEqual(s.combatants[0].slots, [{ label: 'Ki', max: 4, used: 0 }]);
    assert.equal(u.timeline().length, before, 'tracker actions are not world history');
    assert.equal(u.encounter({ view: 'player' }).active, false);
    assert.throws(() => u.encounterAct({ action: 'add', entityId: 'nope' }), /No entity/);
    assert.throws(() => u.encounterAct({ action: 'dance' }), /Unknown tracker action/);
    // Mob stats are GM secrets in dossiers.
    assert.equal(u.get('ind_rook', { view: 'player' }).data.hp, undefined);
  } finally {
    lib.closeAll();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('attacks deal damage and are remembered for the player screen', () => {
  let s = E.act(null, { action: 'add', init: 15 }, { source: rook });
  s = E.act(s, { action: 'add', count: 2, init: 8 }, { source: raider });
  const [pc, r1, r2] = s.combatants;
  assert.throws(() => E.act(s, { action: 'attack', attackerId: r1.id, targetId: pc.id, damage: 5 }), /Start combat/);
  s = E.act(s, { action: 'start' });
  s = E.act(s, { action: 'update', id: pc.id, patch: { tempHp: 3 } });

  s = E.act(s, { action: 'attack', attackerId: r1.id, targetId: pc.id, damage: 10 }, { now: () => 1000 });
  assert.equal(s.combatants[0].hp, 23, 'temporary hit points soak first');
  assert.deepEqual(s.attack, {
    seq: 1, at: 1000, attackerId: r1.id, targetId: pc.id, result: 'hit', damage: 10,
    before: { hp: 30, maxHp: 30, tempHp: 3 }, after: { hp: 23, maxHp: 30, tempHp: 0 }, down: false,
  });
  // PCs see their own numbers.
  const seen = E.playerView(s).attack;
  assert.equal(seen.target.after.hp, 23);
  assert.equal(seen.attacker.name, 'Raider');
  assert.equal(seen.attacker.no, 1);

  s = E.act(s, { action: 'attack', attackerId: pc.id, targetId: r2.id, result: 'miss', damage: 50 });
  assert.equal(s.combatants[2].hp, 12, 'a miss deals nothing');
  assert.equal(s.attack.seq, 2);

  s = E.act(s, { action: 'attack', attackerId: pc.id, targetId: r2.id, result: 'crit', damage: 9 });
  let view = E.playerView(s).attack;
  assert.equal(view.result, 'crit');
  assert.deepEqual(view.target.before, { ratio: 1, band: 'unhurt' });
  assert.deepEqual(view.target.after, { ratio: 0.25, band: 'critical' }, 'foes show a bar position, never numbers');
  assert.equal(JSON.stringify(view).includes('"hp"'), false);

  s = E.act(s, { action: 'attack', attackerId: pc.id, targetId: r2.id, damage: 20 });
  assert.equal(s.attack.down, true);
  assert.equal(s.combatants[2].out, true);
  assert.equal(E.playerView(s).attack.target.name, 'Raider', 'the scene still shows them going down');

  assert.throws(() => E.act(s, { action: 'attack', attackerId: pc.id, targetId: pc.id, damage: 1 }), /someone else/);
  assert.throws(() => E.act(s, { action: 'attack', attackerId: pc.id, targetId: r1.id, result: 'graze' }), /result/);
  assert.equal(E.act(s, { action: 'end' }).attack, undefined);
});

test('players never see an attack on a hidden target, or who a hidden attacker is', () => {
  let s = E.act(null, { action: 'add', init: 15 }, { source: rook });
  s = E.act(s, { action: 'add', count: 2, init: 8 }, { source: raider });
  const [pc, r1, r2] = s.combatants;
  s = E.act(s, { action: 'update', id: r1.id, patch: { hidden: true } });
  s = E.act(s, { action: 'start' });
  s = E.act(s, { action: 'attack', attackerId: r1.id, targetId: pc.id, damage: 4 });
  const view = E.playerView(s).attack;
  assert.equal(view.attacker.unknown, true);
  assert.equal(JSON.stringify(view.attacker).includes('Raider'), false);
  s = E.act(s, { action: 'attack', attackerId: pc.id, targetId: r1.id, damage: 4 });
  assert.equal(E.playerView(s).attack, undefined);
  s = E.act(s, { action: 'attack', attackerId: pc.id, targetId: r2.id, damage: 4 });
  assert.equal(E.playerView(s).attack.target.name, 'Raider');
});