// The image viewer: opens any picture full size, over the page. Used for
// attached maps, sheet images and galleries, in the GM window and on the
// player screen.
//
//   openImage(items, index = 0, { push })
//     items  [{ src, caption }]: one picture, or a set to step through (◀ ▶, arrow keys)
//     push   (item) → void: the GM window passes it, and the viewer gets a Push button
//
// Scroll (or + / −) zooms about the cursor, drag pans, double-click toggles
// between fitting the window and 2×, 0 fits again. Esc or × closes.

import { el } from './ui.js';

const MAX = 8;

export function openImage(items, index = 0, { push } = {}) {
  const list = (Array.isArray(items) ? items : [items]).filter((x) => x?.src);
  if (!list.length) return;
  let i = Math.min(Math.max(index, 0), list.length - 1);
  let view = { x: 0, y: 0, scale: 1 };
  let fit = 1; // the scale that fits the window
  let natural = { w: 1, h: 1 };
  let drag = null;

  const img = el('img', { class: 'iv__img', alt: '', draggable: 'false' });
  const stage = el('div', { class: 'iv__stage', tabindex: 0 }, img);
  const caption = el('p', { class: 'iv__caption' });
  const count = el('span', { class: 'tp-mono tp-dim iv__count' });
  const zoomText = el('span', { class: 'tp-mono tp-dim iv__zoom' });
  const pushBtn = push ? el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive', title: 'Show this picture on the player screen', onClick: () => push(list[i]) }, '⇪ Push to players') : null;
  const btn = (label, aria, onClick, extra = '') => el('button', { type: 'button', class: `tp-frame tp-btn tp-btn--sm ${extra}`, 'aria-label': aria, title: aria, onClick }, label);
  const prev = btn('◀', 'Previous picture', () => go(i - 1));
  const next = btn('▶', 'Next picture', () => go(i + 1));
  const dialog = el('dialog', { class: 'iv', 'aria-label': 'Picture viewer' },
    stage,
    el('div', { class: 'iv__bar' },
      el('div', { class: 'iv__info' }, caption, count),
      el('div', { class: 'iv__controls' },
        list.length > 1 ? [prev, next] : null,
        btn('−', 'Zoom out', () => zoomCenter(1 / 1.4)),
        zoomText,
        btn('+', 'Zoom in', () => zoomCenter(1.4)),
        btn('Fit', 'Fit to the window', () => fitView(), 'tp-btn--ghost'),
        pushBtn,
        btn('×', 'Close', () => close(), 'tp-btn--ghost'))));

  const box = () => ({ w: stage.clientWidth, h: stage.clientHeight });
  function apply() {
    const { w, h } = box();
    const iw = natural.w * view.scale;
    const ih = natural.h * view.scale;
    // Keep it on screen: centred when smaller than the window, edges never past the middle.
    view.x = iw <= w ? (w - iw) / 2 : Math.min(0, Math.max(w - iw, view.x));
    view.y = ih <= h ? (h - ih) / 2 : Math.min(0, Math.max(h - ih, view.y));
    img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    zoomText.textContent = `${Math.round(view.scale * 100)}%`; // of the picture's own pixels
  }
  function fitView() {
    const { w, h } = box();
    fit = Math.min(w / natural.w, h / natural.h, 1);
    view = { scale: fit, x: 0, y: 0 };
    apply();
  }
  function zoomAt(f, sx, sy) {
    const scale = Math.min(Math.max(view.scale * f, fit), Math.max(fit * MAX, 1));
    const k = scale / view.scale;
    view = { scale, x: sx - (sx - view.x) * k, y: sy - (sy - view.y) * k };
    apply();
  }
  const zoomCenter = (f) => zoomAt(f, box().w / 2, box().h / 2);

  function go(n) {
    i = (n + list.length) % list.length;
    const item = list[i];
    caption.textContent = item.caption || '';
    caption.hidden = !item.caption;
    count.textContent = list.length > 1 ? `${i + 1} / ${list.length}` : '';
    img.alt = item.caption || 'Picture';
    img.onload = () => {
      natural = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
      fitView();
    };
    img.src = item.src;
    if (img.complete && img.naturalWidth) img.onload();
  }

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  // Panning: the browser's own image drag (a ghost copy following the pointer) and text
  // selection are blocked, and the picture moves at most once per frame.
  let frameReq = 0;
  stage.addEventListener('dragstart', (e) => e.preventDefault());
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('is-dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (drag?.id !== e.pointerId) return;
    view.x = drag.vx + e.clientX - drag.sx;
    view.y = drag.vy + e.clientY - drag.sy;
    frameReq ||= requestAnimationFrame(() => ((frameReq = 0), apply()));
  });
  const endDrag = () => ((drag = null), stage.classList.remove('is-dragging'));
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('dblclick', (e) => {
    const r = stage.getBoundingClientRect();
    if (view.scale > fit * 1.05) fitView();
    else zoomAt(2, e.clientX - r.left, e.clientY - r.top);
  });
  dialog.addEventListener('keydown', (e) => {
    const keys = { ArrowLeft: () => list.length > 1 && go(i - 1), ArrowRight: () => list.length > 1 && go(i + 1), '+': () => zoomCenter(1.4), '=': () => zoomCenter(1.4), '-': () => zoomCenter(1 / 1.4), 0: () => fitView() };
    if (!keys[e.key] || e.target.closest?.('input, textarea')) return;
    e.preventDefault();
    keys[e.key]();
  });
  const resize = new ResizeObserver(() => (view.scale <= fit * 1.001 ? fitView() : apply()));

  function close() {
    resize.disconnect();
    if (dialog.open) dialog.close();
    dialog.remove();
  }
  dialog.addEventListener('cancel', (e) => (e.preventDefault(), close()));

  document.body.append(dialog);
  dialog.showModal();
  resize.observe(stage);
  go(i);
  stage.focus();
  return close;
}
