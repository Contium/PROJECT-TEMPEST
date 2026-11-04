// Client mirror of world/time.js formatting, plus <input> conversions.
// Game time is integer minutes since the universe calendar's epoch (negative = before it).

const DAY = 1440;
const pad = (n, len = 2) => String(n).padStart(len, '0');
const floorDiv = (a, b) => Math.floor(a / b);
const mod = (a, b) => ((a % b) + b) % b;

function epochMs(calendar) {
  return Date.parse(`${calendar.epoch}Z`);
}

function clockPart(minutes) {
  const rem = mod(minutes, DAY);
  return `${pad(floorDiv(rem, 60))}:${pad(rem % 60)}`;
}

function gregorianParts(minutes, calendar) {
  const d = new Date(epochMs(calendar) + minutes * 60_000);
  const y = d.getUTCFullYear();
  return {
    date: `${y < 0 ? `-${pad(-y, 4)}` : pad(y, 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

function yearsParts(minutes, calendar) {
  const days = floorDiv(minutes, DAY);
  const dpy = calendar.daysPerYear || 365;
  const year = (calendar.epochYear ?? 1) + floorDiv(days, dpy);
  return { year, day: mod(days, dpy) + 1, suffix: calendar.suffix ? ` ${calendar.suffix}` : '' };
}

export function formatGameTime(minutes, calendar) {
  if (minutes == null) return '—';
  if (calendar?.type === 'gregorian') {
    const { date, time } = gregorianParts(minutes, calendar);
    return `${date} ${time}`;
  }
  if (calendar?.type === 'years') {
    const { year, day, suffix } = yearsParts(minutes, calendar);
    return `${year}${suffix} · Day ${day}, ${clockPart(minutes)}`;
  }
  return `Day ${floorDiv(minutes, DAY) + 1}, ${clockPart(minutes)}`;
}

/** "14:30" part only. */
export function formatClockTime(minutes) {
  return clockPart(minutes);
}

/** Date part only: "2045-08-03" / "1492 DR · Day 34" / "Day 3". */
export function formatGameDate(minutes, calendar) {
  if (calendar?.type === 'gregorian') return gregorianParts(minutes, calendar).date;
  if (calendar?.type === 'years') {
    const { year, day, suffix } = yearsParts(minutes, calendar);
    return `${year}${suffix} · Day ${day}`;
  }
  return `Day ${floorDiv(minutes, DAY) + 1}`;
}

/** Short date for narrow columns: "08-03" / "D34" / "Day 3". */
export function formatShortDate(minutes, calendar) {
  if (calendar?.type === 'gregorian') return gregorianParts(minutes, calendar).date.slice(-5);
  if (calendar?.type === 'years') return `D${yearsParts(minutes, calendar).day}`;
  return `Day ${floorDiv(minutes, DAY) + 1}`;
}

/** Input element config for editing a game time in this calendar. */
export function gameTimeInput(calendar) {
  if (calendar?.type === 'gregorian') return { type: 'datetime-local', placeholder: '' };
  if (calendar?.type === 'years') return { type: 'text', placeholder: `${calendar.epochYear ?? 1} ${calendar.suffix ?? ''} · Day 1, 00:00`.replace(/\s+·/, ' ·') };
  return { type: 'text', placeholder: 'Day 3, 14:00' };
}

export function toInputValue(minutes, calendar) {
  if (minutes == null) return '';
  if (calendar?.type === 'gregorian') {
    const { date, time } = gregorianParts(minutes, calendar);
    return date.startsWith('-') ? '' : `${date}T${time}`; // datetime-local can't show BCE
  }
  return formatGameTime(minutes, calendar);
}

/** Parse an input value back to minutes; null for empty; throws on nonsense. */
export function fromInputValue(value, calendar) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (calendar?.type === 'gregorian') {
    const ms = Date.parse(`${text}Z`);
    if (Number.isNaN(ms)) throw new Error(`"${text}" is not a date`);
    return Math.round((ms - epochMs(calendar)) / 60_000);
  }
  if (calendar?.type === 'years') {
    const m = text.match(/^(-?\d+)\D+?(\d+)(?:\D+(\d{1,2}):(\d{2}))?$/);
    if (!m) throw new Error(`Write game times like "${calendar.epochYear ?? 1} · Day 34, 14:00"`);
    const dpy = calendar.daysPerYear || 365;
    const days = (Number(m[1]) - (calendar.epochYear ?? 1)) * dpy + Number(m[2]) - 1;
    return days * DAY + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
  }
  const m = text.match(/^(?:day\s*)?(-?\d+)\s*(?:[, ]\s*(\d{1,2}):(\d{2}))?$/i);
  if (!m) throw new Error('Write game times like "Day 3, 14:00"');
  return (Number(m[1]) - 1) * DAY + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}
