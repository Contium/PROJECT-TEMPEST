// Draws a NET architecture as the rulebook does: chamfered boxes in rows, top to
// bottom, joined by arrowed lines that branch and merge (layout() in network-model.js
// decides where each node sits). The Network Builder, the GM's run view and the
// player screen all draw with it; each says what goes in a box.

import { el } from '../ui.js';
import { layout } from './network-model.js';

const SVG = 'http://www.w3.org/2000/svg';
const W = 200; // a box
const H = 84;
const GAP_X = 36;
const GAP_Y = 62;
const UX = W + GAP_X;
const UY = H + GAP_Y;
const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
let markers = 0;

/** "8" → "DV8"; anything already worded stays as written. */
export const dvText = (dv) => (!dv ? '' : /^\d+$/.test(String(dv).trim()) ? `DV${String(dv).trim()}` : String(dv).trim());

/** A box's usual text: type above, then "Title DV8 ×2". */
export function nodeText({ type = null, title, dv = '', count = 1 }) {
  return [
    type ? el('span', { class: 'nr-node__type tp-label' }, type) : null,
    el('span', { class: 'nr-node__title' }, title, dv ? el('span', { class: 'nr-node__dv' }, ` ${dvText(dv)}`) : null, count > 1 ? el('span', { class: 'nr-node__count' }, ` ×${count}`) : null),
  ];
}

/**
 * renderTree(net, opts) → { node, cleanup }
 *   content(node)         what goes in a box (default: its label)
 *   classOf(node)         extra classes for a box ('is-hidden', …)
 *   selected              the id of the box drawn as selected
 *   onSelect(id)          a box was clicked (or Enter/Space on it); boxes are buttons only with this
 *   onDropCard(id, card)  a card was dropped on a box (id) or on empty space (null): the builder's palette
 *   fit                   scale the drawing down to fit its frame (the player screen)
 *   empty                 what to show when there are no nodes
 */
export function renderTree(net, opts = {}) {
  const { content = (n) => n.label || n.title || '', classOf = () => '', selected = null, onSelect = null, onDropCard = null, fit = false, empty = null } = opts;
  const frame = el('div', { class: `nr-canvas ${fit ? 'nr-canvas--fit' : ''}` });
  if (!net.nodes.length) {
    frame.append(empty ?? el('p', { class: 'tp-muted nr-canvas__empty' }, 'Nothing here yet.'));
    wireDrop(frame, null, onDropCard);
    return { node: frame, cleanup: () => {} };
  }
  const { pos, cols, rows } = layout(net);
  const width = cols * UX - GAP_X;
  const height = rows * UY - GAP_Y;
  const stage = el('div', { class: 'nr-tree', style: `width:${width}px;height:${height}px` });

  // Lines first, so the boxes sit on top of them.
  const marker = `nr-arrow-${++markers}`;
  const lines = svg('svg', { class: 'nr-tree__lines', width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' });
  const defs = svg('defs');
  const m = svg('marker', { id: marker, viewBox: '0 0 12 12', refX: '11', refY: '6', markerWidth: '12', markerHeight: '12', markerUnits: 'userSpaceOnUse', orient: 'auto' });
  m.append(svg('path', { d: 'M0,0 L12,6 L0,12 Z', class: 'nr-tree__arrow' }));
  defs.append(m);
  lines.append(defs);
  for (const n of net.nodes) {
    for (const p of n.parents) {
      if (!pos[p]) continue;
      const px = pos[p].x * UX + W / 2;
      const py = pos[p].y * UY + H;
      const cx = pos[n.id].x * UX + W / 2;
      const cy = pos[n.id].y * UY;
      const mid = cy - GAP_Y / 2;
      const dx = cx - px;
      const c = Math.min(12, Math.abs(dx) / 2);
      const d = Math.abs(dx) < 0.5
        ? `M${px},${py} V${cy - 1}`
        : `M${px},${py} V${mid - c} L${px + Math.sign(dx) * c},${mid} H${cx - Math.sign(dx) * c} L${cx},${mid + c} V${cy - 1}`;
      lines.append(svg('path', { d, class: `nr-tree__line ${opts.lineClass?.(p, n.id) ?? ''}`, 'marker-end': `url(#${marker})` }));
    }
  }
  stage.append(lines);

  for (const n of net.nodes) {
    const box = el(onSelect ? 'button' : 'div', {
      ...(onSelect ? { type: 'button', onClick: () => onSelect(n.id) } : {}),
      class: `nr-node ${n.id === selected ? 'is-selected' : ''} ${classOf(n)}`,
      style: `left:${pos[n.id].x * UX}px;top:${pos[n.id].y * UY}px;width:${W}px;height:${H}px`,
      'data-node': n.id,
      'aria-pressed': onSelect ? String(n.id === selected) : null,
    }, el('span', { class: 'nr-node__box' }, content(n)));
    wireDrop(box, n.id, onDropCard);
    stage.append(box);
  }
  frame.append(stage);
  wireDrop(frame, null, onDropCard);

  let cleanup = () => {};
  if (fit && typeof ResizeObserver !== 'undefined') {
    const scale = () => {
      // Scaled from its top left corner; negative margins give back the space it no longer takes.
      const s = Math.max(0.2, Math.min(1, (frame.clientWidth - 8) / width, (frame.clientHeight - 8) / height));
      stage.style.transform = `scale(${s})`;
      stage.style.marginRight = `${-(1 - s) * width}px`;
      stage.style.marginBottom = `${-(1 - s) * height}px`;
    };
    const ro = new ResizeObserver(scale);
    ro.observe(frame);
    cleanup = () => ro.disconnect();
  }
  return { node: frame, cleanup };
}

/** Accept cards dragged from the builder's palette. */
function wireDrop(target, id, onDropCard) {
  if (!onDropCard) return;
  const has = (e) => [...(e.dataTransfer?.types ?? [])].includes('application/x-tempest-card');
  target.addEventListener('dragover', (e) => {
    if (!has(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    target.classList.add('is-drop');
  });
  target.addEventListener('dragleave', () => target.classList.remove('is-drop'));
  target.addEventListener('drop', (e) => {
    if (!has(e)) return;
    e.preventDefault();
    e.stopPropagation();
    target.classList.remove('is-drop');
    onDropCard(id, e.dataTransfer.getData('application/x-tempest-card'));
  });
}
