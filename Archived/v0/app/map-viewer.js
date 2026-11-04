// One map at a time with step-through controls: the floors of a Gig, or the
// scene images beside a Screamsheet. State is local to the window showing it.

import { el } from './ui.js';

/**
 * maps:        [{ image, label? }]
 * url(id):     image URL for an asset id
 * index:       which map to show first
 * labels:      { prev, next, prevTitle, nextTitle, fallback(i) } button text and unnamed-map labels
 * buttonClass: class for the step buttons (theme buttons on screens, plain inside a newspaper)
 * onChange(i): called whenever the shown map changes
 */
export function mapViewer({ maps, url, index = 0, labels = {}, buttonClass = 'mapv__btn', onChange }) {
  const {
    prev = '▼ Down', next = '▲ Up', prevTitle = 'Go down a floor', nextTitle = 'Go up a floor',
    fallback = (i) => `Floor ${i + 1}`,
  } = labels;
  const img = el('img', { class: 'mapv__img', alt: '' });
  const label = el('span', { class: 'mapv__label' });
  const count = el('span', { class: 'mapv__count' });
  const down = el('button', { type: 'button', class: buttonClass, title: prevTitle, 'aria-label': prevTitle }, prev);
  const up = el('button', { type: 'button', class: buttonClass, title: nextTitle, 'aria-label': nextTitle }, next);
  let current = 0;

  function show(n) {
    current = Math.max(0, Math.min(maps.length - 1, n));
    const name = maps[current].label || fallback(current);
    img.src = url(maps[current].image);
    img.alt = name;
    label.textContent = name;
    count.textContent = `${current + 1} / ${maps.length}`;
    down.disabled = current === 0;
    up.disabled = current === maps.length - 1;
    onChange?.(current);
  }

  down.addEventListener('click', () => show(current - 1));
  up.addEventListener('click', () => show(current + 1));
  const single = maps.length < 2;
  const node = el('figure', { class: 'mapv', 'aria-roledescription': 'map viewer' },
    img,
    el('figcaption', { class: 'mapv__bar' },
      single ? null : down,
      el('span', { class: 'mapv__info', 'aria-live': 'polite' }, label, single ? null : count),
      single ? null : up));
  show(index);
  return { node, show, step: (by) => show(current + by), get index() { return current; } };
}
