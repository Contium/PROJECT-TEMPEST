// One place as players see it (a PlaceCard, app/maps/place-model.js): the player
// screen's "place" push, the Codex, and the GM's "View as Players".

import { el } from '../ui.js';
import { mapsGallery } from './attached-maps.js';
import { imageUrl } from '../api.js';

/** opts: url (assetId → URL), push (map → void), extra (nodes after the maps). */
export function placeCardView(card, { url = imageUrl, push, extra = null, panel = true } = {}) {
  const pictures = card.image ? [{ image: card.image, caption: card.name }, ...card.maps] : card.maps;
  const body = el('div', { class: 'tp-panel__body' },
    el('p', { class: 'app-row scr-poi__type' }, el('span', { class: 'wv-glyph', 'aria-hidden': 'true' }, card.glyph), card.label, card.where ? el('span', { class: 'tp-dim' }, `· ${card.where}`) : null),
    el('h1', { class: 'tp-h1 scr-poi__name' }, card.name),
    card.description ? el('p', { class: 'scr-poi__desc' }, card.description) : null,
    mapsGallery(pictures, { url, push }),
    extra);
  return panel ? el('article', { class: 'tp-frame tp-panel scr-panel scr-poi' }, body) : body;
}
