// A network as the players see it (the players' copy from playerNetwork()): the
// player screen draws it, and the GM's run view previews it with the same code.

import { el } from '../ui.js';
import { renderSheet } from '../forge/sheet.js';
import { renderTree, nodeText } from './tree.js';

/**
 * playerNetworkView(view, { url, fit }) → { node, cleanup }
 *   view  { name, nodes, focus } from playerNetwork()
 *   url   (assetId) → image URL, for the lit node's card
 */
export function playerNetworkView(view, { url = null, fit = false, openImage = null } = {}) {
  const tree = renderTree(view, {
    content: (n) => (n.hidden ? el('span', { class: 'nr-node__unknown', 'aria-label': 'Unknown' }, '?') : nodeText(n)),
    classOf: (n) => [n.hidden ? 'is-hidden' : 'is-revealed', n.id === view.focus ? 'is-focus' : ''].join(' '),
    fit,
    empty: el('div', { class: 'nr-canvas__empty' }, el('p', { class: 'tp-h3' }, 'Jacked in'), el('p', { class: 'tp-muted' }, 'Nothing found yet.')),
  });
  const lit = view.nodes.find((n) => n.id === view.focus && !n.hidden);
  const card = lit?.card;
  const lookup = (id) => (card?.links?.[id] ? { name: card.links[id].name ?? 'Unknown', image: card.links[id].image } : null);
  return {
    node: el('section', { class: `nr-player ${card ? 'has-card' : ''}` },
      el('h1', { class: 'tp-h1 nr-player__title' }, view.name),
      el('div', { class: 'nr-player__body' },
        tree.node,
        card
          ? el('article', { class: 'tp-frame tp-panel nr-player__card' },
              el('div', { class: 'tp-panel__body' }, renderSheet(card.sheet, { view: 'player', values: card.values, shown: card.shown, lookup, imageUrl: url, openImage })))
          : null)),
    cleanup: tree.cleanup,
  };
}
