// Draws a timeline (timeline-model.js) the same way for the GM's page and the player screen:
// a year heading, then each entry on the spine with its date, and beside it the lanes: the
// rails of the stretches of time still going on at that point, each in its track's colour.

import { el } from '../ui.js';
import { formatDate } from '../forge/preset-model.js';
import { layout, TRACKS } from './timeline-model.js';

const TRACK_LABEL = { event: 'Event', story: 'Story', rumor: 'Rumor', faction: 'Faction' };
const initials = (name) => String(name ?? '?').split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w.replace(/\W/g, '')[0]).join('').toUpperCase() || '?';

/** Beside the spine, under its year's heading: "03-02 21:30", or "—" for a year alone. */
const two = (v) => String(v).padStart(2, '0');
function shortDate(d) {
  const md = [d.m ? two(d.m) : null, d.d ? two(d.d) : null].filter(Boolean).join('-');
  return [md, d.time].filter(Boolean).join(' ') || '—';
}

/** When it happened, as one line: "March 2, 2045 – March 9, 2045", "since …", "founded …". */
export function whenText(e) {
  if (e.kind === 'factions') return `Founded ${formatDate(e.start)}`;
  if (e.ongoing) return `${formatDate(e.start)} – ongoing`;
  if (e.end && e.span) return `${formatDate(e.start)} – ${formatDate(e.end)}`;
  return formatDate(e.start);
}

/**
 * renderTimeline(entries, { href?, imageUrl?, empty? })
 *   href      (entry) → link to its page (GM) or null
 *   imageUrl  (assetId) → URL for thumbnails
 */
export function renderTimeline(entries, { href = null, imageUrl = null, empty = 'Nothing dated yet.' } = {}) {
  if (!entries.length) return el('div', { class: 'tl tl--empty' }, el('p', { class: 'tp-muted' }, empty));
  const { years, lanes } = layout(entries);
  return el('div', { class: 'tl', style: `--lanes:${lanes}` },
    years.map((y) => el('section', { class: 'tl__year' },
      el('h2', { class: 'tl__year-label tp-display' }, String(y.year)),
      el('ol', { class: 'tl__rows' }, y.rows.map((r) => {
        const e = r.entry;
        const link = href?.(e);
        const name = e.name ?? 'Unknown';
        return el('li', { class: `tl__row tl__row--${e.track}`, 'data-id': e.id },
          el('span', { class: 'tl__lanes', 'aria-hidden': 'true' },
            r.lanes.map((s) => el('i', { class: s ? `tl__lane tl__lane--${s.track} is-${s.at}` : 'tl__lane is-free' }))),
          el('span', { class: 'tl__when tp-mono' }, shortDate(e.start)),
          el('span', { class: `tl__dot tl__dot--${e.track}`, 'aria-hidden': 'true' }),
          el(link ? 'a' : 'div', { class: `tl__card tp-frame ${e.span ? 'is-span' : ''}`, href: link || null },
            e.image && imageUrl ? el('img', { class: 'tl__thumb', src: imageUrl(e.image), alt: '', loading: 'lazy' }) : el('span', { class: 'tl__thumb tl__thumb--sigil', 'aria-hidden': 'true' }, initials(name)),
            el('span', { class: 'tl__text' },
              el('span', { class: 'tl__meta' }, el('span', { class: `tl__type tl__type--${e.track}` }, TRACK_LABEL[e.track] ?? ''), el('span', { class: 'tp-dim tp-mono tl__range' }, whenText(e))),
              el('span', { class: `tl__name ${e.name ? '' : 'is-unknown'}` }, name),
              e.summary ? el('span', { class: 'tl__summary' }, e.summary) : null)));
      })))));
}

/** The legend: a chip per track, each toggling it (GM page) or just labelling (player screen). */
export function trackChips(on, toggle) {
  return el('div', { class: 'tl-chips', role: 'group', 'aria-label': 'Show on the timeline' },
    TRACKS.map((t) => el('button', {
      type: 'button', class: `tl-chip tl-chip--${t.id} ${on.includes(t.id) ? 'is-on' : ''}`, 'aria-pressed': String(on.includes(t.id)),
      onClick: toggle ? () => toggle(t.id) : null, disabled: !toggle,
    }, el('i', { 'aria-hidden': 'true' }), t.label)));
}
