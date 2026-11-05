// Renders a screamsheet the same way everywhere: the generator's preview, its
// page under World › Screamsheets, the player screen and the players' Codex.
//   broadsheet  a formal newspaper
//   crt         a green-phosphor terminal feed
//   plain       follows the active TEMPEST theme
//
// Parts the GM obscured or hid (screamsheet-model.js, parts):
//   players' copy  obscured parts print as redacted bars, static, cipher or the GM's words;
//                  hidden parts aren't printed at all
//   GM page        everything prints, obscured and hidden parts dimmed, each part with
//                  `control(part)` beside it (its Reveal / Obscure / Hide menu)

import { el } from '../ui.js';
import { LAYOUTS } from './screamsheet-model.js';
import { obscured } from '../forge/obscure.js';

const LINES = { headline: [86], outlet: [80], dateline: [100], byline: [26], body: [100, 94, 100, 72, 0, 100, 88, 56] };

export function renderArticle(article, { control = null } = {}) {
  const { headline, outlet, byline, dateline, layout = 'broadsheet', body = '' } = article;
  const gm = Boolean(control);
  /** What players get of a part: the GM's sheet has `parts`; the players' copy has `obscured` and `hidden`. */
  const stateOf = (part) => article.parts?.[part]
    ?? (article.hidden?.includes(part) ? { visibility: 'hidden' } : article.obscured?.[part] ? { visibility: 'rumored', ...article.obscured[part] } : { visibility: 'revealed' });

  /** One part: its own markup when players may read it (or for the GM), else obscured or nothing. */
  function part(id, tag, cls, value, draw = (v) => v) {
    const s = stateOf(id);
    if (!gm) {
      if (s.visibility === 'hidden') return null;
      if (s.visibility === 'rumored') {
        const lines = LINES[id].filter(Boolean);
        return el(tag, { class: `${cls} paper__obscured` }, obscured(s.style, { as: id === 'headline' ? 'name' : undefined, lines, text: s.text, seed: `${article.id}:${id}` }));
      }
      return value ? el(tag, { class: cls }, draw(value)) : null;
    }
    const node = el(tag, { class: `${cls} paper__part ${s.visibility === 'revealed' ? '' : `is-${s.visibility}`}` }, value ? draw(value) : el('span', { class: 'paper__empty' }, '—'));
    return el('div', { class: 'paper__ctl-wrap', 'data-part': id }, el('span', { class: 'paper__ctl' }, control(id)), node);
  }

  const paragraphs = (text) => String(text).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => el('p', {}, p));
  return el('article', { class: `paper paper--${LAYOUTS.some((l) => l.id === layout) ? layout : 'broadsheet'} ${gm ? 'paper--gm' : ''}` },
    el('header', { class: 'paper__masthead' },
      part('outlet', 'span', 'paper__outlet', outlet || 'Screamsheet'),
      part('dateline', 'span', 'paper__date', dateline)),
    part('headline', 'h1', 'paper__headline', headline || 'Untitled'),
    part('byline', 'p', 'paper__byline', byline, (v) => `By ${v}`),
    part('body', 'div', 'paper__body', body, paragraphs));
}
