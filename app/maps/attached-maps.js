// Maps & pictures attached to a point of interest (World View and City Map):
// an editor (upload, caption, remove) and a read-only gallery. Clicking a
// thumbnail opens the image viewer (app/image-viewer.js) on that map, with the
// point's other maps a step away and, in the GM window, Push to players.
// A POI's `maps` is [{ image: img_…, caption }].

import { el, toastError } from '../ui.js';
import { uploadImage, imageUrl } from '../api.js';
import { openImage } from '../image-viewer.js';
import { MAX_MAPS } from './poi-model.js';

/**
 * Open a point's maps in the viewer, starting at `index`.
 *   url   (assetId) → URL (another project's images, on the player screen)
 *   push  (map) → void, for a Push button in the viewer
 */
export function showMaps(maps, index = 0, { url = imageUrl, push } = {}) {
  openImage(maps.map((m) => ({ src: url(m.image), caption: m.caption, map: m })), index, push ? { push: (item) => push(item.map) } : {});
}

const thumb = (maps, i, opts) => el('button', { type: 'button', class: 'cm-map__thumb', title: 'Open full size', 'aria-label': `Open ${maps[i].caption || 'map'} full size`, onClick: () => showMaps(maps, i, opts) },
  el('img', { src: (opts.url ?? imageUrl)(maps[i].image), alt: '', loading: 'lazy' }));

/**
 * The editor for a draft's maps. Edits `maps` in place; `changed()` is called
 * after uploads and removals so the caller can redraw. With `push(map)`, each
 * map gets a Push button (to the player screen), in the list and in the viewer.
 */
export function mapsEditor(maps, changed, { push } = {}) {
  async function add(files) {
    for (const file of [...files].slice(0, MAX_MAPS - maps.length)) {
      try {
        const { id } = await uploadImage(file);
        if (!maps.some((m) => m.image === id)) maps.push({ image: id, caption: file.name.replace(/\.[^.]+$/, '').slice(0, 120) });
      } catch (err) {
        toastError(err);
      }
    }
    changed();
  }
  const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onChange: (e) => add(e.target.files) });
  return el('div', { class: 'tp-field' },
    el('span', { class: 'tp-label' }, `Maps & pictures${maps.length ? ` (${maps.length}/${MAX_MAPS})` : ''}`),
    maps.length
      ? el('ul', { class: 'cm-maps' }, maps.map((m, i) =>
          el('li', { class: `cm-map ${push ? 'cm-map--push' : ''}` },
            thumb(maps, i, { push }),
            el('input', { class: 'tp-input', value: m.caption, maxlength: 120, placeholder: 'Caption', 'aria-label': 'Caption', onInput: (e) => (m.caption = e.target.value) }),
            push ? el('button', { type: 'button', class: 'fd-icon-btn', title: 'Show this map on the player screen', 'aria-label': `Push ${m.caption || 'this map'} to the player screen`, onClick: () => push(m) }, '⇪') : null,
            el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': 'Remove this map', onClick: () => (maps.splice(i, 1), changed()) }, '×'))))
      : null,
    maps.length < MAX_MAPS
      ? el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => fileInput.click() }, '+ Attach map or picture')
      : null,
    fileInput);
}

/**
 * Read-only thumbnails with captions (players' views). Nothing when there are none.
 * Options as for showMaps: `url` for where images load from, `push` for the viewer.
 */
export const mapsGallery = (maps = [], opts = {}) => (maps.length
  ? el('ul', { class: 'cm-maps' }, maps.map((m, i) => el('li', { class: 'cm-map cm-map--view' }, thumb(maps, i, opts), el('span', { class: 'wv-note' }, m.caption))))
  : null);
