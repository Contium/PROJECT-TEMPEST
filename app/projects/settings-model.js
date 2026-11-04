// Project settings: the per-project choices that shape everything else (money,
// maps). Pure data + functions, shared by the settings page and the server,
// which checks every save with normalizeSettings().
//
// Settings {
//   money: { mode: 'dnd' | 'single' | 'custom', single: { name, symbol, position }, custom: [Currency…] },
//   maps:  { mode: null | 'planar' | 'planetary' | 'cartographer' | 'galactic',
//            nightCity: { enabled, revealed } }   the unique Night City POI (Planetary/Galactic only)
// }
// Currency { id, name, symbol, value }: value is how many of the base currency
// (the first one, value 1) it's worth. Amounts are stored in base units, so
// 250 copper shows as "2 gp 5 sp" in D&D style.
// Each mode keeps its own setup, so switching modes and back loses nothing.

export const MONEY_MODES = [
  { id: 'dnd', label: 'D&D style', hint: 'Copper, Silver, Electrum, Gold and Platinum, at the usual rates' },
  { id: 'single', label: 'Single currency', hint: 'One currency with your own name and symbol, e.g. the Eurodollar (§)' },
  { id: 'custom', label: 'Other', hint: 'Up to six currencies of your own, with their conversion rates' },
];

/** The five coins, worth 1 / 10 / 50 / 100 / 1000 copper. */
export const DND_COINS = [
  { id: 'cp', name: 'Copper', symbol: 'cp', value: 1 },
  { id: 'sp', name: 'Silver', symbol: 'sp', value: 10 },
  { id: 'ep', name: 'Electrum', symbol: 'ep', value: 50 },
  { id: 'gp', name: 'Gold', symbol: 'gp', value: 100 },
  { id: 'pp', name: 'Platinum', symbol: 'pp', value: 1000 },
];

export const MAP_MODES = [
  { id: 'planar', label: 'Planar', hint: 'Planes and realms, and the ways between them' },
  { id: 'planetary', label: 'Planetary', hint: 'Whole worlds on a 3D globe; adds the World View section', ready: true },
  { id: 'cartographer', label: 'Cartographer', hint: 'Hand-drawn maps of lands, cities and dungeons' },
  { id: 'galactic', label: 'Galactic', hint: 'Star systems, sectors and the lanes between them' },
];

/** Map systems that can carry the unique Night City POI. */
export const UNIQUE_POI_MODES = ['planetary', 'galactic'];

export const MAX_CURRENCIES = 6;
const MAX_VALUE = 1e9;

const DEFAULT_CUSTOM = [
  { id: 'c1', name: 'Bit', symbol: 'b', value: 1 },
  { id: 'c2', name: 'Crown', symbol: 'cr', value: 100 },
];

export function defaultSettings() {
  return {
    money: { mode: 'dnd', single: { name: 'Gold', symbol: 'gp', position: 'after' }, custom: structuredClone(DEFAULT_CUSTOM) },
    maps: { mode: null, nightCity: { enabled: true, revealed: true } },
  };
}

export class SettingsError extends Error {
  constructor(problems) {
    super(problems.length === 1 ? problems[0] : `These settings have ${problems.length} problems: ${problems.join('; ')}`);
    this.problems = problems;
  }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const oneOf = (v, list, fallback) => (list.some((x) => x.id === v) ? v : fallback);

/** Check and tidy settings; anything missing takes its default. Throws SettingsError for what can't be repaired. */
export function normalizeSettings(input) {
  const base = defaultSettings();
  if (input == null) return base;
  if (!isObj(input)) throw new SettingsError(['Settings must be an object']);
  const problems = [];
  const money = isObj(input.money) ? input.money : {};
  const single = isObj(money.single) ? money.single : {};

  const custom = [];
  const seen = new Set();
  for (const [i, c] of (Array.isArray(money.custom) ? money.custom : base.money.custom).slice(0, MAX_CURRENCIES).entries()) {
    const name = text(c?.name, 30);
    if (!name) {
      problems.push(`Currency ${i + 1} needs a name`);
      continue;
    }
    // The first currency is the base everything else is measured in.
    const value = i === 0 ? 1 : Number(c?.value);
    if (!(Number.isFinite(value) && value > 0 && value <= MAX_VALUE)) {
      problems.push(`${name} needs a value above 0 (how many ${custom[0]?.name ?? 'base'} it's worth)`);
      continue;
    }
    let id = /^[a-z0-9_]{1,16}$/.test(c?.id ?? '') ? c.id : `c${i + 1}`;
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    custom.push({ id, name, symbol: text(c?.symbol, 6), value });
  }
  if (!custom.length) problems.push('Other currencies need at least one currency');
  if (problems.length) throw new SettingsError(problems);

  return {
    money: {
      mode: oneOf(money.mode, MONEY_MODES, base.money.mode),
      single: {
        name: text(single.name, 30) || base.money.single.name,
        symbol: text(single.symbol, 6),
        position: single.position === 'before' ? 'before' : 'after',
      },
      custom,
    },
    maps: {
      mode: MAP_MODES.some((m) => m.id === input.maps?.mode) ? input.maps.mode : null,
      nightCity: {
        enabled: input.maps?.nightCity?.enabled !== false,
        revealed: input.maps?.nightCity?.revealed !== false,
      },
    },
  };
}

/** The currencies in use, smallest first: [{ id, name, symbol, value }]. */
export function currencies(settings) {
  const s = normalizeSettings(settings);
  if (s.money.mode === 'dnd') return DND_COINS;
  if (s.money.mode === 'single') return [{ id: 'single', name: s.money.single.name, symbol: s.money.single.symbol, value: 1 }];
  return [...s.money.custom].sort((a, b) => a.value - b.value);
}

/**
 * Show an amount (in base units) in the project's money. Single currency:
 * "§ 1,250" or "1,250 §". Several currencies: broken into coins, largest first,
 * skipping the empty ones ("2 gp 5 sp"). Electrum is skipped when breaking
 * D&D amounts down, as most tables do; it still counts in conversions.
 */
export function formatAmount(amount, settings) {
  const s = normalizeSettings(settings);
  const n = Number(amount) || 0;
  if (s.money.mode === 'single') {
    const { symbol, position, name } = s.money.single;
    const num = n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (!symbol) return `${num} ${name}`;
    return position === 'before' ? `${symbol} ${num}` : `${num} ${symbol}`;
  }
  const coins = currencies(s).filter((c) => !(s.money.mode === 'dnd' && c.id === 'ep')).reverse();
  const sign = n < 0 ? '-' : '';
  let left = Math.abs(Math.round(n));
  const parts = [];
  for (const c of coins) {
    const count = Math.floor(left / c.value);
    if (count) parts.push(`${count.toLocaleString()} ${c.symbol || c.name}`);
    left -= count * c.value;
  }
  return parts.length ? sign + parts.join(' ') : `0 ${coins.at(-1).symbol || coins.at(-1).name}`;
}

/** How one currency converts into another: "1 Gold = 100 Copper". */
export const rate = (from, to) => from.value / to.value;
