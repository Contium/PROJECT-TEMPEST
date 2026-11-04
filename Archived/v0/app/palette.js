// Quick search (Ctrl+K): jump to any entity, screamsheet or page by typing.
//
// Name matches are ranked instantly on the client from the cached entity index;
// matches inside text (screamsheet bodies, summaries, roles…) arrive a moment
// later from the server's full-text search. Enter opens, Ctrl+Enter pushes the
// result to the player screen, an empty box shows recently opened items.

import { el, visibilityBadge, debounce } from './ui.js';
import { ancestors } from './model.js';
import { pushEntity } from './push.js';

const MAX_RESULTS = 12;
const MAX_RECENT = 8;
const recentKey = (uid) => `tempest.recent.${uid}`;

/** Remember an entity as recently opened (newest first). */
export function recordRecent(uid, id) {
  try {
    const list = JSON.parse(localStorage.getItem(recentKey(uid)) ?? '[]').filter((x) => x !== id);
    localStorage.setItem(recentKey(uid), JSON.stringify([id, ...list].slice(0, MAX_RECENT)));
  } catch {
    /* storage unavailable: recents are a convenience */
  }
}

function recents(uid) {
  try {
    return JSON.parse(localStorage.getItem(recentKey(uid)) ?? '[]');
  } catch {
    return [];
  }
}

/**
 * How well `query` matches `text`, 0 = not at all. Exact > prefix > word
 * prefix > initials ("kn" → Kabuki Night) > substring > in-order letters.
 * Returns { score, start, end } with the matched span for highlighting.
 */
export function scoreMatch(text, query) {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return { score: 0 };
  if (t === q) return { score: 100, start: 0, end: t.length };
  if (t.startsWith(q)) return { score: 90 - Math.min(t.length - q.length, 30) / 10, start: 0, end: q.length };
  const words = [...t.matchAll(/[\p{L}\p{N}]+/gu)];
  const word = words.find((w) => w[0].startsWith(q));
  if (word) return { score: 75, start: word.index, end: word.index + q.length };
  const initials = words.map((w) => w[0][0]).join('');
  if (q.length >= 2 && initials.startsWith(q.replace(/\s+/g, ''))) return { score: 65 };
  const at = t.indexOf(q);
  if (at >= 0) return { score: 50, start: at, end: at + q.length };
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length && q.length >= 3 ? { score: 20 } : { score: 0 };
}

function highlight(text, match) {
  if (match?.start == null) return text;
  return [text.slice(0, match.start), el('mark', {}, text.slice(match.start, match.end)), text.slice(match.end)];
}

/** Open the palette. ctx is the app context (names, types, labels, navigation, api). */
export async function openPalette(ctx) {
  document.querySelector('dialog.palette')?.remove();
  const names = await ctx.names();
  const order = new Map(ctx.types.map((t, i) => [t.id, i]));
  const live = [...names.values()].filter((e) => !e.deleted);

  // Pages you can jump to, alongside entities.
  const pages = [
    { label: ctx.engine.t('universe', 'Universe'), sub: 'Overview', path: ctx.base },
    { label: ctx.engine.t('timeline', 'Time-Line'), sub: 'Page', path: `${ctx.base}/timeline` },
    { label: 'Screamsheet Generator', sub: 'Tool', path: `${ctx.base}/tools/screamsheet` },
    { label: 'Settings', sub: 'Page', path: `${ctx.base}/settings` },
    ...ctx.types.map((t) => ({ label: ctx.typeLabel(t, true), sub: 'List', path: `${ctx.base}/e/${t.id}` })),
  ];

  const input = el('input', {
    class: 'tp-input palette__input', type: 'text', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list',
    'aria-autocomplete': 'list', placeholder: 'Search the universe…', autocomplete: 'off', spellcheck: 'false',
  });
  const list = el('ul', { class: 'palette__list', id: 'palette-list', role: 'listbox' });
  const status = el('p', { class: 'palette__status tp-muted', role: 'status' });
  const dialog = el('dialog', { class: 'tp-dialog palette', 'aria-label': 'Quick search' },
    el('div', { class: 'tp-frame tp-panel palette__panel' },
      el('div', { class: 'palette__head' }, input),
      list,
      status,
      el('footer', { class: 'palette__foot tp-label' },
        el('span', {}, el('kbd', {}, '↑'), el('kbd', {}, '↓'), ' Move'),
        el('span', {}, el('kbd', {}, 'Enter'), ' Open'),
        el('span', {}, el('kbd', {}, 'Ctrl'), '+', el('kbd', {}, 'Enter'), ' Push to players'),
        el('span', {}, el('kbd', {}, 'Esc'), ' Close'))));

  let results = [];
  let active = 0;
  let textHits = [];
  let lastQuery = '';

  const subtitle = (e) => {
    const where = ancestors(e, names).map((a) => a.name);
    const detail = e.data?.role ?? e.data?.kind ?? e.data?.outlet ?? null;
    return [detail, where.length ? where.slice(-2).join(' › ') : null].filter(Boolean).join(' · ');
  };

  function entityResult(e, match, why) {
    return { kind: 'entity', entity: e, match, why, path: `${ctx.base}/e/${e.type}/${e.id}` };
  }

  function rank(query) {
    if (!query.trim()) {
      const recent = recents(ctx.uid).map((id) => names.get(id)).filter((e) => e && !e.deleted);
      return recent.map((e) => entityResult(e, null, 'Recent'));
    }
    const scored = [];
    for (const e of live) {
      const m = scoreMatch(e.name, query);
      // Relationships are long generated names; keep them behind real things.
      if (m.score > 0) scored.push({ r: entityResult(e, m), score: m.score - (e.type === 'relation' ? 15 : 0) });
    }
    for (const p of pages) {
      const m = scoreMatch(p.label, query);
      if (m.score > 0) scored.push({ r: { kind: 'page', ...p, match: m }, score: m.score - 5 });
    }
    scored.sort((a, b) => b.score - a.score
      || (order.get(a.r.entity?.type) ?? 99) - (order.get(b.r.entity?.type) ?? 99)
      || (a.r.entity?.name ?? a.r.label).length - (b.r.entity?.name ?? b.r.label).length);
    const top = scored.slice(0, MAX_RESULTS).map((s) => s.r);
    // Then text matches the name search didn't already find.
    const seen = new Set(top.filter((r) => r.entity).map((r) => r.entity.id));
    for (const e of textHits) {
      if (top.length >= MAX_RESULTS + 4) break;
      if (!seen.has(e.id)) top.push(entityResult(names.get(e.id) ?? e, null, 'Matches text'));
    }
    return top;
  }

  function paint() {
    const query = input.value;
    results = rank(query);
    active = Math.min(active, Math.max(results.length - 1, 0));
    list.replaceChildren(
      ...results.map((r, i) => {
        const e = r.entity;
        const thumb = e?.data?.image
          ? el('img', { class: 'palette__thumb', src: ctx.api.imageUrl(e.data.image), alt: '' })
          : el('span', { class: 'palette__thumb palette__thumb--blank', 'aria-hidden': 'true' }, (e?.name ?? r.label)[0]?.toUpperCase());
        return el('li', {
          class: 'palette__item', id: `palette-opt-${i}`, role: 'option', 'aria-selected': String(i === active),
          onMousemove: () => i !== active && ((active = i), mark()),
          onClick: (ev) => choose(i, ev.ctrlKey || ev.metaKey),
        },
          thumb,
          el('span', { class: 'palette__text' },
            el('span', { class: 'palette__name' }, highlight(e?.name ?? r.label, r.match)),
            el('span', { class: 'palette__sub' }, e ? subtitle(e) : r.sub)),
          r.why ? el('span', { class: 'palette__why tp-label' }, r.why) : null,
          e ? visibilityBadge(e.visibility) : null,
          el('span', { class: 'tp-badge palette__type' }, e ? ctx.typeLabel(e.type) : r.sub));
      }),
    );
    status.textContent = results.length
      ? ''
      : query.trim() ? `Nothing named "${query.trim()}"${textHits.length ? '' : ' (searching text…)'}` : 'Start typing to search. Recently opened items appear here.';
    mark();
  }

  function mark() {
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    input.setAttribute('aria-activedescendant', results.length ? `palette-opt-${active}` : '');
    list.children[active]?.scrollIntoView({ block: 'nearest' });
  }

  // Full-text search on the server for matches inside text (debounced).
  const searchText = debounce(async (query) => {
    if (!query.trim() || query.trim().length < 2) return;
    try {
      const hits = await ctx.api.list({ q: query.trim(), limit: 20 });
      if (input.value === query) {
        textHits = hits;
        paint();
      }
    } catch {
      /* text search is a bonus; names still work */
    }
  }, 160);

  async function choose(i, push) {
    const r = results[i];
    if (!r) return;
    dialog.close();
    if (r.kind === 'page') return ctx.go(r.path);
    recordRecent(ctx.uid, r.entity.id);
    if (push) await pushEntity(ctx, r.entity);
    else ctx.go(r.path);
  }

  input.addEventListener('input', () => {
    if (input.value !== lastQuery) {
      lastQuery = input.value;
      textHits = [];
      active = 0;
    }
    paint();
    searchText(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      mark();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active, e.ctrlKey || e.metaKey);
    }
  });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close()); // backdrop click

  document.body.append(dialog);
  dialog.showModal();
  input.focus();
  paint();
}
