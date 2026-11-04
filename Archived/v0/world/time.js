// In-game time. Stored everywhere as integer minutes since the universe's
// calendar epoch (negative = before it), so ordering and arithmetic never
// depend on the calendar. Keep in sync with app/time.js.

const MINUTE = 1;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const UNITS = { m: MINUTE, min: MINUTE, h: HOUR, hr: HOUR, d: DAY, day: DAY, w: WEEK, wk: WEEK, y: 365 * DAY, yr: 365 * DAY };

/**
 * Calendars:
 *   { type: 'gregorian', epoch: '2045-08-01T00:00' }               real dates (modern / future settings)
 *   { type: 'years', epochYear: 1492, daysPerYear: 365, suffix: 'DR' }  "1492 DR · Day 34, 14:00" (fantasy / sci-fi)
 *   { type: 'days' }                                                "Day 12, 14:30" (simple homebrew)
 */
const DEFAULT_CALENDAR = { type: 'days' };

const pad = (n, len = 2) => String(n).padStart(len, '0');
const floorDiv = (a, b) => Math.floor(a / b);
const mod = (a, b) => ((a % b) + b) % b;

function clockPart(minutes) {
  const rem = mod(minutes, DAY);
  return `${pad(floorDiv(rem, HOUR))}:${pad(rem % HOUR)}`;
}

function formatGameTime(minutes, calendar = DEFAULT_CALENDAR) {
  if (calendar.type === 'gregorian') {
    const d = new Date(Date.parse(`${calendar.epoch}Z`) + minutes * 60_000);
    const y = d.getUTCFullYear();
    const year = y < 0 ? `-${pad(-y, 4)}` : pad(y, 4);
    return `${year}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
  if (calendar.type === 'years') {
    const days = floorDiv(minutes, DAY);
    const dpy = calendar.daysPerYear || 365;
    const year = (calendar.epochYear ?? 1) + floorDiv(days, dpy);
    const suffix = calendar.suffix ? ` ${calendar.suffix}` : '';
    return `${year}${suffix} · Day ${mod(days, dpy) + 1}, ${clockPart(minutes)}`;
  }
  return `Day ${floorDiv(minutes, DAY) + 1}, ${clockPart(minutes)}`;
}

/** "1d 6h", "90m", "2w", "-3y" → minutes. Plain numbers are minutes. */
function parseDuration(input) {
  if (typeof input === 'number') return Math.trunc(input);
  const parts = String(input).trim().toLowerCase().match(/-?\d+\s*[a-z]*/g);
  if (!parts) throw new Error(`Unreadable duration "${input}"`);
  return parts.reduce((total, part) => {
    const [, num, unit] = part.match(/(-?\d+)\s*([a-z]*)/);
    const factor = unit ? UNITS[unit] ?? UNITS[unit.replace(/s$/, '')] : MINUTE;
    if (!factor) throw new Error(`Unknown time unit "${unit}"`);
    return total + Number(num) * factor;
  }, 0);
}

function validateCalendar(calendar) {
  if (!calendar || typeof calendar !== 'object') return 'calendar must be an object';
  if (calendar.type === 'days') return null;
  if (calendar.type === 'gregorian') {
    return Number.isNaN(Date.parse(`${calendar.epoch}Z`)) ? 'gregorian calendar needs an ISO epoch like 2045-08-01T00:00' : null;
  }
  if (calendar.type === 'years') {
    if (!Number.isInteger(calendar.epochYear)) return 'years calendar needs a whole-number epochYear';
    if (calendar.daysPerYear != null && !(Number.isInteger(calendar.daysPerYear) && calendar.daysPerYear > 0)) return 'daysPerYear must be a positive whole number';
    if (calendar.suffix != null && typeof calendar.suffix !== 'string') return 'suffix must be text';
    return null;
  }
  return `unknown calendar type "${calendar.type}"`;
}

module.exports = { MINUTE, HOUR, DAY, WEEK, DEFAULT_CALENDAR, formatGameTime, parseDuration, validateCalendar };
