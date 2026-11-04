// Full screen for the player screen: a corner button (and the F key) that fills
// the whole display, hiding the browser's own bars. The button fades away when
// the pointer rests, and comes back on any movement or touch.
//
// Phones that can't go full screen from a web page (iPhone Safari) get a tip
// instead: add the player screen to the Home Screen, which opens it full screen
// (app/player.webmanifest and the Apple web-app tags added here).

import { el } from '../ui.js';

const IDLE_MS = 2500;

const doc = document;
const fsElement = () => doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
const canFullscreen = () => Boolean(doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled);
/** Opened from the Home Screen as an app: already full screen. */
const standalone = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;

function enter() {
  const root = doc.documentElement;
  const request = root.requestFullscreen ?? root.webkitRequestFullscreen;
  return Promise.resolve(request?.call(root, { navigationUI: 'hide' }));
}
function leave() {
  const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
  return Promise.resolve(exit?.call(doc));
}

/** Home-screen install hints, so phones can open the player screen as a full-screen app. */
function addWebAppTags() {
  const head = doc.head;
  const add = (tag, attrs) => {
    if (head.querySelector(`${tag}[${Object.keys(attrs)[0]}="${Object.values(attrs)[0]}"]`)) return;
    head.append(el(tag, attrs));
  };
  add('link', { rel: 'manifest', href: '/app/player.webmanifest' });
  add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  add('meta', { name: 'mobile-web-app-capable', content: 'yes' });
  add('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' });
  add('meta', { name: 'apple-mobile-web-app-title', content: 'TEMPEST' });
  add('link', { rel: 'apple-touch-icon', href: '/assets/tempest-256.png' });
}

/** Mount the control into the player screen's frame; returns its teardown. */
export function fullscreenControl(frame) {
  addWebAppTags();
  if (standalone()) return () => {};

  const tipText = el('p', {});
  const tip = el('div', { class: 'scr-fs__tip', role: 'dialog', 'aria-label': 'Full screen on this device', hidden: true },
    el('p', { class: 'tp-label' }, 'Full screen on this device'),
    tipText,
    el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => (tip.hidden = true) }, 'Got it'));
  const button = el('button', {
    type: 'button', class: 'tp-frame tp-btn tp-btn--sm scr-fs',
    onClick: () => toggle(),
  });
  frame.append(button, tip);

  function label() {
    const on = Boolean(fsElement());
    button.textContent = on ? '⤡ Exit full screen' : '⤢ Full screen';
    button.title = on ? 'Leave full screen (F or Esc)' : 'Fill the whole screen (F)';
    button.setAttribute('aria-pressed', String(on));
    frame.classList.toggle('is-fullscreen', on);
  }
  const HOME_SCREEN = 'Add the player screen to your Home Screen instead: tap Share, then "Add to Home Screen", and open it from there.';
  function explain(text) {
    tipText.textContent = text;
    tip.hidden = false;
  }
  function toggle() {
    if (!canFullscreen()) return tip.hidden ? explain(`This browser can't fill the screen from a web page. ${HOME_SCREEN}`) : (tip.hidden = true);
    tip.hidden = true;
    (fsElement() ? leave() : enter()).catch(() => explain(`This browser didn't allow full screen. Try again, or use its own full-screen option (often F11). On a phone: ${HOME_SCREEN}`));
  }

  // Fade the button out while the pointer rests; any movement or touch brings it back.
  let idle = 0;
  const wake = () => {
    frame.classList.remove('is-idle');
    clearTimeout(idle);
    idle = setTimeout(() => frame.classList.add('is-idle'), IDLE_MS);
  };
  const onKey = (e) => {
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey && !doc.querySelector('dialog[open]') && !e.target.closest?.('input, textarea, select')) {
      e.preventDefault();
      toggle();
    }
  };
  doc.addEventListener('fullscreenchange', label);
  doc.addEventListener('webkitfullscreenchange', label);
  doc.addEventListener('keydown', onKey);
  for (const type of ['pointermove', 'pointerdown', 'touchstart', 'keydown']) frame.addEventListener(type, wake, { passive: true });
  label();
  wake();

  return () => {
    clearTimeout(idle);
    doc.removeEventListener('fullscreenchange', label);
    doc.removeEventListener('webkitfullscreenchange', label);
    doc.removeEventListener('keydown', onKey);
    button.remove();
    tip.remove();
  };
}
