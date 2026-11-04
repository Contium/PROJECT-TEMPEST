// Initiative Tracker: who is in the fight, in what order, whose turn it is, and
// each combatant's hit points, armor, ability slots and conditions.
//
// Like the player screen's display this is table state, not world history: it
// lives in one meta value and every action replaces it. Everything here is a
// pure function of (state, action) so it can be tested without a universe.
//
// Combatant: {
//   id, entityId?, type?, name, no?        no = clone number ("Raider #2"), unique per source
//   side: pc | ally | neutral | enemy, pc, image?
//   init?, initBonus                        rolled/entered initiative and the d20 bonus
//   hp, maxHp, tempHp, armor?
//   slots: [{ label, max, used }]           ability/spell slot pools
//   conditions: [{ name, rounds? }]         rounds tick down at the start of their turn
//   hidden                                  in the order, but not on the player screen
//   out                                     defeated: skipped in turn order, off the player screen
// }
// attack: the last attack ({ seq, at, attackerId, targetId, result, damage, before, after, down }),
// which the player screen plays out for a few seconds.

const crypto = require('node:crypto');
const { badRequest, notFound, conflict } = require('./errors');

const SIDES = ['pc', 'ally', 'neutral', 'enemy'];
// The 5e conditions plus the usual table extras; any other name works too.
const CONDITIONS = [
  'Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed',
  'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Exhaustion', 'Concentrating',
  'Blessed', 'Hasted', 'Burning', 'Bleeding',
];
const ATTACK_RESULTS = ['hit', 'crit', 'miss'];
const MAX_COMBATANTS = 60;
const MAX_CLONES = 20;

const empty = () => ({ active: false, round: 0, current: null, combatants: [], serials: {}, rev: 0 });

const newId = () => `c_${crypto.randomBytes(4).toString('hex')}`;
const displayName = (c) => (c.no ? `${c.name} #${c.no}` : c.name);
const ordinal = (n) => `${n}${[, 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10] || 'th'}`;

const int = (v, label, { min = -999, max = 9999 } = {}) => {
  if (!Number.isInteger(v) || v < min || v > max) throw badRequest(`${label} must be a whole number from ${min} to ${max}`);
  return v;
};
const text = (v, label, max) => {
  if (typeof v !== 'string' || !v.trim()) throw badRequest(`${label} needs some text`);
  return v.trim().slice(0, max);
};

/**
 * "4 3 2" → 1st/2nd/3rd-level pools; "Ki 5, Rage 3" or "1st: 4; 2nd: 3" → named pools.
 * Returns [{ label, max, used: 0 }]; anything unreadable is skipped.
 */
function parseSlots(input) {
  const s = String(input ?? '').trim();
  if (!s) return [];
  if (/^\d+(\s+\d+)*$/.test(s)) {
    return s.split(/\s+/).map((n, i) => ({ label: ordinal(i + 1), max: Math.min(Number(n), 99), used: 0 })).filter((p) => p.max > 0);
  }
  return s.split(/[,;\n]/).map((part, i) => {
    const m = part.trim().match(/^(.*?)[\s:=×x]*(\d+)$/);
    if (!m) return null;
    return { label: m[1].trim().slice(0, 24) || ordinal(i + 1), max: Math.min(Number(m[2]), 99), used: 0 };
  }).filter((p) => p && p.max > 0).slice(0, 12);
}

/** Combatant defaults from an entity (an individual, a mob, or anything with combat stats). */
function sourceFrom(entity) {
  const d = entity.data ?? {};
  const pc = entity.type === 'individual' && d.pc === true;
  const bySide = { hostile: 'enemy', unfriendly: 'enemy', friendly: 'ally', allied: 'ally' };
  const side = pc ? 'pc' : entity.type === 'combatant' ? d.side ?? 'enemy' : bySide[d.disposition] ?? 'neutral';
  const hp = Number.isFinite(d.hp) && d.hp > 0 ? Math.round(d.hp) : 10;
  return {
    entityId: entity.id, type: entity.type, name: entity.name, image: d.image ?? null, pc, side,
    hp, armor: Number.isFinite(d.armor) ? Math.round(d.armor) : null,
    initBonus: Number.isFinite(d.initiative) ? Math.round(d.initiative) : 0,
    slots: parseSlots(d.slots),
  };
}

/** Initiative order: highest first, then the higher bonus; ties keep their order. Unrolled last. */
function sortOrder(list) {
  return list
    .map((c, i) => [c, i])
    .sort(([a, i], [b, j]) => (b.init ?? -Infinity) - (a.init ?? -Infinity) || b.initBonus - a.initBonus || i - j)
    .map(([c]) => c);
}

const canAct = (c) => !c.out;

/** The next combatant who can act after `fromId`, walking `dir` (1 or -1). Returns { id, wrapped }. */
function step(list, fromId, dir) {
  const n = list.length;
  const start = list.findIndex((c) => c.id === fromId);
  for (let k = 1; k <= n; k++) {
    const i = start === -1 ? (dir > 0 ? k - 1 : n - k) : start + dir * k;
    const c = list[((i % n) + n) % n];
    if (canAct(c)) return { id: c.id, wrapped: start !== -1 && (dir > 0 ? i >= n : i < 0) };
  }
  return { id: null, wrapped: false };
}

/** Conditions with a duration tick down when their bearer's turn starts. */
function startTurn(c) {
  c.conditions = c.conditions
    .map((x) => (x.rounds == null ? x : { ...x, rounds: x.rounds - 1 }))
    .filter((x) => x.rounds == null || x.rounds > 0);
}

function setHp(c, hp) {
  c.hp = Math.max(0, Math.min(hp, c.maxHp));
  // Mobs and NPCs drop out at 0; player characters stay in the order (death saves).
  if (!c.pc) c.out = c.hp === 0;
}

/** Damage eats temporary hit points first. */
function hurt(c, amount) {
  const soak = Math.min(c.tempHp, amount);
  c.tempHp -= soak;
  setHp(c, c.hp - amount + soak);
}

const hpOf = (c) => ({ hp: c.hp, maxHp: c.maxHp, tempHp: c.tempHp });

function cleanConditions(list) {
  if (!Array.isArray(list)) throw badRequest('conditions must be a list');
  return list.slice(0, 20).map((x) => ({
    name: text(x?.name, 'A condition', 40),
    ...(x?.rounds == null ? {} : { rounds: int(x.rounds, 'Rounds', { min: 1, max: 999 }) }),
  }));
}

function cleanSlots(list) {
  if (!Array.isArray(list)) throw badRequest('slots must be a list');
  return list.slice(0, 12).map((p) => {
    const max = int(p?.max, 'Slot maximum', { min: 1, max: 99 });
    return { label: text(p?.label, 'A slot pool', 24), max, used: int(p?.used ?? 0, 'Slots used', { min: 0, max }) };
  });
}

/** Apply one tracker action; returns the new state (the input is not modified). */
function act(prev, action = {}, { source = null, rng = Math.random, now = Date.now } = {}) {
  const s = structuredClone(prev ?? empty());
  const find = (id) => {
    const c = s.combatants.find((x) => x.id === id);
    if (!c) throw notFound('That combatant has left the fight');
    return c;
  };
  const roll = (c) => (c.init = 1 + Math.floor(rng() * 20) + c.initBonus);

  switch (action.action) {
    case 'add': {
      const count = action.count == null ? 1 : int(action.count, 'Count', { min: 1, max: MAX_CLONES });
      const base = source ?? {
        entityId: null, type: null, name: text(action.name, 'A combatant', 60), image: null, pc: false,
        side: 'enemy', hp: action.hp == null ? 10 : int(action.hp, 'Hit points', { min: 1 }),
        armor: action.armor == null ? null : int(action.armor, 'Armor', { min: 0, max: 99 }),
        initBonus: action.initBonus == null ? 0 : int(action.initBonus, 'Initiative bonus', { min: -20, max: 50 }),
        slots: [],
      };
      if (base.pc && s.combatants.some((c) => c.entityId === base.entityId)) throw conflict(`${base.name} is already in the fight`);
      if (s.combatants.length + count > MAX_COMBATANTS) throw badRequest(`A fight holds at most ${MAX_COMBATANTS} combatants`);
      const side = action.side ?? base.side;
      if (!SIDES.includes(side)) throw badRequest(`side must be one of ${SIDES.join(', ')}`);

      // Clones get a number that is never reused in this fight, so "#2" always means the same one.
      const key = base.entityId ?? `name:${base.name.toLowerCase()}`;
      const kin = s.combatants.filter((c) => (c.entityId ?? `name:${c.name.toLowerCase()}`) === key);
      const numbered = !base.pc && (count > 1 || kin.length > 0);
      if (numbered) {
        for (const c of kin) if (!c.no) c.no = s.serials[key] = (s.serials[key] ?? 0) + 1;
      }
      const added = [];
      for (let i = 0; i < count; i++) {
        const c = {
          id: newId(), entityId: base.entityId, type: base.type, name: base.name, no: null,
          side, pc: base.pc, image: base.image,
          init: null, initBonus: base.initBonus,
          hp: base.hp, maxHp: base.hp, tempHp: 0, armor: base.armor,
          slots: structuredClone(base.slots), conditions: [], hidden: Boolean(action.hidden), out: false,
        };
        if (numbered) c.no = s.serials[key] = (s.serials[key] ?? 0) + 1;
        if (action.init != null) c.init = int(action.init, 'Initiative', { min: -20, max: 99 });
        // Joining a fight already under way: roll them in so they get a place in the order.
        else if (s.active && !c.pc) roll(c);
        added.push(c);
      }
      s.combatants.push(...added);
      if (added.some((c) => c.init != null)) s.combatants = sortOrder(s.combatants);
      break;
    }
    case 'remove': {
      const c = find(action.id);
      if (s.current === c.id) s.current = step(s.combatants, c.id, 1).id;
      s.combatants = s.combatants.filter((x) => x !== c);
      if (s.current === c.id || !s.combatants.length) s.current = null;
      break;
    }
    case 'update': {
      const c = find(action.id);
      const p = action.patch ?? {};
      if ('name' in p) c.name = text(p.name, 'Name', 60);
      if ('side' in p) {
        if (!SIDES.includes(p.side)) throw badRequest(`side must be one of ${SIDES.join(', ')}`);
        c.side = p.side;
      }
      if ('maxHp' in p) {
        c.maxHp = int(p.maxHp, 'Maximum hit points', { min: 1 });
        setHp(c, c.hp);
      }
      if ('hp' in p) setHp(c, int(p.hp, 'Hit points', { min: 0 }));
      if ('tempHp' in p) c.tempHp = int(p.tempHp, 'Temporary hit points', { min: 0 });
      if ('armor' in p) c.armor = p.armor == null ? null : int(p.armor, 'Armor', { min: 0, max: 99 });
      if ('initBonus' in p) c.initBonus = int(p.initBonus, 'Initiative bonus', { min: -20, max: 50 });
      if ('slots' in p) c.slots = cleanSlots(p.slots);
      if ('slotsText' in p) {
        // Re-typed pools keep what's been spent from pools of the same name.
        const spent = new Map(c.slots.map((x) => [x.label, x.used]));
        c.slots = parseSlots(p.slotsText).map((x) => ({ ...x, used: Math.min(spent.get(x.label) ?? 0, x.max) }));
      }
      if ('conditions' in p) c.conditions = cleanConditions(p.conditions);
      if ('hidden' in p) c.hidden = Boolean(p.hidden);
      if ('out' in p) c.out = Boolean(p.out);
      if ('init' in p) {
        c.init = p.init == null ? null : int(p.init, 'Initiative', { min: -20, max: 99 });
        s.combatants = sortOrder(s.combatants);
      }
      if (c.out && s.current === c.id) s.current = step(s.combatants, c.id, 1).id;
      break;
    }
    case 'hp': {
      // Damage eats temporary hit points first; healing never exceeds the maximum.
      const c = find(action.id);
      const delta = int(action.delta, 'Damage or healing', { min: -9999, max: 9999 });
      if (delta < 0) hurt(c, -delta);
      else setHp(c, c.hp + delta);
      if (c.out && s.current === c.id) s.current = step(s.combatants, c.id, 1).id;
      break;
    }
    case 'attack': {
      // One combatant attacks another: the damage lands like 'hp', and the attack is
      // remembered so the player screen can play it out (who, result, health before/after).
      if (!s.active) throw badRequest('Start combat first');
      const attacker = find(action.attackerId);
      const target = find(action.targetId);
      if (attacker === target) throw badRequest('Pick someone else to attack');
      const result = action.result ?? 'hit';
      if (!ATTACK_RESULTS.includes(result)) throw badRequest(`result must be one of ${ATTACK_RESULTS.join(', ')}`);
      const damage = result === 'miss' ? 0 : int(action.damage ?? 0, 'Damage', { min: 0, max: 9999 });
      const before = hpOf(target);
      if (damage) hurt(target, damage);
      s.attack = {
        seq: (s.attack?.seq ?? 0) + 1, at: now(), attackerId: attacker.id, targetId: target.id, result, damage,
        before, after: hpOf(target), down: target.hp === 0 && before.hp > 0,
      };
      if (target.out && s.current === target.id) s.current = step(s.combatants, target.id, 1).id;
      break;
    }
    case 'slot': {
      const c = find(action.id);
      const pool = c.slots[int(action.pool, 'Slot pool', { min: 0, max: c.slots.length - 1 })];
      pool.used = Math.max(0, Math.min(pool.max, pool.used + int(action.delta, 'Slot change', { min: -99, max: 99 })));
      break;
    }
    case 'condition': {
      const c = find(action.id);
      const name = text(action.name, 'A condition', 40);
      const others = c.conditions.filter((x) => x.name.toLowerCase() !== name.toLowerCase());
      if (action.remove) c.conditions = others;
      else c.conditions = cleanConditions([...others, { name, rounds: action.rounds ?? null }]);
      break;
    }
    case 'move': {
      // Manual reorder (ties, readied actions, delayed turns). Sorting again only happens on a new roll.
      const c = find(action.id);
      const to = int(action.to, 'Position', { min: 0, max: s.combatants.length - 1 });
      s.combatants = s.combatants.filter((x) => x !== c);
      s.combatants.splice(to, 0, c);
      break;
    }
    case 'roll': {
      // Everyone the GM rolls for: non-PCs without initiative (or everyone listed in ids).
      const ids = Array.isArray(action.ids) ? new Set(action.ids) : null;
      for (const c of s.combatants) if (ids ? ids.has(c.id) : !c.pc && c.init == null) roll(c);
      s.combatants = sortOrder(s.combatants);
      break;
    }
    case 'start': {
      if (!s.combatants.some(canAct)) throw badRequest('Add someone who can fight first');
      for (const c of s.combatants) if (!c.pc && c.init == null) roll(c);
      s.combatants = sortOrder(s.combatants);
      s.active = true;
      s.round = 1;
      s.current = step(s.combatants, null, 1).id;
      break;
    }
    case 'next':
    case 'prev': {
      if (!s.active) throw badRequest('Start combat first');
      const dir = action.action === 'next' ? 1 : -1;
      const { id, wrapped } = step(s.combatants, s.current, dir);
      if (!id) throw badRequest('Nobody is left standing');
      if (wrapped) s.round = Math.max(1, s.round + dir);
      s.current = id;
      if (dir > 0) startTurn(find(id));
      break;
    }
    case 'end': {
      // Combat over: the foes leave; player characters keep their wounds, slots and conditions.
      s.active = false;
      s.round = 0;
      s.current = null;
      s.serials = {};
      delete s.attack;
      s.combatants = s.combatants.filter((c) => c.pc).map((c) => ({ ...c, init: null, out: false, hidden: false }));
      break;
    }
    case 'rest': {
      // A long rest for the player characters: full hit points and slots, conditions cleared.
      for (const c of s.combatants) {
        if (!c.pc) continue;
        Object.assign(c, { hp: c.maxHp, tempHp: 0, out: false, conditions: [] });
        c.slots.forEach((p) => (p.used = 0));
      }
      break;
    }
    case 'clear':
      return { ...empty(), rev: s.rev + 1 };
    default:
      throw badRequest('Unknown tracker action');
  }
  s.rev += 1;
  return s;
}

/** What the players' turn bar shows: nothing hidden or defeated, and only coarse health for non-PCs. */
function playerView(state) {
  const s = state ?? empty();
  if (!s.active) return { active: false, round: 0, current: null, order: [] };
  const shown = s.combatants.filter((c) => !c.hidden && !c.out);
  // If the acting combatant is hidden, the bar points at whoever is up next.
  let current = null;
  const at = s.combatants.findIndex((c) => c.id === s.current);
  for (let k = 0; k < s.combatants.length && at !== -1; k++) {
    const c = s.combatants[(at + k) % s.combatants.length];
    if (!c.hidden && !c.out) {
      current = c.id;
      break;
    }
  }
  return {
    active: true,
    round: s.round,
    current,
    rev: s.rev,
    order: shown.map((c) => {
      const base = { id: c.id, name: c.name, no: c.no, side: c.side, pc: c.pc, image: c.image, conditions: c.conditions };
      if (c.pc) return { ...base, hp: c.hp, maxHp: c.maxHp, tempHp: c.tempHp, armor: c.armor, slots: c.slots };
      return { ...base, health: healthBand(c.hp, c.maxHp) };
    }),
    ...(s.attack ? { attack: attackView(s) } : {}),
  };
}

const healthBand = (hp, maxHp) => {
  const ratio = maxHp ? hp / maxHp : 0;
  return ratio >= 1 ? 'unhurt' : ratio > 0.5 ? 'wounded' : ratio > 0.25 ? 'bloodied' : ratio > 0 ? 'critical' : 'down';
};

/**
 * The last attack as players may see it, or undefined. A hidden target keeps the
 * attack off the screen; a hidden attacker shows as unknown. Non-PC health is a
 * bar position (to the nearest 5%) and a band, never numbers.
 */
function attackView(s) {
  const a = s.attack;
  const target = s.combatants.find((c) => c.id === a.targetId);
  if (!target || target.hidden) return undefined;
  const attacker = s.combatants.find((c) => c.id === a.attackerId);
  const who = (c) => ({ id: c.id, name: c.name, no: c.no, side: c.side, pc: c.pc, image: c.image });
  const health = (h) => {
    if (target.pc) return { ...h, ratio: h.maxHp ? h.hp / h.maxHp : 0 };
    return { ratio: h.maxHp ? Math.round((h.hp / h.maxHp) * 20) / 20 : 0, band: healthBand(h.hp, h.maxHp) };
  };
  return {
    seq: a.seq, at: a.at, result: a.result, damage: a.damage, down: a.down,
    attacker: attacker && !attacker.hidden ? who(attacker) : { unknown: true, name: 'Unknown attacker', side: attacker?.side ?? 'enemy' },
    target: { ...who(target), before: health(a.before), after: health(a.after) },
  };
}

module.exports = { SIDES, CONDITIONS, empty, act, playerView, parseSlots, sourceFrom, displayName };
