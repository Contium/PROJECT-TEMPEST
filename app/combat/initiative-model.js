// Initiative Tracker (Combat › Initiative): who is in the fight, in what order, whose
// turn it is, and each combatant's hit points, armor, ability slots and conditions.
// Shared by the browser and the server, which applies every action with act().
//
// Like the player screen's display this is table state, not campaign data: one
// encounter per project, in <project>/encounter.json, replaced by every action.
// Everything here is a pure function of (state, action) so it can be tested in Node.
//
// Encounter { format, version, active, round, current, die, screen, combatants: [Combatant], serials, rev, attack? }
//   die      the initiative die: d20, d10 (Cyberpunk RED's 1d10 + REF) …
//   screen   show the turn order on the player screens while combat is on (the GM can turn it off)
// Combatant {
//   id, entityId?, hpField?, name, no?      no = clone number ("Raider #2"); hpField = the sheet's HP field
//   side: pc | ally | neutral | enemy, pc, image?
//   init?, initBonus                        rolled/entered initiative and the bonus added to the die
//   hp, maxHp, tempHp, armor?
//   slots: [{ label, max, used }]           ability/spell slot pools
//   conditions: [{ name, rounds? }]         rounds tick down at the start of their turn
//   hidden                                  in the order, but not on the player screen
//   out                                     defeated: skipped in turn order, off the player screen
// }
// attack: the last attack ({ seq, at, attackerId, targetId, result, damage, before, after, down }),
// which the player screens play out for a few seconds.

export const INITIATIVE_FORMAT = 'tempest.encounter';
export const INITIATIVE_VERSION = 1;
export const SIDES = [
  { id: 'pc', label: 'PC' },
  { id: 'ally', label: 'Ally' },
  { id: 'neutral', label: 'Neutral' },
  { id: 'enemy', label: 'Enemy' },
];
const SIDE_IDS = SIDES.map((s) => s.id);
export const DICE = ['d20', 'd12', 'd10', 'd8', 'd6'];
// Suggestions only; any name works. Common table conditions across systems.
export const CONDITIONS = [
  'Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed',
  'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Exhaustion', 'Concentrating',
  'Seriously Wounded', 'Mortally Wounded', 'Bleeding', 'Burning', 'On Fire', 'Suppressed', 'Hacked', 'Blessed', 'Hasted',
];
const ATTACK_RESULTS = ['hit', 'crit', 'miss'];
export const MAX_COMBATANTS = 60;
export const MAX_CLONES = 20;

export class InitiativeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (message) => new InitiativeError(400, message);

export const empty = ({ die = 'd20' } = {}) => ({
  format: INITIATIVE_FORMAT, version: INITIATIVE_VERSION,
  active: false, round: 0, current: null, die: DICE.includes(die) ? die : 'd20', screen: true,
  combatants: [], serials: {}, rev: 0,
});

const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
const newId = () => `c_${hex(4)}`;
export const nameOf = (c) => (c.no ? `${c.name} #${c.no}` : c.name);
const ordinal = (n) => `${n}${[, 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10] || 'th'}`;
export const initials = (name) => String(name ?? '').split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w.replace(/\W/g, '')[0]).join('').toUpperCase() || '·';

const int = (v, label, { min = -999, max = 9999 } = {}) => {
  if (!Number.isInteger(v) || v < min || v > max) throw bad(`${label} must be a whole number from ${min} to ${max}`);
  return v;
};
const text = (v, label, max) => {
  if (typeof v !== 'string' || !v.trim()) throw bad(`${label} needs some text`);
  return v.trim().slice(0, max);
};

/**
 * "4 3 2" → 1st/2nd/3rd-level pools; "Ki 5, Rage 3" or "1st: 4; 2nd: 3" → named pools.
 * Returns [{ label, max, used: 0 }]; anything unreadable is skipped.
 */
export function parseSlots(input) {
  const s = String(input ?? '').trim();
  if (!s) return [];
  if (/^\d+(\s+\d+)*$/.test(s)) {
    return s.split(/\s+/).map((n, i) => ({ label: ordinal(i + 1), max: Math.min(Number(n), 99), used: 0 })).filter((p) => p.max > 0).slice(0, 12);
  }
  return s.split(/[,;\n]/).map((part, i) => {
    const m = part.trim().match(/^(.*?)[\s:=×x]*(\d+)$/);
    if (!m) return null;
    return { label: m[1].trim().slice(0, 24) || ordinal(i + 1), max: Math.min(Number(m[2]), 99), used: 0 };
  }).filter((p) => p && p.max > 0).slice(0, 12);
}
export const slotsText = (slots) => slots.map((p) => `${p.label} ${p.max}`).join(', ');

// What a sheet's numbers are called, whatever preset it came from: the first Stat field
// whose label starts like one of these.
const HP_LABEL = /^(hit points|hp|health|hit pts|integrity|vitality|wounds)\b/i;
const INIT_LABEL = /^(initiative|init)\b/i;
const REF_LABEL = /^(ref|reflexes)\b/i; // Cyberpunk RED: 1d10 + REF
const ARMOR_LABEL = /^(armor|armour|ac|armor class|armour class|sp|stopping power|defense|defence)\b/i;
const numberOf = (v) => (v && Number.isFinite(v.value) ? Math.round(v.value) : null);

/**
 * Combatant defaults from a character entity (any preset): its name and portrait,
 * player or not, and the Stat fields that look like hit points, initiative (or REF)
 * and armor. A player character joins as a PC; monsters and creatures as enemies.
 */
export function sourceFrom(entity) {
  const fields = Object.values(entity.sheet?.fields ?? {}).filter((f) => f.type === 'stat');
  const values = entity.values ?? {};
  const find = (re) => fields.find((f) => re.test(String(f.label ?? '').trim()) && numberOf(values[f.id]) != null);
  const hpField = find(HP_LABEL);
  const hpValue = hpField ? values[hpField.id] : null;
  const maxHp = hpValue ? Math.max(1, Math.round(Number.isFinite(hpValue.max) && hpValue.max > 0 ? hpValue.max : hpValue.value) || 1) : 10;
  const hp = hpValue ? Math.max(0, Math.min(maxHp, Math.round(hpValue.value))) : maxHp;
  const initField = find(INIT_LABEL) ?? find(REF_LABEL);
  const armorField = find(ARMOR_LABEL);
  const category = entity.category ?? values.category;
  const pc = category === 'player';
  const side = pc ? 'pc' : category === 'npc' ? 'neutral' : 'enemy';
  return {
    entityId: entity.id, hpField: hpField?.id ?? null,
    name: String(entity.name ?? values.name ?? 'Unknown').slice(0, 60), image: typeof values.image === 'string' ? values.image : null,
    pc, side, hp, maxHp,
    armor: armorField ? Math.max(0, Math.min(99, numberOf(values[armorField.id]))) : null,
    initBonus: initField ? Math.max(-20, Math.min(50, numberOf(values[initField.id]))) : 0,
    slots: [],
  };
}

/** Initiative order: highest first, then the higher bonus; ties keep their order. Unrolled last. */
export function sortOrder(list) {
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
  // Foes drop out at 0; player characters stay in the order (death saves).
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
  if (!Array.isArray(list)) throw bad('conditions must be a list');
  return list.slice(0, 20).map((x) => ({
    name: text(x?.name, 'A condition', 40),
    ...(x?.rounds == null ? {} : { rounds: int(x.rounds, 'Rounds', { min: 1, max: 999 }) }),
  }));
}

function cleanSlots(list) {
  if (!Array.isArray(list)) throw bad('slots must be a list');
  return list.slice(0, 12).map((p) => {
    const max = int(p?.max, 'Slot maximum', { min: 1, max: 99 });
    return { label: text(p?.label, 'A slot pool', 24), max, used: int(p?.used ?? 0, 'Slots used', { min: 0, max }) };
  });
}

/** A combatant as stored, checked; throws InitiativeError for what can't be read. */
function cleanCombatant(c) {
  const maxHp = int(c?.maxHp, 'Maximum hit points', { min: 1 });
  return {
    id: typeof c.id === 'string' && /^c_[0-9a-f]{8}$/.test(c.id) ? c.id : newId(),
    entityId: typeof c.entityId === 'string' ? c.entityId.slice(0, 64) : null,
    hpField: typeof c.hpField === 'string' ? c.hpField.slice(0, 64) : null,
    name: text(c.name, 'A combatant', 60),
    no: Number.isInteger(c.no) && c.no > 0 ? c.no : null,
    side: SIDE_IDS.includes(c.side) ? c.side : 'enemy',
    pc: c.pc === true,
    image: typeof c.image === 'string' ? c.image.slice(0, 64) : null,
    init: c.init == null ? null : int(c.init, 'Initiative', { min: -20, max: 99 }),
    initBonus: c.initBonus == null ? 0 : int(c.initBonus, 'Initiative bonus', { min: -20, max: 50 }),
    hp: Math.min(int(c.hp ?? maxHp, 'Hit points', { min: 0 }), maxHp), maxHp,
    tempHp: int(c.tempHp ?? 0, 'Temporary hit points', { min: 0 }),
    armor: c.armor == null ? null : int(c.armor, 'Armor', { min: 0, max: 99 }),
    slots: cleanSlots(c.slots ?? []),
    conditions: cleanConditions(c.conditions ?? []),
    hidden: c.hidden === true,
    out: c.out === true,
  };
}

/** A saved encounter, checked and tidied. Anything unreadable starts over empty. */
export function normalizeEncounter(input, defaults = {}) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.combatants)) return empty(defaults);
  try {
    const combatants = input.combatants.slice(0, MAX_COMBATANTS).map(cleanCombatant);
    const ids = new Set(combatants.map((c) => c.id));
    const active = input.active === true && combatants.length > 0;
    return {
      ...empty(defaults),
      active,
      round: active ? Math.max(1, Number.isInteger(input.round) ? input.round : 1) : 0,
      current: active && ids.has(input.current) ? input.current : active ? step(combatants, null, 1).id : null,
      die: DICE.includes(input.die) ? input.die : empty(defaults).die,
      screen: input.screen !== false,
      combatants,
      serials: input.serials && typeof input.serials === 'object' ? Object.fromEntries(Object.entries(input.serials).filter(([, n]) => Number.isInteger(n) && n > 0)) : {},
      rev: Number.isInteger(input.rev) && input.rev >= 0 ? input.rev : 0,
      ...(active && input.attack && ids.has(input.attack.targetId) ? { attack: input.attack } : {}),
    };
  } catch {
    return empty(defaults);
  }
}

/**
 * Apply one tracker action; returns the new state (the input is not modified).
 * `source` is sourceFrom(entity) when the action adds an entity (the server reads it).
 */
export function act(prev, action = {}, { source = null, rng = Math.random, now = Date.now } = {}) {
  const s = structuredClone(prev ?? empty());
  const find = (id) => {
    const c = s.combatants.find((x) => x.id === id);
    if (!c) throw new InitiativeError(404, 'That combatant has left the fight');
    return c;
  };
  const sides = Number(s.die.slice(1)) || 20;
  const roll = (c) => (c.init = Math.max(-20, Math.min(99, 1 + Math.floor(rng() * sides) + c.initBonus)));

  switch (action.action) {
    case 'add': {
      const count = action.count == null ? 1 : int(action.count, 'Count', { min: 1, max: MAX_CLONES });
      const base = source ?? {
        entityId: null, hpField: null, name: text(action.name, 'A combatant', 60), image: null, pc: false, side: 'enemy',
        hp: action.hp == null ? 10 : int(action.hp, 'Hit points', { min: 1 }),
        armor: action.armor == null ? null : int(action.armor, 'Armor', { min: 0, max: 99 }),
        initBonus: action.initBonus == null ? 0 : int(action.initBonus, 'Initiative bonus', { min: -20, max: 50 }),
        slots: [],
      };
      if (base.maxHp == null) base.maxHp = base.hp;
      if (base.pc && s.combatants.some((c) => c.entityId === base.entityId)) throw new InitiativeError(409, `${base.name} is already in the fight`);
      if (s.combatants.length + count > MAX_COMBATANTS) throw bad(`A fight holds at most ${MAX_COMBATANTS} combatants`);
      const side = action.side ?? base.side;
      if (!SIDE_IDS.includes(side)) throw bad(`side must be one of ${SIDE_IDS.join(', ')}`);

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
          id: newId(), entityId: base.entityId, hpField: base.hpField ?? null, name: base.name, no: null,
          side, pc: base.pc, image: base.image,
          init: null, initBonus: base.initBonus,
          hp: base.hp, maxHp: base.maxHp, tempHp: 0, armor: base.armor,
          slots: structuredClone(base.slots), conditions: [], hidden: Boolean(action.hidden), out: false,
        };
        if (!c.pc) c.out = c.hp === 0;
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
      if (s.attack && (s.attack.targetId === c.id || s.attack.attackerId === c.id)) delete s.attack;
      break;
    }
    case 'update': {
      const c = find(action.id);
      const p = action.patch ?? {};
      if ('name' in p) c.name = text(p.name, 'Name', 60);
      if ('side' in p) {
        if (!SIDE_IDS.includes(p.side)) throw bad(`side must be one of ${SIDE_IDS.join(', ')}`);
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
      // remembered so the player screens can play it out (who, result, health before/after).
      if (!s.active) throw bad('Start combat first');
      const attacker = find(action.attackerId);
      const target = find(action.targetId);
      if (attacker === target) throw bad('Pick someone else to attack');
      const result = action.result ?? 'hit';
      if (!ATTACK_RESULTS.includes(result)) throw bad(`result must be one of ${ATTACK_RESULTS.join(', ')}`);
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
      if (!c.slots.length) throw bad('No slot pools to spend');
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
    case 'settings': {
      if ('die' in action) {
        if (!DICE.includes(action.die)) throw bad(`die must be one of ${DICE.join(', ')}`);
        s.die = action.die;
      }
      if ('screen' in action) s.screen = action.screen !== false;
      break;
    }
    case 'start': {
      if (!s.combatants.some(canAct)) throw bad('Add someone who can fight first');
      for (const c of s.combatants) if (!c.pc && c.init == null) roll(c);
      s.combatants = sortOrder(s.combatants);
      s.active = true;
      s.round = 1;
      s.current = step(s.combatants, null, 1).id;
      delete s.attack;
      break;
    }
    case 'next':
    case 'prev': {
      if (!s.active) throw bad('Start combat first');
      const dir = action.action === 'next' ? 1 : -1;
      const { id, wrapped } = step(s.combatants, s.current, dir);
      if (!id) throw bad('Nobody is left standing');
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
      // A full rest for the player characters: full hit points and slots, conditions cleared.
      for (const c of s.combatants) {
        if (!c.pc) continue;
        Object.assign(c, { hp: c.maxHp, tempHp: 0, out: false, conditions: [] });
        c.slots.forEach((p) => (p.used = 0));
      }
      break;
    }
    case 'clear':
      return { ...empty({ die: s.die }), screen: s.screen, rev: s.rev + 1 };
    default:
      throw bad('Unknown tracker action');
  }
  s.rev += 1;
  return s;
}

export const healthBand = (hp, maxHp) => {
  const ratio = maxHp ? hp / maxHp : 0;
  return ratio >= 1 ? 'unhurt' : ratio > 0.5 ? 'wounded' : ratio > 0.25 ? 'bloodied' : ratio > 0 ? 'critical' : 'down';
};

/**
 * What the players' turn bar shows: nothing while combat is off (or the GM keeps it
 * off the screens), nothing hidden or defeated, and only coarse health for non-PCs.
 */
export function playerView(state) {
  const s = state ?? empty();
  if (!s.active || s.screen === false) return { active: false, round: 0, current: null, order: [] };
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
  const attack = s.attack ? attackView(s) : undefined;
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
    ...(attack ? { attack } : {}),
  };
}

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

/** Player characters whose hit points can be written back to their sheets: [{ entityId, hpField, hp }]. */
export const sheetUpdates = (state) => (state?.combatants ?? [])
  .filter((c) => c.pc && c.entityId && c.hpField)
  .map((c) => ({ entityId: c.entityId, hpField: c.hpField, hp: c.hp }));
