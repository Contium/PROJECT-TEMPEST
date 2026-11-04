// Pushing from the GM window to the player screen. Every push goes through the
// server (PUT /api/display), which builds the players' copy itself; see
// app/push/push-model.js for what each mode shows.

import { el, toast, toastError, confirmDialog } from '../ui.js';
import { display, currentProjectId } from '../api.js';
import { TONES } from './push-model.js';

/** The theme the GM is looking at, so the player screen matches it. */
const theme = () => document.documentElement.dataset.theme || undefined;

// Who pushes go to: 'all' (every screen) or a list of screen names, picked in the top bar
// (see targetPicker). Every push button follows it. Kept for this window's session only, so
// a fresh GM window always starts on "All screens".
let target = 'all';
try {
  const saved = JSON.parse(sessionStorage.getItem('tempest.push.to') ?? '"all"');
  if (Array.isArray(saved) && saved.length) target = saved.filter((n) => typeof n === 'string');
} catch {
  /* no storage */
}
const targetListeners = new Set();
export const getTarget = () => target;
/** Push to 'all', or to these screen names (an empty list means all). */
export function setTarget(to) {
  target = Array.isArray(to) && to.length ? [...to] : 'all';
  try {
    sessionStorage.setItem('tempest.push.to', JSON.stringify(target));
  } catch {
    /* no storage */
  }
  for (const fn of targetListeners) fn(target);
}
export const onTarget = (fn) => (targetListeners.add(fn), () => targetListeners.delete(fn));
/** "every screen", "Alex", "Alex and Sam", "3 screens". */
export const targetLabel = (to = target) => (to === 'all' ? 'every screen' : to.length === 1 ? to[0] : to.length === 2 ? `${to[0]} and ${to[1]}` : `${to.length} screens`);

/**
 * Push a view; a project-scoped one gets the open project. Goes to the screens picked in
 * the top bar unless `to` says otherwise. Toasts what went up, with Clear to take it down.
 * Resolves to the display, or null if it failed.
 */
export async function push(request, { to = target } = {}) {
  try {
    const scoped = request.mode === 'message' || request.mode === 'ambient' ? request : { project: currentProjectId(), ...request };
    const shown = await display.push({ ...scoped, theme: theme(), to });
    const who = to === 'all' ? '' : ` for ${targetLabel(to)}`;
    if (shown.mode !== 'ambient') toast(`On screen${who}: ${shown.title}`, { tone: 'success', action: { label: 'Clear', run: () => clear({ to }) } });
    return shown;
  } catch (err) {
    toastError(err);
    return null;
  }
}

/** Back to standing by (on the picked screens). */
export async function clear({ to = target } = {}) {
  try {
    await display.push({ mode: 'ambient', theme: theme(), to });
    toast(to === 'all' ? 'Player screens cleared' : `Cleared for ${targetLabel(to)}`);
  } catch (err) {
    toastError(err);
  }
}

/**
 * Push something that's hidden from players until revealed (a POI): ask first,
 * then `reveal()` (which saves it revealed) and push. Resolves to true once pushed.
 */
export async function revealAndPush(thing, reveal, request) {
  if (!thing.revealed) {
    const ok = await confirmDialog({
      title: `Reveal "${thing.name}"?`,
      body: `"${thing.name}" is hidden from players. Pushing it reveals it to them first.`,
      confirmLabel: 'Reveal & push',
    });
    if (!ok) return false;
    try {
      await reveal();
    } catch (err) {
      toastError(err);
      return false;
    }
  }
  return Boolean(await push(request));
}

/** A small "Push" button. */
export const pushButton = (label, onClick, { title = 'Show this on the player screen', ghost = false } = {}) =>
  el('button', { type: 'button', class: `tp-frame tp-btn tp-btn--sm ${ghost ? 'tp-btn--ghost' : 'tp-btn--interactive'} push-btn`, title, onClick }, `⇪ ${label}`);

/** Compose an announcement or alert and push it. */
export function messageDialog() {
  const heading = el('input', { class: 'tp-input', name: 'title', placeholder: 'e.g. INCOMING TRANSMISSION', maxlength: 120, autocomplete: 'off' });
  const text = el('textarea', { class: 'tp-textarea', name: 'text', required: true, rows: 4, placeholder: 'What the players see', maxlength: 2000 });
  const tone = el('select', { class: 'tp-select', name: 'tone' }, TONES.map((t) => el('option', { value: t.id }, t.label)));
  const field = (label, input) => el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, label), input);
  const dialog = el('dialog', { class: 'tp-dialog app-dialog' },
    el('form', { method: 'dialog', class: 'tp-frame tp-panel' },
      el('header', { class: 'tp-panel__head' }, el('h2', { class: 'tp-panel__title' }, 'Push a message')),
      el('div', { class: 'tp-panel__body push-dialog' }, field('Heading (optional)', heading), field('Message', text), field('Tone', tone)),
      el('footer', { class: 'tp-panel__foot app-actions' },
        el('button', { class: 'tp-frame tp-btn tp-btn--ghost', value: 'cancel', formnovalidate: true }, 'Cancel'),
        el('button', { class: 'tp-frame tp-btn tp-btn--primary', value: 'ok' }, 'Push to screen'))));
  // Answer from the buttons (some embedded browsers never send 'close').
  const done = () => {
    if (dialog.open) dialog.close();
    dialog.remove();
  };
  dialog.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const ok = e.submitter?.value === 'ok';
    if (ok && !text.value.trim()) return text.focus();
    done();
    if (ok) push({ mode: 'message', title: heading.value, text: text.value, tone: tone.value });
  });
  dialog.addEventListener('cancel', (e) => (e.preventDefault(), done()));
  document.body.append(dialog);
  dialog.showModal();
  text.focus();
}

/**
 * Follow what's on screen (for the top bar): calls onDisplay(everyone's display) and
 * onScreens([{ name, online, personal, mode, title }]) now and whenever they change.
 */
export function watchDisplay(onDisplay, onScreens = () => {}) {
  const source = new EventSource('/api/display/stream');
  const on = (name, fn) => source.addEventListener(name, (e) => {
    try {
      fn(JSON.parse(e.data));
    } catch {
      /* ignore a garbled event */
    }
  });
  on('display', onDisplay);
  on('screens', onScreens);
  return () => source.close();
}

/**
 * The top bar's "Push to" picker: every screen, or some of them by name. `screens()`
 * gives the latest list (from watchDisplay); call the returned refresh() when it changes.
 */
export function targetPicker(screens) {
  const button = el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm push-to', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Who pushes go to' });
  const menu = el('div', { class: 'tp-frame tp-panel push-to__menu', role: 'dialog', 'aria-label': 'Push to', hidden: true });
  const wrap = el('span', { class: 'push-to__wrap' }, button, menu);
  const label = () => {
    button.textContent = `To: ${target === 'all' ? 'All screens' : targetLabel()} ▾`;
    button.classList.toggle('tp-btn--interactive', target !== 'all');
  };
  const chosen = () => new Set(target === 'all' ? [] : target.map((n) => n.toLowerCase()));
  function render() {
    const picked = chosen();
    const list = screens();
    const all = el('label', { class: 'push-to__row' },
      el('input', { type: 'radio', name: 'push-to-all', checked: target === 'all', onChange: () => (setTarget('all'), render()) }),
      el('span', { class: 'push-to__name' }, 'All screens'),
      el('span', { class: 'tp-dim push-to__what' }, `${list.filter((s) => s.online).length} watching`));
    const rows = list.map((s) => el('label', { class: `push-to__row ${s.online ? '' : 'is-offline'}` },
      el('input', {
        type: 'checkbox', checked: picked.has(s.name.toLowerCase()),
        onChange: (e) => {
          const names = target === 'all' ? [] : target.filter((n) => n.toLowerCase() !== s.name.toLowerCase());
          if (e.target.checked) names.push(s.name);
          setTarget(names);
          render();
        },
      }),
      el('span', { class: `push-to__dot ${s.online ? 'is-on' : ''}`, title: s.online ? 'Watching now' : 'Not connected', 'aria-label': s.online ? 'watching now' : 'not connected' }),
      el('span', { class: 'push-to__name' }, s.name),
      el('span', { class: 'tp-dim push-to__what', title: s.personal ? 'Sent to this screen alone' : 'What every screen shows' }, `${s.personal ? '◆ ' : ''}${s.mode === 'ambient' ? 'Standing by' : s.title ?? s.mode}`)));
    menu.replaceChildren(
      el('p', { class: 'tp-label push-to__head' }, 'Push to'),
      all,
      rows.length ? el('div', { class: 'push-to__list' }, rows) : el('p', { class: 'tp-dim push-to__empty' }, 'No named screens yet. Each player screen asks for a name when it opens.'),
      el('p', { class: 'tp-dim push-to__hint' }, 'Pushes, Message and Clear go to the screens picked here. Pushing to all screens replaces what any one screen was sent.'));
    label();
  }
  const close = () => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  button.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) render();
  });
  document.addEventListener('pointerdown', (e) => !wrap.contains(e.target) && close());
  wrap.addEventListener('keydown', (e) => e.key === 'Escape' && (close(), button.focus()));
  onTarget(label);
  label();
  return { node: wrap, refresh: () => (menu.hidden ? label() : render()) };
}
