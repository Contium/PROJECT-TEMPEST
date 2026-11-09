// "Player screen on your network" (in Project settings): share the player screen
// with phones, tablets and TVs on the same network, with a QR code to open it.
// It's one switch for the whole app, not per project; it applies at once.

import { el, toast, toastError, confirmDialog, store } from '../ui.js';
import { lan as api, gmLan, role } from '../api.js';
import qrcode from '../vendor/qrcode-generator/qrcode.js';

const PICK_KEY = 'tempest.lan.address';

/** A QR code as an SVG: dark modules on white with the quiet zone scanners need. */
export function qrSvg(text, { label = 'QR code' } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  const size = n + quiet * 2;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'st-qr__code');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', size);
  bg.setAttribute('height', size);
  bg.setAttribute('fill', '#fff');
  const fg = document.createElementNS(ns, 'path');
  fg.setAttribute('d', d);
  fg.setAttribute('fill', '#000');
  svg.append(bg, fg);
  return svg;
}

/** The QR code big, in a dialog (drawn above everything, theme overlays included). */
function showLarge(link, caption = 'Scan to open the player screen') {
  const dialog = el('dialog', { class: 'st-qr-big', 'aria-label': 'QR code', onClick: () => close() },
    el('div', { class: 'st-qr-big__code' }, qrSvg(link.url, { label: `QR code for ${link.url}` })),
    el('p', { class: 'st-qr-big__caption' }, caption),
    el('p', { class: 'st-qr-big__url' }, link.url),
    el('p', { class: 'st-qr-big__hint' }, 'Click anywhere or press Esc to close'));
  const close = () => {
    if (dialog.open) dialog.close();
    dialog.remove();
  };
  dialog.addEventListener('cancel', (e) => (e.preventDefault(), close()));
  document.body.append(dialog);
  dialog.showModal();
}

/** The card: mount it once; it fetches and redraws itself. */
export function networkCard() {
  const body = el('div', { class: 'tp-panel__body st-net' }, el('p', { class: 'tp-dim' }, 'Checking…'));
  const card = el('section', { class: 'tp-frame tp-panel st-net-panel', 'aria-label': 'Player screen on your network' },
    el('header', { class: 'tp-panel__head' },
      el('h2', { class: 'tp-panel__title' }, 'Player screen on your network'),
      el('span', { class: 'tp-dim' }, 'Players open it on their own phones, tablets or a TV. One setting for every project.')),
    body);
  let status = null;
  let busy = false;

  async function run(work) {
    busy = true;
    draw();
    try {
      status = await work();
    } catch (err) {
      toastError(err);
    }
    busy = false;
    draw();
  }

  function draw() {
    if (!status) return;
    const links = status.links;
    const picked = links.find((l) => l.address === store.get(PICK_KEY)) ?? links[0];
    const toggle = el('label', { class: `st-card st-net__toggle ${status.enabled ? 'is-on' : ''}` },
      el('input', { type: 'checkbox', checked: status.enabled, disabled: busy, onChange: (e) => run(() => api.setEnabled(e.target.checked)) }),
      el('span', { class: 'st-card__label' }, 'Share the player screen on this network',
        status.running ? el('span', { class: 'tp-badge tp-badge--interactive st-soon' }, 'On') : null),
      el('span', { class: 'tp-dim st-card__hint' }, `Devices on the same Wi-Fi or network open it from the link below (port ${status.port}). They see only what you push, and can't change anything.`));

    const parts = [toggle];
    if (status.error) parts.push(el('p', { class: 'app-error' }, `Couldn't share it: ${status.error}`));
    if (status.enabled && status.running && !links.length) {
      parts.push(el('p', { class: 'app-error' }, 'This PC doesn\'t seem to be on a network right now. Connect to Wi-Fi or a network, then turn sharing off and on.'));
    }
    if (status.running && picked) {
      parts.push(el('div', { class: 'st-qr' },
        el('div', { class: 'st-qr__frame' }, qrSvg(picked.url, { label: `QR code for ${picked.url}` })),
        el('div', { class: 'st-qr__info' },
          el('p', { class: 'tp-label' }, 'Scan to open the player screen'),
          el('p', { class: 'tp-mono st-qr__url' }, picked.url),
          el('span', { class: 'app-actions st-qr__actions' },
            el('button', {
              type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive',
              onClick: () => navigator.clipboard.writeText(picked.url).then(() => toast('Link copied'), () => toast('Couldn\'t copy: select the link and copy it', { tone: 'warning' })),
            }, 'Copy link'),
            el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => showLarge(picked) }, 'Show large'),
            el('button', {
              type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', disabled: busy,
              onClick: async () => {
                const ok = await confirmDialog({ title: 'Make a new link?', body: 'Every device using the current link or QR code is disconnected and needs the new one.', confirmLabel: 'New link' });
                if (ok) run(() => api.newLink()).then(() => toast('New link made: the old one no longer works'));
              },
            }, 'New link')),
          links.length > 1
            ? el('label', { class: 'tp-field st-qr__pick' }, el('span', { class: 'tp-label' }, 'Network'),
                el('select', { class: 'tp-select', onChange: (e) => (store.set(PICK_KEY, e.target.value), draw()) },
                  links.map((l) => el('option', { value: l.address, selected: l === picked }, `${l.address} (${l.name})`))))
            : null,
          el('p', { class: 'tp-dim st-note' }, 'The first time, Windows may ask whether Node.js can use the network. Allow it on private networks, or other devices can\'t connect. If a device can\'t reach it, check that it\'s on the same network, or pick another network above.'))));
    }
    body.replaceChildren(...parts);
  }

  api.status().then((s) => ((status = s), draw()), (err) => body.replaceChildren(el('p', { class: 'app-error' }, err.message)));
  return card;
}

/**
 * "GM on your network": run TEMPEST from a tablet or phone (the TEMPEST app, or a browser)
 * while it keeps running on this PC. Paired with its own QR code and key; shown on the PC only.
 */
export function gmNetworkCard() {
  const body = el('div', { class: 'tp-panel__body st-net' }, el('p', { class: 'tp-dim' }, 'Checking…'));
  const card = el('section', { class: 'tp-frame tp-panel st-net-panel', 'aria-label': 'GM on your network' },
    el('header', { class: 'tp-panel__head' },
      el('h2', { class: 'tp-panel__title' }, 'GM on your network'),
      el('span', { class: 'tp-dim' }, 'Run TEMPEST from your tablet or phone while it runs on this PC. One setting for every project.')),
    body);
  let status = null;
  let busy = false;

  async function run(work) {
    busy = true;
    draw();
    try {
      status = await work();
    } catch (err) {
      toastError(err);
    }
    busy = false;
    draw();
  }

  function draw() {
    if (!status) return;
    const links = status.links;
    const picked = links.find((l) => l.address === store.get(PICK_KEY)) ?? links[0];
    const toggle = el('label', { class: `st-card st-net__toggle ${status.enabled ? 'is-on' : ''}` },
      el('input', {
        type: 'checkbox', checked: status.enabled, disabled: busy,
        onChange: async (e) => {
          const on = e.target.checked;
          if (on && !(await confirmDialog({
            title: 'Let a tablet run TEMPEST?',
            body: 'A device you pair with the QR code can do anything this window can: change and delete your campaigns, and push to the players. Only pair your own devices, on a network you trust (home Wi-Fi, not a public one). You can sign every device out with New key.',
            confirmLabel: 'Turn it on',
          }))) return draw();
          run(() => gmLan.setEnabled(on));
        },
      }),
      el('span', { class: 'st-card__label' }, 'Let my tablet or phone be the GM window',
        status.running ? el('span', { class: 'tp-badge tp-badge--interactive st-soon' }, 'On') : null),
      el('span', { class: 'tp-dim st-card__hint' }, `Scan the code below in the TEMPEST app (I'm the GM), or open the link in a browser on that device (port ${status.port}). Shutting TEMPEST down, autostart, importing PDFs and these network settings stay on this PC.`));

    const parts = [toggle];
    if (status.error) parts.push(el('p', { class: 'app-error' }, `Couldn't share it: ${status.error}`));
    if (status.enabled && status.running && !links.length) {
      parts.push(el('p', { class: 'app-error' }, 'This PC doesn\'t seem to be on a network right now. Connect to Wi-Fi or a network, then turn this off and on.'));
    }
    if (status.running && picked) {
      parts.push(el('div', { class: 'st-qr' },
        el('div', { class: 'st-qr__frame' }, qrSvg(picked.url, { label: 'QR code to pair a GM device' })),
        el('div', { class: 'st-qr__info' },
          el('p', { class: 'tp-label' }, 'Scan to pair a GM device'),
          el('p', { class: 'tp-dim' }, 'Keep this code to yourself: it opens your whole campaign.'),
          el('span', { class: 'app-actions st-qr__actions' },
            el('button', {
              type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive',
              onClick: () => navigator.clipboard.writeText(picked.url).then(() => toast('GM link copied')),
            }, 'Copy link'),
            el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => showLarge(picked, 'Scan in the TEMPEST app to pair a GM device') }, 'Show large'),
            el('button', {
              type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', disabled: busy,
              onClick: async () => {
                const ok = await confirmDialog({ title: 'Sign every device out?', body: 'Every paired tablet or phone is signed out at once and needs the new QR code to pair again.', confirmLabel: 'New key', danger: true });
                if (ok) run(() => gmLan.newKey()).then(() => toast('New key made: every GM device is signed out'));
              },
            }, 'New key')),
          links.length > 1
            ? el('label', { class: 'tp-field st-qr__pick' }, el('span', { class: 'tp-label' }, 'Network'),
                el('select', { class: 'tp-select', onChange: (e) => (store.set(PICK_KEY, e.target.value), draw()) },
                  links.map((l) => el('option', { value: l.address, selected: l === picked }, `${l.address} (${l.name})`))))
            : null,
          status.devices?.length
            ? el('p', { class: 'tp-dim st-note' }, `In use in the last 10 minutes: ${status.devices.map((d) => d.address).join(', ')}`)
            : el('p', { class: 'tp-dim st-note' }, 'No device has connected yet. If the tablet says it can\'t reach this PC: check it\'s on the same Wi-Fi, pick that network above, and make sure Windows Firewall lets Node.js (or tempest.exe) in on private networks (Windows Security › Firewall & network protection › Allow an app through firewall).'))));
    }
    body.replaceChildren(...parts);
  }

  gmLan.status().then((s) => ((status = s), draw()), (err) => body.replaceChildren(el('p', { class: 'app-error' }, err.message)));
  return card;
}

/**
 * Both network cards (player screen, GM). On a device paired as the GM window, these settings
 * belong to the PC, so it says so instead.
 */
export function networkCards() {
  const host = el('div', { class: 'st-net-cards' });
  role().then((r) => {
    if (r.remote) {
      host.replaceChildren(el('section', { class: 'tp-frame tp-panel st-net-panel' },
        el('div', { class: 'tp-panel__body' },
          el('p', { class: 'tp-h3' }, 'Network sharing'),
          el('p', { class: 'tp-muted' }, 'You\'re running TEMPEST from another device. Sharing the player screen and pairing GM devices are set on the PC running TEMPEST.'))));
    } else host.replaceChildren(networkCard(), gmNetworkCard());
  }, () => host.replaceChildren(networkCard(), gmNetworkCard()));
  return host;
}
