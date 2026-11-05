// Combat › Netrunning › Networks: every saved network, and running one.
//
//   #/combat/netrunning/networks   the list: run, edit (in the Network Builder) or delete each
//   #/combat/netrunning/net_…      running a network: the whole architecture for the GM, hidden
//                                  nodes dimmed. Reveal them one at a time (or Reveal next, which
//                                  follows the architecture top to bottom); with "Update the player
//                                  screen" on, every reveal is pushed at once, the new node lit and
//                                  its card shown beside the map. Player view previews exactly that.

import { el, store, toast, toastError, confirmDialog } from '../ui.js';
import { entitiesApi, networks as api, currentProjectId, imageUrl } from '../api.js';
import { renderSheet } from '../forge/sheet.js';
import { playerEntity } from '../push/push-model.js';
import { push, pushButton } from '../push/push.js';
import { openImage } from '../image-viewer.js';
import * as N from './network-model.js';
import { renderTree, nodeText } from './tree.js';
import { playerNetworkView } from './player-view.js';
import { BASE, typeLabel, wantNetwork } from './parts.js';

const LIVE_KEY = () => `tempest.${currentProjectId()}.netrun.live`;

export async function mount(root, { id }) {
  return id ? run(root, id) : list(root);
}

const toBuilder = (id) => {
  wantNetwork(id);
  location.hash = `${BASE}/builder`;
};

// --- the list ---------------------------------------------------------------------------------------

async function list(root) {
  const all = await api.list().catch((err) => (toastError(err), []));
  const remove = async (net) => {
    if (!(await confirmDialog({ title: `Delete ${net.name}?`, body: 'This network will be deleted for good. Its net cards stay in the Card Forge.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.remove(net.id);
      toast(`Deleted "${net.name}"`);
      list(root);
    } catch (err) {
      toastError(err);
    }
  };
  root.replaceChildren(
    el('div', { class: 'cv' },
      el('div', { class: 'cv-bar' },
        el('span', { class: 'tp-deco' }, `${all.length} network${all.length === 1 ? '' : 's'}`),
        el('span', { class: 'app-actions' },
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary tp-btn--sm', onClick: () => toBuilder('new') }, '+ New network'))),
      all.length
        ? el('ul', { class: 'nr-nets' }, all.map((net) => {
            const roots = net.nodes.filter((n) => !n.parents.length).length;
            return el('li', { class: 'tp-frame tp-panel nr-net' },
              el('a', { class: 'nr-net__open', href: `${BASE}/${net.id}` },
                el('span', { class: 'tp-h3 nr-net__name' }, net.name),
                net.description ? el('span', { class: 'tp-muted nr-net__desc' }, net.description) : null,
                el('span', { class: 'tp-dim tp-mono nr-net__meta' },
                  `${net.nodes.length} node${net.nodes.length === 1 ? '' : 's'} · ${N.layout(net).rows} deep${roots > 1 ? ` · ${roots} entry points` : ''} · ${net.revealed.length ? `${net.revealed.length} revealed` : 'all hidden'}`)),
              el('span', { class: 'app-actions nr-net__actions' },
                el('a', { class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive', href: `${BASE}/${net.id}` }, 'Run ▸'),
                el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => toBuilder(net.id) }, 'Edit'),
                el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => remove(net) }, 'Delete')));
          }))
        : el('article', { class: 'tp-frame tp-panel app-placeholder' },
            el('div', { class: 'tp-panel__body' },
              el('p', { class: 'tp-h3' }, 'No networks yet'),
              el('p', { class: 'tp-muted' }, 'Forge some net cards, then put them together in the Network Builder and save. Your networks show up here, ready to run.'),
              el('span', { class: 'app-actions' },
                el('a', { class: 'tp-frame tp-btn', href: `${BASE}/cards` }, 'Card Forge'),
                el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary', onClick: () => toBuilder('new') }, 'Network Builder'))))),
  );
  return {};
}

// --- running one ------------------------------------------------------------------------------------

async function run(root, id) {
  let net;
  try {
    net = await api.get(id);
  } catch (err) {
    root.replaceChildren(el('article', { class: 'tp-frame tp-panel app-placeholder' },
      el('div', { class: 'tp-panel__body' }, el('p', { class: 'tp-h3' }, 'Not found'), el('p', { class: 'tp-muted' }, err.message),
        el('a', { class: 'tp-frame tp-btn', href: `${BASE}/networks` }, 'All networks'))));
    return {};
  }
  const cards = new Map();
  await Promise.all([...new Set(net.nodes.map((n) => n.card).filter(Boolean))].map((cid) =>
    entitiesApi('netcards').get(cid).then((c) => cards.set(cid, c)).catch(() => null)));

  const s = { selected: null, view: 'gm', live: store.get(LIVE_KEY()) !== 'off', busy: false };
  const nodeOf = (nid) => net.nodes.find((n) => n.id === nid) ?? null;
  const isOpen = (nid) => net.revealed.includes(nid);
  let cleanup = () => {};

  /** Save what's revealed (and hints); with Live on, show it on the player screen, `focus` lit. */
  async function update(patch, focus = null) {
    if (s.busy) return;
    s.busy = true;
    try {
      net = await api.save({ ...net, ...patch });
      render();
      // Quietly: the top bar shows what's on screen, so every reveal needn't toast.
      if (s.live) await push({ mode: 'network', id: net.id, focus }, { quiet: true });
    } catch (err) {
      toastError(err);
    } finally {
      s.busy = false;
    }
  }
  const reveal = (nid) => update({ revealed: [...net.revealed, nid] }, nid);
  const hide = (nid) => update({ revealed: net.revealed.filter((r) => r !== nid) });
  function revealNext() {
    const next = N.nextToReveal(net);
    if (!next) return toast('Everything is revealed');
    s.selected = next.id;
    reveal(next.id);
  }

  const board = el('section', { class: 'tp-frame tp-panel nr-board nr-run__board', 'aria-label': 'Architecture' });
  const side = el('aside', { class: 'tp-frame tp-panel nr-inspector nr-run__side', 'aria-label': 'Node' });

  function renderBoard() {
    cleanup();
    if (s.view === 'player') {
      const view = N.playerNetwork(net, cards, (c) => playerEntity(c), { focus: s.selected });
      const out = playerNetworkView(view, { url: imageUrl });
      cleanup = out.cleanup;
      board.replaceChildren(
        el('header', { class: 'tp-panel__head' }, el('h2', { class: 'tp-panel__title' }, 'What the players see'), el('span', { class: 'tp-dim' }, 'The selected node, if revealed, is the lit one')),
        out.node);
      return;
    }
    const tree = renderTree(net, {
      content: (n) => {
        const c = cards.get(n.card);
        return [
          ...nodeText({ type: c ? typeLabel(c.category) : n.card ? 'Missing card' : 'Empty slot', title: N.nodeTitle(n, c), dv: n.dv || c?.values?.dv, count: n.count }),
          el('span', { class: 'nr-node__state' }, isOpen(n.id) ? 'Revealed' : 'Hidden'),
        ];
      },
      classOf: (n) => [isOpen(n.id) ? 'is-revealed' : 'is-veiled', cards.get(n.card) ? `nr-type--${cards.get(n.card).category}` : 'is-empty', n.note ? 'has-note' : ''].join(' '),
      lineClass: (from, to) => (isOpen(from) && isOpen(to) ? 'is-revealed' : ''),
      selected: s.selected,
      onSelect: (nid) => select(nid === s.selected ? null : nid),
      empty: el('div', { class: 'nr-canvas__empty' }, el('p', { class: 'tp-muted' }, 'This network has no nodes yet.'),
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => toBuilder(net.id) }, 'Edit in the Network Builder')),
    });
    cleanup = tree.cleanup;
    board.replaceChildren(
      el('header', { class: 'tp-panel__head' }, el('h2', { class: 'tp-panel__title' }, 'Architecture'), el('span', { class: 'tp-dim' }, 'Click a node to reveal it, hide it or read its card')),
      tree.node);
  }

  function renderSide() {
    const n = s.selected ? nodeOf(s.selected) : null;
    if (!n) {
      const next = N.nextToReveal(net);
      side.replaceChildren(
        el('header', { class: 'tp-panel__head' }, el('h2', { class: 'tp-panel__title' }, 'Running'), el('span', { class: 'tp-badge' }, `${net.revealed.length} of ${net.nodes.length} revealed`)),
        el('div', { class: 'tp-panel__body fd-inspector__body' },
          net.description ? el('p', { class: 'tp-muted' }, net.description) : null,
          next ? el('p', {}, 'Next down the line: ', el('strong', {}, N.nodeTitle(next, cards.get(next.card)))) : el('p', { class: 'tp-muted' }, 'Every node is revealed.'),
          el('ul', { class: 'nr-howto' },
            el('li', {}, 'Reveal next follows the architecture top to bottom, one node at a time.'),
            el('li', {}, 'Click a node to reveal or hide just that one and to read its card.'),
            el('li', {}, s.live ? 'Each reveal goes to the player screen straight away, the new node lit.' : 'The player screen isn\'t updated as you reveal: use Push network when you\'re ready.'))));
      return;
    }
    const c = cards.get(n.card);
    const open = isOpen(n.id);
    side.replaceChildren(
      el('header', { class: 'tp-panel__head' },
        el('h2', { class: 'tp-panel__title' }, N.nodeTitle(n, c), n.count > 1 ? ` ×${n.count}` : ''),
        el('span', { class: `tp-badge ${open ? 'tp-badge--success' : ''}` }, open ? 'Revealed' : 'Hidden')),
      el('div', { class: 'tp-panel__body fd-inspector__body' },
        el('span', { class: 'app-actions' },
          open
            ? el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => hide(n.id) }, 'Hide again')
            : el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--primary', onClick: () => reveal(n.id) }, 'Reveal'),
          open ? pushButton('Push, lit', () => push({ mode: 'network', id: net.id, focus: n.id }), { title: 'Show the network on the player screen with this node lit and its card beside it' }) : null,
          c ? pushButton('Push card', () => push({ mode: 'entity', id: c.id }), { title: 'Show just this card on the player screen, as its sheet allows', ghost: true }) : null),
        n.note ? el('div', { class: 'nr-note' }, el('span', { class: 'tp-label' }, 'GM note'), el('p', {}, n.note)) : null,
        c
          ? [
              el('p', { class: 'tp-dim' }, 'Card: ', el('a', { class: 'app-link', href: `${BASE}/${c.id}` }, c.name), n.dv ? ` · DV here: ${n.dv}` : ''),
              el('div', { class: 'nr-run__sheet' }, renderSheet(c.sheet, {
                view: 'gm', values: c.values, shown: c.shown, refs: c.refs, imageUrl,
                openImage: (items, i) => openImage(items.map((x) => ({ ...x, src: imageUrl(x.image) })), i, { push: (x) => push({ mode: 'handout', image: x.image, caption: x.caption }) }),
              })),
            ]
          : el('p', { class: 'tp-muted' }, n.card ? 'Its card was deleted from the Card Forge.' : 'An empty slot: give it a card in the Network Builder.')),
    );
  }

  function select(nid) {
    s.selected = nid;
    renderBoard();
    renderSide();
  }

  const bar = el('div', { class: 'cv-bar nr-run__bar' });
  function renderBar() {
    const seg = el('span', { class: 'fd-seg', role: 'group', 'aria-label': 'View as' },
      [['gm', 'GM view'], ['player', 'Player view']].map(([v, label]) =>
        el('button', { type: 'button', class: `fd-seg__btn ${s.view === v ? 'is-on' : ''}`, 'aria-pressed': String(s.view === v), onClick: () => ((s.view = v), render()) }, label)));
    const done = net.revealed.length >= net.nodes.length;
    bar.replaceChildren(
      el('a', { class: 'app-link', href: `${BASE}/networks` }, '← All networks'),
      el('span', { class: 'app-actions' },
        seg,
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--primary', onClick: revealNext, disabled: done || !net.nodes.length, title: 'Reveal the next node down the architecture' }, 'Reveal next'),
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => update({ revealed: net.nodes.map((n) => n.id) }), disabled: done }, 'Reveal all'),
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => update({ revealed: [] }), disabled: !net.revealed.length }, 'Hide all'),
        pushButton('Push network', () => push({ mode: 'network', id: net.id, focus: s.selected && isOpen(s.selected) ? s.selected : null }), { title: 'Show the revealed nodes on the player screen' }),
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => toBuilder(net.id) }, 'Edit')),
      el('span', { class: 'nr-run__toggles' },
        el('label', { class: 'fd-check', title: 'Push to the player screen after every reveal or hide' },
          el('input', { type: 'checkbox', checked: s.live, onChange: (e) => { s.live = e.target.checked; store.set(LIVE_KEY(), s.live ? 'on' : 'off'); renderSide(); } }),
          'Update the player screen as I reveal'),
        el('label', { class: 'fd-check', title: 'Players see a blank box for each hidden node at the top or right below a revealed one' },
          el('input', { type: 'checkbox', checked: net.hints, onChange: (e) => update({ hints: e.target.checked }) }),
          'Show the way ahead (blank boxes)')));
  }

  const count = el('span', { class: 'tp-dim tp-mono' });
  function render() {
    count.textContent = `${net.revealed.length} of ${net.nodes.length} revealed`;
    renderBar();
    renderBoard();
    renderSide();
  }

  root.replaceChildren(el('div', { class: 'nr-run' },
    el('div', { class: 'nr-run__head' }, el('h2', { class: 'tp-h2' }, net.name), count),
    bar,
    el('div', { class: 'nr-run__work' }, board, side)));
  render();
  document.title = `TEMPEST · ${net.name}`;
  return { unmount: () => cleanup() };
}
