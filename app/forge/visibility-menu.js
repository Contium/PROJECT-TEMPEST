// The GM's on-the-spot visibility control: a small button beside a field (on an
// entry's page) or a part of a screamsheet, showing what players get of it, and a
// menu to change that there and then:
//   ◉ Reveal                      players read it
//   ▒ Obscure  Redacted · Static · Encrypted · Custom text…   they know something is there
//   ✎ Shown text…                 they read your words instead (fields only)
//   ⊘ Hide                        they get nothing, not even its name
// Picking one calls onPick({ visibility, style?, text?, shown? }); the caller saves it.

import { el, toastError } from '../ui.js';

export const OBSCURE_STYLES = [
  { id: 'redacted', label: 'Redacted', glyph: '▬' },
  { id: 'static', label: 'Static', glyph: '░' },
  { id: 'encrypted', label: 'Encrypted', glyph: '⌗' },
  { id: 'text', label: 'Custom text…', glyph: '❝' },
];

/** What the button says for a state. */
export function stateLabel({ visibility, style }) {
  if (visibility === 'revealed') return { glyph: '◉', label: 'Revealed' };
  if (visibility === 'shown') return { glyph: '✎', label: 'Shown' };
  if (visibility === 'hidden') return { glyph: '⊘', label: 'Hidden' };
  const s = OBSCURE_STYLES.find((o) => o.id === style) ?? OBSCURE_STYLES[0];
  return { glyph: '▒', label: s.id === 'text' ? 'Custom text' : s.label };
}

let openMenu = null;
const closeMenu = () => {
  openMenu?.remove();
  openMenu = null;
};
document.addEventListener('pointerdown', (e) => openMenu && !openMenu.contains(e.target) && !e.target.closest?.('.vis-ctl') && closeMenu());
window.addEventListener('resize', closeMenu);
document.addEventListener('scroll', closeMenu, true);

/** Ask for a piece of text (custom obscured text, or what players read). Resolves to the text, or null. */
function askText({ title, hint, value, max }) {
  return new Promise((resolve) => {
    const input = el('textarea', { class: 'tp-textarea', rows: 3, maxlength: max, value: value ?? '' });
    const dialog = el('dialog', { class: 'tp-dialog app-dialog' },
      el('form', { method: 'dialog', class: 'tp-frame tp-panel' },
        el('header', { class: 'tp-panel__head' }, el('h2', { class: 'tp-panel__title' }, title)),
        el('div', { class: 'tp-panel__body' }, el('p', { class: 'tp-muted' }, hint), input),
        el('footer', { class: 'tp-panel__foot app-actions' },
          el('button', { class: 'tp-frame tp-btn tp-btn--ghost', value: 'cancel', formnovalidate: true }, 'Cancel'),
          el('button', { class: 'tp-frame tp-btn tp-btn--primary', value: 'ok' }, 'Save'))));
    const finish = (v) => {
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(v);
    };
    dialog.querySelector('form').addEventListener('submit', (e) => (e.preventDefault(), finish(e.submitter?.value === 'ok' ? input.value.trim() : null)));
    dialog.addEventListener('cancel', (e) => (e.preventDefault(), finish(null)));
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  });
}

/**
 * visibilityControl({ state, name, onPick, shown = true })
 *   state   { visibility: revealed|shown|rumored|hidden, style, text, shown }
 *   name    what the field or part is called (for labels: "Name", "Headline")
 *   onPick  (next) → Promise; called with the GM's choice
 *   shown   offer "Shown text…" (entries' fields; screamsheet parts don't have it)
 */
export function visibilityControl({ state, name, onPick, shown: offerShown = true }) {
  const now = stateLabel(state);
  const button = el('button', {
    type: 'button', class: `vis-ctl vis-ctl--${state.visibility}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    title: `${name}: ${now.label} to players. Click to change.`, 'aria-label': `${name}: ${now.label} to players`,
  }, el('span', { class: 'vis-ctl__glyph', 'aria-hidden': 'true' }, now.glyph), el('span', { class: 'vis-ctl__label' }, now.label));

  async function pick(next) {
    closeMenu();
    if (next.visibility === 'rumored' && next.style === 'text') {
      const text = await askText({ title: `${name}: custom text`, hint: 'Players see these words where the contents would be, e.g. "Nobody knows his real name".', value: state.text, max: 200 });
      if (text == null) return;
      next = { ...next, text };
    }
    if (next.visibility === 'shown') {
      const text = await askText({ title: `${name}: what players read`, hint: 'Players read this instead of the real contents.', value: state.shown, max: 4000 });
      if (text == null) return;
      next = { ...next, shown: text };
    }
    button.disabled = true;
    try {
      await onPick(next);
    } catch (err) {
      toastError(err);
    } finally {
      button.disabled = false;
    }
  }

  const item = (glyph, label, next, current, hint) => el('button', {
    type: 'button', role: 'menuitemradio', class: `vis-menu__item ${current ? 'is-on' : ''}`, 'aria-checked': String(current), title: hint,
    onClick: () => pick(next),
  }, el('span', { class: 'vis-menu__glyph', 'aria-hidden': 'true' }, glyph), label);

  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (openMenu?.dataset.for === name && openMenu.owner === button) return closeMenu();
    closeMenu();
    const v = state.visibility;
    const menu = el('div', { class: 'tp-frame tp-panel vis-menu', role: 'menu', 'aria-label': `What players get of ${name}` },
      el('p', { class: 'tp-label vis-menu__head' }, name),
      item('◉', 'Reveal', { visibility: 'revealed' }, v === 'revealed', 'Players read it'),
      el('p', { class: 'tp-dim vis-menu__group' }, 'Obscure'),
      OBSCURE_STYLES.map((o) => item(o.glyph, o.label, { visibility: 'rumored', style: o.id }, v === 'rumored' && (state.style ?? 'redacted') === o.id, 'Players see that something is here, not what')),
      offerShown ? item('✎', 'Shown text…', { visibility: 'shown' }, v === 'shown', 'Players read your words instead') : null,
      item('⊘', 'Hide', { visibility: 'hidden' }, v === 'hidden', 'Players get nothing of it, not even its name'));
    menu.dataset.for = name;
    menu.owner = button;
    menu.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') (closeMenu(), button.focus());
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        const items = [...menu.querySelectorAll('.vis-menu__item')];
        const i = items.indexOf(document.activeElement);
        items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        ev.preventDefault();
      }
    });
    document.body.append(menu);
    // Below the button (above it when there's no room), inside the window.
    const r = button.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const top = r.bottom + 4 + m.height > innerHeight ? Math.max(4, r.top - 4 - m.height) : r.bottom + 4;
    menu.style.left = `${Math.max(4, Math.min(innerWidth - m.width - 4, r.left))}px`;
    menu.style.top = `${top}px`;
    openMenu = menu;
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector('.vis-menu__item.is-on, .vis-menu__item')?.focus();
  });
  return button;
}
