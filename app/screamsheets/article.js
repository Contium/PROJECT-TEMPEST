// Renders a screamsheet the same way everywhere: the generator's preview, its
// page under World › Screamsheets, and the player screen.
//   broadsheet  a formal newspaper
//   crt         a green-phosphor terminal feed
//   plain       follows the active TEMPEST theme

import { el } from '../ui.js';
import { LAYOUTS } from './screamsheet-model.js';

export function renderArticle({ headline, outlet, byline, dateline, layout = 'broadsheet', body = '' }) {
  const paragraphs = String(body).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return el('article', { class: `paper paper--${LAYOUTS.some((l) => l.id === layout) ? layout : 'broadsheet'}` },
    el('header', { class: 'paper__masthead' },
      el('span', { class: 'paper__outlet' }, outlet || 'Screamsheet'),
      dateline ? el('span', { class: 'paper__date' }, dateline) : null),
    el('h1', { class: 'paper__headline' }, headline || 'Untitled'),
    byline ? el('p', { class: 'paper__byline' }, `By ${byline}`) : null,
    el('div', { class: 'paper__body' }, paragraphs.map((p) => el('p', {}, p))));
}
