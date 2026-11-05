// Small pieces the Netrunning sub-tabs share.

import { el, store } from '../ui.js';
import { imageUrl, currentProjectId } from '../api.js';
import { NET_CARD_TYPES } from '../forge/preset-model.js';
import { dvText } from './tree.js';

export const BASE = '#/combat/netrunning';

/** A net card type's name ('ice' → 'Black ICE'). */
export const typeLabel = (id) => NET_CARD_TYPES.find((t) => t.id === id)?.label ?? null;

/** The network the builder should open next (set by Networks › Edit, read once by the builder). */
const WANT_KEY = () => `tempest.${currentProjectId()}.netrun.want`;
export const wantNetwork = (id) => store.set(WANT_KEY(), id);
export function takeWantedNetwork() {
  const id = store.get(WANT_KEY());
  store.set(WANT_KEY(), '');
  return id || null;
}

/** Two letters for a type: its words' initials (Black ICE → BI), or a one-word name's first two (Password → PA). */
const sigil = (type) => {
  const words = (type ?? '?').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((w) => w[0]).join('') : words[0].slice(0, 2)).slice(0, 2).toUpperCase();
};

/** A small card: picture or type sigil, name, type and DV. Draggable when `drag` is set (the builder's palette). */
export function cardChip(c, { href = null, drag = false, onClick = null, title = null } = {}) {
  const type = typeLabel(c.category);
  const body = [
    c.image ? el('img', { class: 'nr-chip__image', src: imageUrl(c.image), alt: '', loading: 'lazy', draggable: 'false' })
      : el('span', { class: 'nr-chip__image nr-chip__sigil', 'aria-hidden': 'true' }, sigil(type)),
    el('span', { class: 'nr-chip__text' },
      el('span', { class: 'nr-chip__name' }, c.name),
      el('span', { class: 'tp-dim nr-chip__meta' }, [type ?? 'Net card', c.dv ? dvText(c.dv) : null].filter(Boolean).join(' · '))),
  ];
  const attrs = {
    class: `nr-chip nr-type--${c.category}`, title,
    draggable: drag ? 'true' : null,
    onDragstart: drag ? (e) => {
      e.dataTransfer.setData('application/x-tempest-card', c.id);
      e.dataTransfer.effectAllowed = 'copy';
    } : null,
  };
  if (href) return el('a', { ...attrs, href }, body);
  return el('button', { ...attrs, type: 'button', onClick }, body);
}
