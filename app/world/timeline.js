// World › Timeline: everything dated in the campaign, in order (timeline-model.js).
//
// Stories, rumors and events run from their Start to their End (no End: still going on, a
// rail to the bottom); factions sit at their Founded date. Chips choose what's shown
// (remembered per project). Player view previews what the players get, the same as
// ⇪ Push sends: only what's in their Codex, dated and named as each sheet allows.

import { el, store, toastError } from '../ui.js';
import { allEntities, imageUrl, currentProjectId, playerTimeline } from '../api.js';
import { hrefOf } from '../forge/entity-model.js';
import { push, pushButton } from '../push/push.js';
import { timelineEntries, TRACKS } from './timeline-model.js';
import { renderTimeline, trackChips } from './timeline-render.js';

const TRACKS_KEY = () => `tempest.${currentProjectId()}.timeline.tracks`;

export async function mount(root) {
  let view = 'gm';
  let tracks;
  try {
    tracks = JSON.parse(store.get(TRACKS_KEY()) ?? 'null');
  } catch {
    tracks = null;
  }
  if (!Array.isArray(tracks)) tracks = TRACKS.map((t) => t.id);
  let everything = await allEntities().catch((err) => (toastError(err), []));
  let players = null; // the players' copy, fetched when Player view opens

  async function draw() {
    const seg = el('span', { class: 'fd-seg', role: 'group', 'aria-label': 'View as' },
      [['gm', 'GM view'], ['player', 'Player view']].map(([v, label]) =>
        el('button', { type: 'button', class: `fd-seg__btn ${view === v ? 'is-on' : ''}`, 'aria-pressed': String(view === v), onClick: () => ((view = v), (players = null), draw()) }, label)));
    let entries;
    if (view === 'player') {
      players ??= await playerTimeline().catch((err) => (toastError(err), []));
      entries = players.filter((e) => tracks.includes(e.track));
    } else entries = timelineEntries(everything, { tracks });
    const undated = view === 'gm' ? everything.filter((e) => (e.kind === 'stories' && !e.start) || (e.kind === 'factions' && !e.founded)).length : 0;

    root.replaceChildren(el('div', { class: 'cv tl-page' },
      el('div', { class: 'cv-bar' },
        el('span', { class: 'tp-deco' }, `${entries.length} on the timeline${undated ? ` · ${undated} undated` : ''}`),
        el('span', { class: 'app-actions' },
          seg,
          pushButton('Push timeline', () => push({ mode: 'timeline' }), { title: 'Show the timeline on the player screen: what\'s in the players\' Codex, as each sheet allows' }))),
      trackChips(tracks, (id) => {
        tracks = tracks.includes(id) ? tracks.filter((t) => t !== id) : [...tracks, id];
        store.set(TRACKS_KEY(), JSON.stringify(tracks));
        draw();
      }),
      view === 'player' ? el('p', { class: 'tp-dim tl-note' }, 'What the players get: entries in their Codex whose date they may read, named and pictured as each sheet allows.') : null,
      renderTimeline(entries, {
        href: view === 'gm' ? (e) => hrefOf(e) : null,
        imageUrl,
        empty: view === 'gm'
          ? 'Nothing dated yet. Give stories, rumors and events a Start (and an End), or factions a Founded date, and they appear here.'
          : 'Nothing the players know of is dated yet. Put dated entries in their Codex (on each entry\'s page, or by pushing them).',
      })));
    document.title = 'TEMPEST · Timeline';
  }

  await draw();
  return {
    async relabel() {
      everything = await allEntities().catch(() => everything);
      draw();
    },
  };
}
