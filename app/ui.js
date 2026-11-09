// DOM helpers shared by the GM window and the player screen.

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'multiple', 'indeterminate']);

/**
 * el('button', { class: 'tp-btn', onClick: fn, disabled: true }, 'Save')
 * Strings/numbers become text; null/false children are skipped; arrays flatten.
 * DOM properties (value, checked…) are set after children so <select value> works.
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  const later = [];
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style') node.style.cssText = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (PROPS.has(key)) later.push([key, value]);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(
    ...children
      .flat(Infinity)
      .filter((c) => c != null && c !== false)
      .map((c) => (c instanceof Node ? c : String(c))),
  );
  for (const [key, value] of later) node[key] = value;
  return node;
}

// --- Toasts -------------------------------------------------------------------------

export function toast(message, { tone = 'info', details = [], timeout = 5000, link, action } = {}) {
  let host = document.getElementById('toasts');
  if (!host) document.body.append((host = el('div', { class: 'app-toasts', id: 'toasts', 'aria-live': 'polite' })));
  const close = () => node.remove();
  const node = el('div', { class: `tp-alert tp-alert--${tone} app-toast`, role: tone === 'danger' ? 'alert' : 'status' },
    el('div', { class: 'app-toast__body' },
      el('p', { class: 'tp-alert__title' }, message),
      details.length ? el('p', {}, details.slice(0, 6).join(' · ')) : null),
    link ? el('a', { class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive', href: link.href, onClick: () => close() }, link.label) : null,
    action ? el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive', onClick: () => (close(), action.run()) }, action.label) : null,
    el('button', { type: 'button', class: 'tp-btn tp-btn--ghost tp-btn--sm', 'aria-label': 'Dismiss', onClick: close }, '×'));
  host.append(node);
  if (timeout) setTimeout(close, timeout);
  return close;
}

export const toastError = (err) => toast(err.problems?.length > 1 ? 'That didn\'t work' : err.message, { tone: 'danger', details: err.problems?.length > 1 ? err.problems : [], timeout: 9000 });

// --- Confirm dialog ---------------------------------------------------------------------

export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'tp-dialog app-dialog' },
      el('form', { method: 'dialog', class: 'tp-frame tp-panel' },
        el('header', { class: 'tp-panel__head' }, el('h2', { class: 'tp-panel__title' }, title)),
        el('div', { class: 'tp-panel__body' }, el('p', {}, body)),
        el('footer', { class: 'tp-panel__foot app-actions' },
          el('button', { class: 'tp-frame tp-btn tp-btn--ghost', value: 'cancel' }, 'Cancel'),
          el('button', { class: `tp-frame tp-btn ${danger ? 'tp-btn--danger' : 'tp-btn--primary'}`, value: 'ok' }, confirmLabel))));
    // Answer from the button itself (or Esc), not the dialog's 'close' event, which
    // some embedded browsers never deliver.
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
      if (dialog.open) dialog.close();
      dialog.remove();
    };
    dialog.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      finish(e.submitter?.value === 'ok');
    });
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(false);
    });
    dialog.addEventListener('close', () => finish(dialog.returnValue === 'ok'));
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** Save text as a file the viewer downloads. */
export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: filename, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** localStorage that never throws (private windows, blocked storage). */
export const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* not essential */
    }
  },
};

/**
 * A button that opens a small menu below it: less-used actions kept one click away.
 * menuButton(label, items, { title, cls, align })
 *   items  () => nodes (rebuilt each time it opens). Buttons inside close the menu when clicked,
 *          unless they carry data-keep-open.
 * Closes on Esc, on a click elsewhere, and after an action; focus goes back to the button.
 */
export function menuButton(label, items, { title = null, cls = '', align = 'right' } = {}) {
  const button = el('button', { type: 'button', class: `tp-frame tp-btn ${cls}`, 'aria-haspopup': 'true', 'aria-expanded': 'false', title }, label);
  // The open menu sits on the page itself (themes clip framed panels), fixed under the button.
  const menu = el('div', { class: 'tp-frame tp-panel app-menu', role: 'group', 'aria-label': typeof label === 'string' ? label.replace(/[^\w\s]/g, '').trim() : null, hidden: true });
  const wrap = el('span', { class: 'app-menu__wrap' }, button);
  // Listens on the page only while open, so menus redrawn often leave nothing behind.
  const outside = (e) => !wrap.contains(e.target) && !menu.contains(e.target) && close();
  const place = () => {
    if (!button.isConnected) return close();
    const r = button.getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom + 6)}px`;
    const left = align === 'left' ? r.left : r.right - menu.offsetWidth;
    menu.style.left = `${Math.round(Math.max(8, Math.min(left, innerWidth - menu.offsetWidth - 8)))}px`;
  };
  const leave = () => close();
  const close = (focus = false) => {
    if (menu.hidden) return;
    menu.hidden = true;
    menu.remove();
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside);
    removeEventListener('resize', place);
    removeEventListener('scroll', place, true);
    removeEventListener('hashchange', leave);
    if (focus && button.isConnected) button.focus();
  };
  button.addEventListener('click', () => {
    if (!menu.hidden) return close();
    menu.replaceChildren(...[items()].flat().filter(Boolean));
    menu.hidden = false;
    document.body.append(menu);
    place();
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside);
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    addEventListener('hashchange', leave); // another page: the menu belongs to the last one
    menu.querySelector('button, select, input')?.focus();
  });
  menu.addEventListener('click', (e) => {
    const hit = e.target.closest('button');
    if (hit && !hit.hasAttribute('data-keep-open')) close();
  });
  const onEsc = (e) => e.key === 'Escape' && !menu.hidden && (e.stopPropagation(), close(true));
  wrap.addEventListener('keydown', onEsc);
  menu.addEventListener('keydown', onEsc);
  return { node: wrap, button, close };
}
