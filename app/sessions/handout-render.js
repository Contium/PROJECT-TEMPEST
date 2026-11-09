// Drawing a handout and a session recap, the same on the GM's preview, the player screen and
// the players' Codex. Handouts are props: each style looks like the thing it is (a letter,
// a scrawled note, a typed document, a datapad, a picture) whatever the theme (sessions.css).

import { el } from '../ui.js';
import { obscured } from '../forge/obscure.js';
import { paragraphs, dayOf, STYLES } from './session-model.js';

/**
 * renderHandout(h, { imageUrl, openImage }) → <article class="ho ho--<style>">
 * h is a handout or its players' copy (playerHandout): obscured text arrives empty, with its length.
 */
export function renderHandout(h, { imageUrl, openImage = null } = {}) {
  const style = STYLES.some((s) => s.id === h.style) ? h.style : 'letter';
  const picture = h.image
    ? el('figure', { class: 'ho__figure' },
        el('img', {
          class: `ho__image ${openImage ? 'is-zoomable' : ''}`, src: imageUrl(h.image), alt: h.caption || h.title || 'Handout', loading: 'lazy',
          onClick: openImage ? () => openImage([{ image: h.image, caption: h.caption || h.title }], 0) : null,
        }),
        h.caption ? el('figcaption', { class: 'ho__caption' }, h.caption) : null)
    : null;
  // While obscured, the players see something is written there, about as long as the real thing.
  const lines = (n) => {
    const count = Math.min(14, Math.max(2, Math.ceil(n / 70)));
    return Array.from({ length: count }, (_, i) => (i === count - 1 ? 55 : 88 + ((i * 7) % 12)));
  };
  const body = h.obscure
    ? el('div', { class: 'ho__text ho__text--obscured' }, obscured(h.obscure, { lines: lines(h.length ?? h.text?.length ?? 200), seed: h.id }))
    : paragraphs(h.text).length
      ? el('div', { class: 'ho__text' }, paragraphs(h.text).map((p) => el('p', {}, p)))
      : null;
  const head = {
    letter: null,
    note: null,
    document: el('header', { class: 'ho__head' }, el('h2', { class: 'ho__title' }, h.title)),
    datapad: el('header', { class: 'ho__head' }, el('span', { class: 'ho__led', 'aria-hidden': 'true' }), el('span', { class: 'ho__subject' }, h.title), h.from ? el('span', { class: 'ho__sender' }, `from ${h.from}`) : null),
    picture: null,
  }[style];
  return el('article', { class: `ho ho--${style} ${picture && !body ? 'ho--only-picture' : ''}`, 'aria-label': h.title || 'Handout' },
    head,
    picture,
    body,
    h.from && style !== 'datapad' && style !== 'picture' ? el('p', { class: 'ho__from' }, h.from) : null);
}

/** A session's recap ("Previously…"), as the players get it. */
export function renderRecap(r) {
  return el('article', { class: 'tp-frame tp-panel recap' },
    el('div', { class: 'tp-panel__body' },
      el('p', { class: 'tp-label recap__kicker' }, ['Previously', `Session ${r.number}`, dayOf(r.date)].filter(Boolean).join(' · ')),
      r.title ? el('h1', { class: 'tp-h1 recap__title' }, r.title) : null,
      el('div', { class: 'recap__text' }, paragraphs(r.recap).map((p) => el('p', {}, p)))));
}
