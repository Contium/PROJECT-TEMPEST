// The players' Codex on the player screen: everything the players know of (server/codex.js),
// to browse at their own pace with the Codex button, whatever the GM has pushed.
//
// It opens over the pushed view (below the turn bar during a fight) with the campaign's
// players, NPCs, monsters, creatures, world, items, news and places as cards. Picking one opens it as players see it:
// a character's sheet, a screamsheet as printed, a place with its maps. Entries the screen
// hasn't opened yet are marked NEW (remembered per screen), and the Codex button counts them.
// A new push while it's open says so, with a way back to the screen.

import { el } from '../ui.js';
import { renderSheet } from '../forge/sheet.js';
import { renderIssue } from '../screamsheets/article.js';
import { typeOf } from '../maps/poi-model.js';
import { iconOf } from '../maps/city-poi-model.js';
import { mapsGallery } from '../maps/attached-maps.js';
import { placeCardView } from '../maps/place-card.js';
import { openImage } from '../image-viewer.js';
import { renderHandout, renderRecap } from '../sessions/handout-render.js';

const GLYPH = { players: '◉', npcs: '◐', monsters: '✸', creatures: '❂', people: '◌', world: '✦', factions: '⚑', items: '◆', news: '▤', places: '⌖', handouts: '✉', sessions: '❧' };
const CHARACTER_GROUPS = ['players', 'npcs', 'monsters', 'creatures', 'people'];
const REFRESH_MS = 30000;
const initials = (name) => (name ?? '?').split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w.replace(/\W/g, '')[0]).join('').toUpperCase() || '?';
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.effects === 'off';

const seenKey = (projectId) => `tempest.codex.seen.${projectId}`;
function readSeen(projectId) {
  try {
    const raw = localStorage.getItem(seenKey(projectId));
    return raw ? new Set(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
function writeSeen(projectId, ids) {
  try {
    localStorage.setItem(seenKey(projectId), JSON.stringify([...ids].slice(-2000)));
  } catch {
    /* no storage: everything stays new */
  }
}

/** The Codex: { button, node, update(display) }. */
export function codex() {
  const count = el('span', { class: 'cx-btn__count', hidden: true });
  const button = el('button', { type: 'button', class: 'tp-frame tp-btn scr__codex', title: 'Everything your party knows of (C)', 'aria-haspopup': 'dialog' },
    el('span', { class: 'cx-btn__glyph', 'aria-hidden': 'true' }, '❖'), el('span', {}, 'Codex'), count);

  const search = el('input', { class: 'tp-input cx__search', type: 'search', placeholder: 'Search…', 'aria-label': 'Search the Codex', autocomplete: 'off', spellcheck: 'false' });
  const title = el('p', { class: 'tp-label cx__project' });
  const tabs = el('nav', { class: 'tp-tabs cx__tabs', role: 'tablist', 'aria-label': 'Codex sections' });
  const body = el('div', { class: 'cx__body' });
  const notice = el('div', { class: 'cx__notice', hidden: true, role: 'status' });
  const close = el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost cx__close', 'aria-label': 'Close the Codex (Esc)', title: 'Back to the screen (Esc)' }, '✕');
  const node = el('section', { class: 'cx', hidden: true, role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Codex' },
    el('header', { class: 'cx__head' },
      el('div', { class: 'cx__brand' }, title, el('h1', { class: 'tp-display tp-glitch cx__title', 'data-text': 'Codex' }, 'Codex')),
      search, close),
    tabs, notice, body);

  const s = { data: null, group: 'all', detail: null, seen: null, open: false, seq: null, fetching: null, lastFetch: 0 };
  const url = (id) => `/api/projects/${encodeURIComponent(s.data.project.id)}/assets/${encodeURIComponent(id)}`;
  const isNew = (x) => s.seen && !s.seen.has(x.id);

  async function load() {
    if (s.fetching) return s.fetching;
    s.fetching = (async () => {
      try {
        const r = await fetch('/api/codex', { cache: 'no-store' });
        const data = r.ok ? await r.json() : null;
        s.lastFetch = Date.now();
        if (!data) return;
        const changed = JSON.stringify(data) !== JSON.stringify(s.data);
        s.data = data;
        s.seen = readSeen(data.project.id);
        // First visit on this screen: what's known already isn't news.
        if (!s.seen) writeSeen(data.project.id, (s.seen = new Set(data.entries.map((x) => x.id))));
        badge();
        if (changed && s.open && !s.detail) renderList();
      } catch {
        /* offline: keep what we had */
      } finally {
        s.fetching = null;
      }
    })();
    return s.fetching;
  }

  function badge() {
    const n = s.data ? s.data.entries.filter(isNew).length : 0;
    count.hidden = !n;
    count.textContent = n > 99 ? '99+' : String(n);
    button.classList.toggle('has-new', n > 0);
    button.setAttribute('aria-label', n ? `Codex: ${n} new` : 'Codex');
  }

  function markSeen(id) {
    if (!s.seen || s.seen.has(id)) return;
    s.seen.add(id);
    writeSeen(s.data.project.id, s.seen);
    badge();
  }

  // --- the list ------------------------------------------------------------------------

  function visible() {
    const q = search.value.trim().toLowerCase();
    return s.data.entries
      .filter((x) => s.group === 'all' || x.group === s.group)
      .filter((x) => !q || `${x.title ?? ''} ${x.sub} ${x.summary}`.toLowerCase().includes(q))
      // Session recaps keep their order (latest first); everything else goes by name.
      .sort((a, b) => Number(isNew(b)) - Number(isNew(a)) || (a.order != null && b.order != null ? b.order - a.order : 0) || String(a.title ?? '~').localeCompare(String(b.title ?? '~'), undefined, { sensitivity: 'base' }));
  }

  function renderTabs() {
    const groups = [{ id: 'all', label: 'All' }, ...s.data.groups];
    if (!groups.some((g) => g.id === s.group)) s.group = 'all';
    tabs.replaceChildren(...groups.map((g) => {
      const n = g.id === 'all' ? s.data.entries.length : s.data.entries.filter((x) => x.group === g.id).length;
      const fresh = s.data.entries.filter((x) => (g.id === 'all' || x.group === g.id) && isNew(x)).length;
      return el('button', {
        type: 'button', class: 'tp-tab cx__tab', role: 'tab', 'aria-selected': String(g.id === s.group),
        onClick: () => ((s.group = g.id), (s.detail = null), renderList()),
      }, el('span', { class: 'cx__tab-in' }, g.id === 'all' ? null : el('span', { class: 'cx__tab-glyph', 'aria-hidden': 'true' }, GLYPH[g.id]), g.label, el('span', { class: 'cx__tab-n tp-mono' }, n), fresh ? el('span', { class: 'cx__dot', title: `${fresh} new` }) : null));
    }));
  }

  function card(x, i) {
    const face = x.image
      ? el('img', { class: 'cx-card__image', src: url(x.image), alt: '', loading: 'lazy' })
      : el('span', { class: `cx-card__image cx-card__sigil cx-card__sigil--${x.group}`, 'aria-hidden': 'true' }, CHARACTER_GROUPS.includes(x.group) ? initials(x.title) : GLYPH[x.group]);
    return el('li', { class: 'cx__cell', style: `--i:${Math.min(i, 24)}` },
      el('button', { type: 'button', class: `tp-frame cx-card cx-card--${x.group} ${isNew(x) ? 'is-new' : ''}`, onClick: () => openEntry(x.id) },
        face,
        isNew(x) ? el('span', { class: 'cx-card__new' }, 'New') : null,
        el('span', { class: 'cx-card__text' },
          el('span', { class: 'tp-label cx-card__sub' }, x.sub),
          el('span', { class: `cx-card__name ${x.title ? '' : 'is-unknown'}` }, x.title ?? 'Unknown'),
          x.summary ? el('span', { class: 'cx-card__summary' }, x.summary) : null)));
  }

  function renderList() {
    if (!s.data) return;
    title.textContent = s.data.project.name;
    renderTabs();
    const list = visible();
    node.classList.remove('is-detail');
    body.replaceChildren(list.length
      ? el('ul', { class: `cx__grid ${still() ? '' : 'is-animated'}` }, list.map(card))
      : el('div', { class: 'cx__empty' },
          el('p', { class: 'tp-display cx__empty-glyph', 'aria-hidden': 'true' }, '❖'),
          el('p', { class: 'tp-h3' }, search.value.trim() ? 'Nothing matches' : s.group === 'all' ? 'Nothing known yet' : `No ${s.data.groups.find((g) => g.id === s.group)?.label ?? 'entries'} known yet`),
          el('p', { class: 'tp-muted' }, search.value.trim() ? 'Try another word or section.' : 'As your party meets people, hears rumors and finds things, they appear here.')));
  }

  // --- one entry -------------------------------------------------------------------------

  async function openEntry(id) {
    s.detail = id;
    node.classList.add('is-detail');
    body.replaceChildren(el('p', { class: 'tp-deco cx__loading' }, 'Decrypting…'));
    let d;
    try {
      const r = await fetch(`/api/codex/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status === 404 ? 'This is no longer in the Codex.' : `The server answered ${r.status}`);
      d = await r.json();
    } catch (err) {
      if (s.detail !== id) return;
      body.replaceChildren(detailFrame(null, el('p', { class: 'app-error' }, err.message)));
      return;
    }
    if (s.detail !== id) return; // picked something else meanwhile
    markSeen(id);
    const entry = s.data?.entries.find((x) => x.id === id);
    body.replaceChildren(detailFrame(entry, content(d)));
    body.scrollTop = 0;
    renderTabs();
  }

  function detailFrame(entry, inner) {
    return el('div', { class: `cx-detail ${still() ? '' : 'is-animated'}` },
      el('div', { class: 'cx-detail__bar' },
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm cx-detail__back', onClick: back }, '← Codex'),
        entry ? el('span', { class: 'tp-label cx-detail__where' }, `${GLYPH[entry.group]} ${entry.sub}`) : null),
      inner);
  }

  const imageOpener = (items, i) => openImage(items.map((x) => ({ ...x, src: url(x.image) })), i);

  function content(d) {
    if (d.type === 'handout') return el('div', { class: 'cx-detail__paper' }, renderHandout(d.handout, { imageUrl: url, openImage: imageOpener }));
    if (d.type === 'recap') return el('div', { class: 'cx-detail__paper' }, renderRecap(d.recap));
    if (d.type === 'article') {
      // An issue's Link lines lead to the entries the party knows (the server keeps only those).
      const node = el('div', { class: 'cx-detail__article' }, renderIssue(d.article, { imageUrl: url, linkHref: (ref) => `#cx-${ref}` }));
      node.addEventListener('click', (ev) => {
        const a = ev.target.closest?.('a[href^="#cx-"]');
        if (!a) return;
        ev.preventDefault();
        openEntry(a.getAttribute('href').slice(4));
      });
      return node;
    }
    if (d.type === 'place') {
      const node = placeCardView(d.place, { url });
      node.classList.add('cx-detail__panel');
      return node;
    }
    if (d.type === 'poi' || d.type === 'citypoi') {
      const line = d.type === 'poi'
        ? [el('span', { class: 'wv-glyph', 'aria-hidden': 'true' }, typeOf(d.poi.type).glyph), typeOf(d.poi.type).label]
        : [iconOf(d.poi.icon).label, el('span', { class: 'tp-dim' }, `· ${d.cityName}`)];
      return el('article', { class: 'tp-frame tp-panel cx-detail__panel' },
        el('div', { class: 'tp-panel__body' },
          el('p', { class: 'app-row scr-poi__type' }, line),
          el('h1', { class: 'tp-h1 scr-poi__name' }, d.poi.name),
          d.poi.description ? el('p', { class: 'scr-poi__desc' }, d.poi.description) : null,
          mapsGallery(d.poi.maps, { url })));
    }
    const e = d.entity;
    const known = new Set(d.known ?? []);
    // Links to entries the party knows open here; the rest show only as their sheets allow.
    const lookup = (id) => (e.links[id] ? { name: e.links[id].name ?? 'Unknown', image: e.links[id].image, href: known.has(id) ? `#cx-${id}` : undefined } : null);
    const panel = el('article', { class: 'tp-frame tp-panel cx-detail__panel' },
      el('div', { class: 'tp-panel__body' }, renderSheet(e.sheet, { view: 'player', values: e.values, shown: e.shown, lookup, imageUrl: url, openImage: imageOpener })));
    panel.addEventListener('click', (ev) => {
      const a = ev.target.closest?.('a[href^="#cx-"]');
      if (!a) return;
      ev.preventDefault();
      openEntry(a.getAttribute('href').slice(4));
    });
    return panel;
  }

  function back() {
    s.detail = null;
    renderList();
  }

  // --- opening and closing -------------------------------------------------------------

  async function show() {
    if (s.open) return;
    s.open = true;
    node.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    notice.hidden = true;
    if (!still()) node.animate([{ opacity: 0, clipPath: 'inset(0 0 100% 0)' }, { opacity: 1, clipPath: 'inset(0)' }], { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    if (!s.data) body.replaceChildren(el('p', { class: 'tp-deco cx__loading' }, 'Connecting…'));
    else renderList();
    await load();
    if (!s.data) body.replaceChildren(el('p', { class: 'app-error' }, 'The Codex isn\'t available right now.'));
    else if (!s.detail) renderList();
    if (matchMedia('(pointer: fine)').matches) search.focus({ preventScroll: true });
  }
  function hide() {
    if (!s.open) return;
    s.open = false;
    s.detail = null;
    node.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.focus({ preventScroll: true });
  }

  button.addEventListener('click', () => (s.open ? hide() : show()));
  close.addEventListener('click', hide);
  search.addEventListener('input', () => ((s.detail = null), renderList()));
  node.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (s.detail) back();
    else hide();
  });
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, dialog, .scr-name')) return;
    if (e.key === 'c' || e.key === 'C') (s.open ? hide() : show());
    if (e.key === 'Escape' && s.open) (s.detail ? back() : hide());
  };
  document.addEventListener('keydown', onKey);
  const timer = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS);

  return {
    button,
    node,
    /** Every display (push or turn-order change): refresh, and tell an open Codex about a new push. */
    update(d) {
      if (Date.now() - s.lastFetch > 3000) load();
      if (d.seq !== s.seq) {
        const first = s.seq === null;
        s.seq = d.seq;
        if (!first && s.open && d.mode !== 'ambient') {
          notice.replaceChildren(
            el('span', {}, el('span', { class: 'tp-label' }, 'On screen now '), d.title || 'Something new'),
            el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive', onClick: hide }, 'Look'));
          notice.hidden = false;
        }
      }
    },
    destroy() {
      clearInterval(timer);
      document.removeEventListener('keydown', onKey);
    },
  };
}
