// The Timeline (World › Timeline): everything dated in the campaign, in order. Pure data +
// functions, shared by the GM's page, the server (the players' copy for a push) and tests.
//
// What's on it:
//   stories, rumors, events   from Start to End (no End: still going on)
//   factions                  their Founded date
// Dates are TEMPEST's in-world dates ({ y, m?, d?, time? }, any calendar: years may be
// negative, months and days run as high as the GM's calendar does), so the order is by
// year, then month, then day, then time; the spacing is by entry, not by calendar length.
//
// Spans (a start with a different end, or still going on) get a lane: a rail beside the
// timeline that runs from their start to their end, so overlapping stretches read side by side.

export const MAX_LANES = 6;

/** What each kind contributes, and how it's labelled. */
export const TRACKS = [
  { id: 'event', label: 'Events', kind: 'stories', category: 'event' },
  { id: 'story', label: 'Stories', kind: 'stories', category: 'story' },
  { id: 'rumor', label: 'Rumors', kind: 'stories', category: 'rumor' },
  { id: 'faction', label: 'Factions', kind: 'factions' },
];
export const trackOf = (e) => (e.kind === 'factions' ? 'faction' : e.kind === 'stories' ? e.category : null);

const n = (v) => (Number.isFinite(v) ? v : null);
/** -1, 0 or 1: a before b. Missing months/days sort before set ones (a year alone is "sometime that year"). */
export function compareDates(a, b) {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  for (const k of ['y', 'm', 'd']) {
    const x = n(a[k]) ?? -Infinity;
    const y = n(b[k]) ?? -Infinity;
    if (x !== y) return x < y ? -1 : 1;
  }
  return String(a.time ?? '').localeCompare(String(b.time ?? ''));
}
const sameDate = (a, b) => compareDates(a, b) === 0;

/**
 * Timeline entries from the project's entry summaries (GET /entities): those with a date.
 * Each: { id, kind, track, category, name, image, summary, start, end, ongoing, span }.
 *   span     it runs over time (a different end, or still going on): it gets a lane
 *   ongoing  a story with no end yet
 */
export function timelineEntries(summaries, { tracks = TRACKS.map((t) => t.id) } = {}) {
  const out = [];
  for (const e of summaries) {
    const track = trackOf(e);
    if (!track || !tracks.includes(track)) continue;
    const start = e.kind === 'factions' ? e.founded : e.start;
    if (!start || !Number.isFinite(start.y)) continue;
    const end = e.kind === 'stories' && e.end && Number.isFinite(e.end.y) ? e.end : null;
    const ongoing = e.kind === 'stories' && !end;
    const span = ongoing || (end && !sameDate(start, end) && compareDates(start, end) < 0);
    out.push({ id: e.id, kind: e.kind, track, category: e.category, name: e.name ?? null, image: e.image ?? null, summary: e.summary ?? '', start, end, ongoing, span: Boolean(span) });
  }
  return out.sort((a, b) => compareDates(a.start, b.start) || (a.name ?? '').localeCompare(b.name ?? ''));
}

/**
 * Rows to draw, in order, grouped by year: [{ year, rows: [{ entry, lanes: [laneState] }] }].
 * Each span gets a lane (up to MAX_LANES, reused once free); laneState per row is null (empty),
 * { id, track, at: 'start' | 'through' | 'end' | 'only' } for the span occupying it ('only': it
 * starts and ends before the next row).
 */
export function layout(entries) {
  const lanes = []; // lane -> span entry occupying it (until its end), or null
  const laneOf = new Map();
  const rows = entries.map((entry, i) => {
    // Free the lanes of spans that ended before this row.
    for (let l = 0; l < lanes.length; l++) {
      const s = lanes[l];
      if (s && s.end && compareDates(s.end, entry.start) < 0) lanes[l] = null;
    }
    if (entry.span) {
      let l = lanes.indexOf(null);
      if (l === -1 && lanes.length < MAX_LANES) l = lanes.push(null) - 1;
      if (l !== -1) {
        lanes[l] = entry;
        laneOf.set(entry.id, l);
      }
    }
    // What each lane shows on this row.
    // A span is 'end'ing on the last row that starts before (or as) it ends; one that's over
    // before the next row starts is 'only' its own row.
    const lastRow = (s) => s.end && !entries.slice(i + 1).some((x) => compareDates(x.start, s.end) <= 0);
    const state = lanes.map((s) => {
      if (!s) return null;
      if (s === entry) return { id: s.id, track: s.track, at: lastRow(s) ? 'only' : 'start' };
      return { id: s.id, track: s.track, at: lastRow(s) ? 'end' : 'through' };
    });
    return { entry, lanes: state, lane: laneOf.get(entry.id) ?? null };
  });
  const width = Math.max(0, ...rows.map((r) => r.lanes.length));
  for (const r of rows) while (r.lanes.length < width) r.lanes.push(null);
  const years = [];
  for (const r of rows) {
    const y = r.entry.start.y;
    if (!years.length || years.at(-1).year !== y) years.push({ year: y, rows: [] });
    years.at(-1).rows.push(r);
  }
  return { years, lanes: width };
}

/**
 * The players' copy of the timeline: only entries in their Codex (known), with a date their
 * sheet lets them read, each named and pictured only as its sheet allows.
 * `entities` are full entries (sheet + values); `rosterEntry` is push-model's (name, image, summary as allowed).
 */
export function playerTimeline(entities, rosterEntry) {
  const summaries = [];
  for (const e of entities) {
    if (!e.known) continue;
    const dateField = e.kind === 'factions' ? 'founded' : 'start';
    if (e.sheet?.fields?.[dateField]?.visibility !== 'revealed') continue;
    const card = rosterEntry(e);
    const endShown = e.kind === 'stories' && e.sheet?.fields?.end?.visibility === 'revealed';
    const typeShown = e.sheet?.fields?.category?.visibility === 'revealed';
    summaries.push({
      id: e.id, kind: e.kind, category: typeShown ? e.category : e.kind === 'factions' ? 'other' : 'event',
      name: card.name, image: card.image, summary: card.summary,
      start: e.values?.[dateField] ?? null,
      // An end players may not read shows as a single moment, so the timeline implies nothing about it.
      end: e.kind === 'stories' ? (endShown ? e.values?.end ?? null : e.values?.start ?? null) : null,
      founded: e.kind === 'factions' ? e.values?.founded ?? null : null,
    });
  }
  return timelineEntries(summaries);
}
