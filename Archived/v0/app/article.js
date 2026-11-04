// Renders an in-world article (screamsheet) the same way everywhere: the
// generator preview, an Article's page, and the player screen.
//   broadsheet  a formal newspaper (in the spirit of Night City Today)
//   crt         a green-phosphor terminal feed (in the spirit of The Augmented Optic)
//   plain       follows the active TEMPEST theme

import { el } from './ui.js';

export const LAYOUTS = [
  ['broadsheet', 'Broadsheet (formal newspaper)'],
  ['crt', 'Terminal (CRT screen feed)'],
  ['plain', 'Plain (follows the theme)'],
];

/** aside: an element (e.g. a scene-image viewer) floated beside the text, which wraps around it. */
export function renderArticle({ headline, outlet, byline, layout = 'broadsheet', body = '', imageUrl, dateLabel, aside }) {
  const paragraphs = String(body).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return el(
    'article',
    { class: `paper paper--${LAYOUTS.some(([id]) => id === layout) ? layout : 'broadsheet'} ${aside ? 'paper--with-aside' : ''}` },
    el('header', { class: 'paper__masthead' },
      el('span', { class: 'paper__outlet' }, outlet || 'Screamsheet'),
      dateLabel ? el('span', { class: 'paper__date' }, dateLabel) : null),
    el('h1', { class: 'paper__headline' }, headline || 'Untitled'),
    byline ? el('p', { class: 'paper__byline' }, `By ${byline}`) : null,
    imageUrl ? el('img', { class: 'paper__image', src: imageUrl, alt: '' }) : null,
    el('div', { class: 'paper__body' }, aside ? el('div', { class: 'paper__aside' }, aside) : null, paragraphs.map((p) => el('p', {}, p))),
  );
}
