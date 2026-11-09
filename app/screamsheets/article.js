// Renders a screamsheet (an issue: its lead article, more articles and ads) the same way
// everywhere: the generator's preview, its page under World › Screamsheets, the player
// screen and the players' Codex.
//   feed        a news site on a screen, like the rulebook's Night City Today: status bar,
//               monogram masthead, section tabs, articles in two columns
//   broadsheet  a formal newspaper
//   crt         a green-phosphor terminal feed
//   plain       follows the active TEMPEST theme
//
// Parts the GM obscured or hid (screamsheet-model.js, parts):
//   players' copy  obscured parts print as redacted bars, static, cipher or the GM's words;
//                  hidden parts aren't printed at all
//   GM page        everything prints, obscured and hidden parts dimmed, each part with
//                  control(itemId, part) beside it (its Reveal / Obscure / Hide menu), and each
//                  piece with tools(itemId, piece) (edit, move, remove)

import { el } from '../ui.js';
import { LAYOUTS, SECTIONS, monogram } from './screamsheet-model.js';
import { obscured } from '../forge/obscure.js';

const LINES = { headline: [86], outlet: [80], dateline: [100], byline: [26], body: [100, 94, 100, 72, 0, 100, 88, 56] };

/**
 * renderIssue(issue, { control?, tools?, linkHref?, imageUrl? })
 *   control   (itemId | null, part) → node: GM only, a part's visibility control
 *   tools     (itemId | null, piece) → node: GM only, a piece's toolbar
 *   linkHref  (entryId) → href | null: makes a Link line that points at an entry clickable
 *   imageUrl  (assetId) → URL, for ads' pictures
 */
export function renderIssue(issue, { control = null, tools = null, linkHref = null, imageUrl = null } = {}) {
  const gm = Boolean(control);
  const layout = LAYOUTS.some((l) => l.id === issue.layout) ? issue.layout : 'broadsheet';
  const feed = layout === 'feed';

  /** What players get of a part: the GM's sheet has `parts`; the players' copy has `obscured` and `hidden`. */
  const stateOf = (a, part) => a.parts?.[part]
    ?? (a.hidden?.includes?.(part) ? { visibility: 'hidden' } : a.obscured?.[part] ? { visibility: 'rumored', ...a.obscured[part] } : { visibility: 'revealed' });

  /** One part of an article: its markup when players may read it (or for the GM), else obscured or nothing. */
  function part(a, itemId, id, tag, cls, value, draw = (v) => v) {
    const s = stateOf(a, id);
    if (!gm) {
      if (s.visibility === 'hidden') return null;
      if (s.visibility === 'rumored') {
        return el(tag, { class: `${cls} paper__obscured` }, obscured(s.style, { as: id === 'headline' ? 'name' : undefined, lines: LINES[id].filter(Boolean), text: s.text, seed: `${issue.id}:${itemId ?? 'lead'}:${id}` }));
      }
      return value ? el(tag, { class: cls }, draw(value)) : null;
    }
    const node = el(tag, { class: `${cls} paper__part ${s.visibility === 'revealed' ? '' : `is-${s.visibility}`}` }, value ? draw(value) : el('span', { class: 'paper__empty' }, '—'));
    return el('div', { class: 'paper__ctl-wrap', 'data-part': id, 'data-item': itemId ?? 'lead' }, el('span', { class: 'paper__ctl' }, control(itemId, id)), node);
  }

  const paragraphs = (t) => String(t).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => el('p', {}, p));

  function links(list = []) {
    if (!list.length) return null;
    return el('div', { class: 'paper__links' }, list.map((l) => {
      const href = l.ref && linkHref ? linkHref(l.ref) : null;
      return el('p', { class: 'paper__link' }, el('b', {}, 'Link: '),
        href ? el('a', { class: 'paper__link-to', href, 'data-ref': l.ref }, l.text) : el('span', { class: 'paper__link-to' }, l.text));
    }));
  }
  const notes = (list = []) => (list.length
    ? el('div', { class: 'paper__notes' }, list.map((n) => el('p', { class: 'paper__note' }, el('b', {}, `${n.label}: `), ...String(n.text).split('\n').flatMap((line, i) => (i ? [el('br'), line] : [line])))))
    : null);

  /** An article's picture: shown, obscured (players know there's a picture, not what), or nothing. */
  function picture(a, itemId) {
    const s = stateOf(a, 'image');
    const figure = (inner, caption) => el('figure', { class: 'paper__figure' }, inner, caption ? el('figcaption', { class: 'paper__caption' }, caption) : null);
    if (!gm) {
      if (s.visibility === 'rumored') return figure(el('div', { class: 'paper__figure-veil' }, obscured(s.style, { lines: [100, 100, 100, 100, 70], text: s.text, seed: `${issue.id}:${itemId ?? 'lead'}:image` })));
      if (s.visibility === 'hidden' || !a.image || !imageUrl) return null;
      return figure(el('img', { class: 'paper__image', src: imageUrl(a.image), alt: a.caption || '' }), a.caption);
    }
    if (!a.image) return null;
    return el('div', { class: 'paper__ctl-wrap', 'data-part': 'image', 'data-item': itemId ?? 'lead' },
      el('span', { class: 'paper__ctl' }, control(itemId, 'image')),
      el('div', { class: `paper__part ${s.visibility === 'revealed' ? '' : `is-${s.visibility}`}` },
        figure(imageUrl ? el('img', { class: 'paper__image', src: imageUrl(a.image), alt: a.caption || '' }) : null, a.caption)));
  }

  function article(a, itemId, lead) {
    const headTag = lead && !feed ? 'h1' : 'h2';
    const pic = picture(a, itemId);
    const after = a.imagePos === 'after';
    return el('section', { class: `paper__item paper__item--article ${lead ? 'paper__item--lead' : ''} ${gm && a.hidden ? 'is-off' : ''}`, 'data-item': itemId ?? 'lead' },
      gm && tools ? el('div', { class: 'paper__tools' }, tools(itemId, a)) : null,
      part(a, itemId, 'headline', headTag, 'paper__headline', a.headline || 'Untitled'),
      part(a, itemId, 'byline', 'p', 'paper__byline', a.byline, (v) => `by ${v}`),
      after ? null : pic,
      part(a, itemId, 'body', 'div', 'paper__body', a.body, paragraphs),
      after ? pic : null,
      notes(a.notes),
      links(a.links));
  }

  function ad(it) {
    return el('section', { class: `paper__item paper__item--ad ${gm && it.hidden ? 'is-off' : ''}`, 'data-item': it.id },
      gm && tools ? el('div', { class: 'paper__tools' }, tools(it.id, it)) : null,
      el('div', { class: 'paper__ad' },
        it.image && imageUrl ? el('img', { class: 'paper__ad-image', src: imageUrl(it.image), alt: '' }) : null,
        it.tagline ? el('p', { class: 'paper__ad-tagline' }, it.tagline) : null),
      links(it.links));
  }

  // The masthead: a news site's status bar, monogram and section tabs; or a paper's name and date.
  const outlet = part(issue, null, 'outlet', 'span', 'paper__outlet', issue.outlet || 'Screamsheet');
  const date = part(issue, null, 'dateline', 'span', 'paper__date', issue.dateline);
  const masthead = feed
    ? [
        el('div', { class: 'nct__status', 'aria-hidden': 'true' },
          el('span', { class: 'nct__signal' }, el('i'), el('i'), el('i'), el('i')),
          el('span', { class: 'nct__clock' }, date ?? ''),
          el('span', { class: 'nct__battery' }, el('i'))),
        el('header', { class: 'nct__masthead' },
          el('div', { class: 'nct__logo' },
            el('span', { class: 'nct__mono', 'aria-hidden': 'true' }, monogram(issue.outlet)),
            el('span', { class: 'nct__name' }, outlet ?? ''),
            el('span', { class: 'nct__news', 'aria-hidden': 'true' }, 'News')),
          el('nav', { class: 'nct__tabs', 'aria-label': 'Sections' },
            SECTIONS.map((x) => el('span', { class: `nct__tab ${x.id === issue.section ? 'is-on' : ''}`, 'aria-current': x.id === issue.section ? 'page' : null }, x.label)))),
      ]
    : el('header', { class: 'paper__masthead' }, outlet, date);

  const pieces = [article(issue, null, true), ...(issue.items ?? []).map((it) => (it.type === 'ad' ? ad(it) : article(it, it.id, false)))];
  return el('article', { class: `paper paper--${layout} ${gm ? 'paper--gm' : ''}` },
    masthead,
    feed
      ? el('div', { class: 'paper__columns' }, pieces)
      : [pieces[0], pieces.length > 1 ? el('div', { class: 'paper__columns paper__columns--more' }, pieces.slice(1)) : null]);
}

/** One article on its own (the generator's preview of a single piece). */
export const renderArticle = (article, opts) => renderIssue(article, opts);
