// DOM helpers and small shared widgets.

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

export const frame = (classes, ...children) => el('article', { class: `tp-frame tp-panel ${classes}`.trim() }, ...children);

export function panelHead(title, ...extras) {
  return el('header', { class: 'tp-panel__head' }, el('h2', { class: 'tp-panel__title' }, title), ...extras);
}

export const TIER_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

export function tierBadge(tier) {
  return tier ? el('span', { class: 'tp-badge', 'data-tier': tier }, TIER_NAMES[tier - 1]) : null;
}

export function visibilityBadge(visibility) {
  if (visibility === 'hidden') return el('span', { class: 'tp-badge tp-badge--danger', title: 'Only the GM can see this' }, 'GM only');
  if (visibility === 'rumored') return el('span', { class: 'tp-badge tp-badge--warning', title: 'Players see the name and rumour only' }, 'Rumour');
  return null;
}

export function emptyState(title, text, ...actions) {
  return el('div', { class: 'app-empty' }, el('p', { class: 'tp-h3' }, title), text ? el('p', { class: 'tp-muted' }, text) : null, ...actions);
}

// --- Toasts ---------------------------------------------------------------

export function toast(message, { tone = 'info', details = [], action, timeout = 5000 } = {}) {
  const host = document.getElementById('toasts');
  const close = () => node.remove();
  const node = el(
    'div',
    { class: `tp-alert tp-alert--${tone} app-toast`, role: tone === 'danger' ? 'alert' : 'status' },
    el(
      'div',
      { class: 'app-toast__body' },
      el('p', { class: 'tp-alert__title' }, message),
      details.length ? el('p', {}, details.join(' · ')) : null,
    ),
    action ? el('button', { class: 'tp-btn tp-btn--ghost tp-btn--sm', onClick: () => (action.run(), close()) }, action.label) : null,
    el('button', { class: 'tp-btn tp-btn--ghost tp-btn--sm', 'aria-label': 'Dismiss', onClick: close }, '×'),
  );
  host.append(node);
  if (timeout) setTimeout(close, timeout);
  return close;
}

export function toastError(err) {
  const details = err.details?.length > 1 ? err.details : [];
  // "ops[0]: …" locates the failing op for API callers; people don't need it.
  toast(String(err.message).replace(/^ops\[\d+\]: /, ''), { tone: 'danger', details, timeout: 8000 });
}

// --- Confirm dialog ---------------------------------------------------------

export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dialog = el(
      'dialog',
      { class: 'tp-dialog' },
      el(
        'form',
        { method: 'dialog', class: 'tp-frame tp-panel' },
        panelHead(title),
        el('div', { class: 'tp-panel__body' }, el('p', {}, body)),
        el(
          'footer',
          { class: 'tp-panel__foot app-actions' },
          el('button', { class: 'tp-frame tp-btn tp-btn--ghost', value: 'cancel' }, 'Cancel'),
          el('button', { class: `tp-frame tp-btn ${danger ? 'tp-btn--danger' : 'tp-btn--primary'}`, value: 'ok' }, confirmLabel),
        ),
      ),
    );
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok');
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
