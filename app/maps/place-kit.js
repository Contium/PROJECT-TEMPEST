// Side-panel pieces the Planar, Cartographer and Galactic sections share: the
// Hidden / Revealed switch, kind pickers, list rows, the editor's frame and the
// HUD's "View as" switch. Same look as the World View's panel (wv-* classes).

import { el } from '../ui.js';
import { AREA_COLORS } from './place-model.js';

export const glyph = (g, cls = '') => el('span', { class: `wv-glyph ${cls}`, 'aria-hidden': 'true' }, g);
export const visBadge = (revealed) => el('span', { class: `tp-badge ${revealed ? 'tp-badge--interactive' : ''} wv-vis` }, revealed ? 'Revealed' : 'Hidden');
export const eyeBtn = (item, toggle) => el('button', { type: 'button', class: 'fd-icon-btn wv-item__eye', title: item.revealed ? 'Hide from players' : 'Reveal to players', 'aria-label': `${item.revealed ? 'Hide' : 'Reveal'} ${item.name}`, onClick: () => toggle(item) }, item.revealed ? '◉' : '◌');

/** A two- or more-way switch: [[value, label]…]. */
export function seg(label, options, value, pick) {
  return el('span', { class: 'fd-seg', role: 'group', 'aria-label': label },
    options.map(([v, text]) => el('button', { type: 'button', class: `fd-seg__btn ${value === v ? 'is-on' : ''}`, 'aria-pressed': String(value === v), onClick: () => value !== v && pick(v) }, text)));
}

/** Hidden / Revealed for a draft, with a line on what it means. */
export function visField(d, redraw, { shownNote = 'Players can see it.', hiddenNote = 'Only you can see it until you reveal it.' } = {}) {
  return el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Players'),
    seg('Visibility to players', [[false, 'Hidden'], [true, 'Revealed']], d.revealed, (v) => ((d.revealed = v), redraw())),
    el('span', { class: 'tp-dim wv-note' }, d.revealed ? shownNote : hiddenNote));
}

/** Pick one of `kinds` ([{ id, label, glyph }]). */
export function kindField(label, kinds, d, redraw, key = 'kind') {
  return el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, label),
    el('div', { class: 'wv-types', role: 'radiogroup', 'aria-label': label },
      kinds.map((k) =>
        el('label', { class: `wv-type ${d[key] === k.id ? 'is-on' : ''}` },
          el('input', { type: 'radio', name: `kind-${label}`, value: k.id, checked: d[key] === k.id, onChange: () => ((d[key] = k.id), redraw()) }),
          glyph(k.glyph), el('span', {}, k.label)))));
}

export function colorField(d, redraw) {
  return el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Colour'),
    el('div', { class: 'pl-colors', role: 'radiogroup', 'aria-label': 'Colour' },
      AREA_COLORS.map((c) => el('button', {
        type: 'button', role: 'radio', class: `pl-color ${d.color === c.id ? 'is-on' : ''}`, style: `--c:${c.hex}`, 'aria-checked': String(d.color === c.id), title: c.label, 'aria-label': c.label,
        onClick: () => ((d.color = c.id), redraw()),
      }))));
}

export const nameField = (d, { placeholder, onInput } = {}) => el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Name'),
  el('input', { class: 'tp-input', name: 'name', value: d.name, maxlength: 80, required: true, placeholder, autocomplete: 'off', onInput: (e) => ((d.name = e.target.value), onInput?.()) }));

export const descField = (d, placeholder = 'What players learn of it… (optional)') => el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Description'),
  el('textarea', { class: 'tp-textarea', name: 'description', rows: 3, maxlength: 2000, placeholder, onInput: (e) => (d.description = e.target.value) }, d.description));

export const sideHead = (title, close) => el('header', { class: 'wv-side__head' },
  el('h2', { class: 'tp-panel__title' }, title),
  close ? el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': 'Close', onClick: close }, '×') : null);

/** An editor form: header, fields, then Delete / Push on the left and Cancel / Save on the right. */
export function editorForm({ title, close, save, isNew, saveLabel, fields, left = [] }) {
  return el('form', { class: 'wv-editor', onSubmit: (e) => (e.preventDefault(), save()) },
    sideHead(title, close),
    fields,
    el('div', { class: 'wv-editor__actions' },
      left,
      el('span', { class: 'app-actions' },
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost', onClick: close }, 'Cancel'),
        el('button', { class: 'tp-frame tp-btn tp-btn--primary' }, saveLabel ?? (isNew ? 'Create' : 'Save')))));
}

/** One row of a list: pick it, and (for the GM) reveal or hide it. */
export function row({ item, g, sub, onPick, toggle, gm, hover }) {
  return el('li', { class: `wv-item ${item.revealed ? '' : 'is-hidden'}`, 'data-id': item.id },
    el('button', { type: 'button', class: 'wv-item__pick', onClick: onPick, onPointerenter: hover ? () => hover(item.id) : null, onPointerleave: hover ? () => hover(null) : null },
      glyph(g),
      el('span', { class: 'wv-item__text' }, el('span', { class: 'wv-item__name' }, item.name), el('span', { class: 'tp-dim wv-item__type' }, sub))),
    gm && toggle ? eyeBtn(item, toggle) : el('span'),
    visBadge(item.revealed));
}

/** The HUD's "View as" switch. */
// Worded like every other page's switch: "GM view | Player view".
export const viewAsField = (value, pick) => el('div', { class: 'wv-controls' }, seg('View as', [['gm', 'GM view'], ['players', 'Player view']], value, pick));

/** List tabs: [[id, label]…]. */
export const listTabs = (tabs, value, pick) => {
  const node = seg('Show', tabs, value, pick);
  node.classList.add('cm-tabs');
  return node;
};

/** Search box that keeps focus while the list redraws under it. */
export function searchBox(value, placeholder, onInput) {
  return el('input', { class: 'tp-input', type: 'search', placeholder, value, 'aria-label': 'Search', onInput: (e) => onInput(e.target.value) });
}
