// Combat › Netrunning › Network Builder: put net cards together into a NET architecture.
//
// The palette on the left holds the project's net cards (made in the Card Forge).
// Click one to add it below the selected node (or as a new branch at the top when
// nothing is selected); the new node is selected, so clicking card after card builds
// a line straight down. Drag a card onto any node to hang it there instead. The
// inspector on the right sets up the selected node: its card, label, DV, how many,
// a GM note, and links that merge branches (a node can come after several others).
//
// Work in progress is kept in this browser as a draft, as in The Forge, so switching
// tabs or closing the window loses nothing. Saved networks are listed under Networks.

import { el, store, toast, toastError, confirmDialog } from '../ui.js';
import { entitiesApi, networks as api, currentProjectId } from '../api.js';
import { NET_CARD_TYPES } from '../forge/preset-model.js';
import * as N from './network-model.js';
import { renderTree, nodeText, dvText } from './tree.js';
import { BASE, cardChip, typeLabel, takeWantedNetwork } from './parts.js';

const DRAFT_KEY = () => `tempest.${currentProjectId()}.netrun.draft`;
const LAST_KEY = () => `tempest.${currentProjectId()}.netrun.last`;

export async function mount(root) {
  const s = {
    net: null, // the working copy
    saved: '', // JSON of the last saved/loaded version ('' = never saved)
    selected: null, // node id
    cards: [], // the project's net cards (summaries)
    library: [], // saved networks
    search: '',
    type: '', // palette filter: a card type, or '' for all
  };
  const dirty = () => JSON.stringify(s.net) !== s.saved;
  const cardOf = (id) => (id ? s.cards.find((c) => c.id === id) ?? null : null);
  const persist = () => store.set(DRAFT_KEY(), JSON.stringify({ net: s.net, saved: s.saved }));
  const nodeOf = (id) => s.net.nodes.find((n) => n.id === id) ?? null;

  const toolbar = el('div', { class: 'tp-frame tp-panel nr-toolbar' });
  const palette = el('aside', { class: 'tp-frame tp-panel nr-palette', 'aria-label': 'Net cards' });
  const paletteList = el('div', { class: 'nr-palette__list' });
  const board = el('section', { class: 'tp-frame tp-panel nr-board', 'aria-label': 'Architecture' });
  const inspector = el('aside', { class: 'tp-frame tp-panel nr-inspector', 'aria-label': 'Node settings' });
  root.append(el('div', { class: 'nr-builder' }, toolbar, el('div', { class: 'nr-builder__work' }, palette, board, inspector)));

  // --- state ----------------------------------------------------------------------------------

  function change(next, { inspector: redrawInspector = true, toolbar: redrawToolbar = true } = {}) {
    s.net = next;
    persist();
    if (s.selected && !nodeOf(s.selected)) s.selected = null;
    if (redrawToolbar) renderToolbar();
    else renderStatus();
    renderBoard();
    if (redrawInspector) renderInspector();
  }

  function load(net, { isNew = false } = {}) {
    s.net = net;
    s.saved = isNew ? '' : JSON.stringify(net);
    s.selected = null;
    if (!isNew && net.id) store.set(LAST_KEY(), net.id);
    persist();
    renderAll();
  }

  async function canLeave() {
    if (!s.net || !dirty()) return true;
    return confirmDialog({ title: 'Discard unsaved changes?', body: `"${s.net.name}" has changes that aren't saved.`, confirmLabel: 'Discard', danger: true });
  }

  async function refreshLibrary() {
    s.library = await api.list().catch((err) => (toastError(err), s.library));
  }

  // --- actions --------------------------------------------------------------------------------

  async function save() {
    let clean;
    try {
      clean = N.normalizeNetwork(s.net);
    } catch (err) {
      return toastError(err);
    }
    try {
      let out;
      if (clean.id && s.library.some((x) => x.id === clean.id)) {
        // Keep what was revealed in the meantime under Networks.
        const live = await api.get(clean.id).catch(() => null);
        if (live) Object.assign(clean, { revealed: live.revealed.filter((id) => clean.nodes.some((n) => n.id === id)), hints: live.hints });
        out = await api.save(clean);
      } else {
        delete clean.id;
        out = await api.create(clean);
      }
      await refreshLibrary();
      load(out);
      toast(`Saved "${out.name}"`, { tone: 'success', link: { href: `${BASE}/${out.id}`, label: 'Run it' } });
    } catch (err) {
      toastError(err);
    }
  }

  async function openNetwork(id) {
    if (id === s.net?.id && !dirty()) return renderToolbar();
    if (!(await canLeave())) return renderToolbar();
    try {
      load(await api.get(id));
    } catch (err) {
      toastError(err);
      renderToolbar();
    }
  }

  async function newNetwork() {
    if (!(await canLeave())) return renderToolbar();
    load(N.newNetwork(), { isNew: true });
  }

  async function duplicate() {
    if (!(await canLeave())) return;
    const copy = structuredClone(s.net);
    delete copy.id;
    copy.name = `${s.net.name} (copy)`.slice(0, 80);
    copy.revealed = [];
    load(copy, { isNew: true });
  }

  async function remove() {
    if (!s.net.id || !s.library.some((x) => x.id === s.net.id)) {
      if (await confirmDialog({ title: 'Discard this network?', body: `"${s.net.name}" was never saved.`, confirmLabel: 'Discard', danger: true })) load(N.newNetwork(), { isNew: true });
      return;
    }
    if (!(await confirmDialog({ title: 'Delete network?', body: `"${s.net.name}" will be deleted for good. Its net cards stay in the Card Forge.`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.remove(s.net.id);
      toast(`Deleted "${s.net.name}"`);
      await refreshLibrary();
      s.saved = JSON.stringify(s.net); // nothing to ask about any more
      await openFirst();
    } catch (err) {
      toastError(err);
    }
  }

  async function openFirst() {
    const last = store.get(LAST_KEY());
    const pick = s.library.find((x) => x.id === last) ?? s.library[0];
    if (pick) {
      try {
        return load(await api.get(pick.id));
      } catch {
        /* fall through */
      }
    }
    load(N.newNetwork(), { isNew: true });
  }

  /** Add a card below `parent` (null: a new branch at the top) and select it. */
  function addCard(cardId, parent = s.selected) {
    const { net, id } = N.addNode(s.net, parent, cardId || null);
    s.selected = id;
    change(net);
    renderPalette();
  }

  function select(id) {
    s.selected = id;
    renderBoard();
    renderInspector();
    renderPalette();
  }

  // --- toolbar ---------------------------------------------------------------------------------

  const status = el('span', { class: 'fd-status', role: 'status' });
  function renderStatus() {
    const saved = s.net.id && s.library.some((x) => x.id === s.net.id);
    status.textContent = !saved ? 'Not saved yet' : dirty() ? 'Unsaved changes' : 'Saved';
    status.classList.toggle('is-dirty', dirty());
  }

  function renderToolbar() {
    const saved = s.net.id && s.library.some((x) => x.id === s.net.id);
    renderStatus();
    toolbar.replaceChildren(
      el('div', { class: 'tp-panel__body nr-toolbar__body' },
        el('label', { class: 'nr-toolbar__pick' },
          el('span', { class: 'tp-label' }, 'Network'),
          el('select', {
            class: 'tp-select',
            onChange: (e) => (e.target.value ? openNetwork(e.target.value) : newNetwork()),
          },
          saved ? null : el('option', { value: '', selected: true }, `${s.net.name || 'New network'} (unsaved)`),
          s.library.map((x) => el('option', { value: x.id, selected: x.id === s.net.id }, x.name)),
          saved ? el('option', { value: '' }, '+ New network') : null)),
        el('label', { class: 'nr-toolbar__name' },
          el('span', { class: 'tp-label' }, 'Name'),
          el('input', {
            class: 'tp-input', value: s.net.name, maxlength: 80, placeholder: 'e.g. Steeltooth Bar',
            onInput: (e) => change({ ...s.net, name: e.target.value }, { toolbar: false, inspector: false }),
          })),
        el('span', { class: 'app-actions nr-toolbar__actions' },
          status,
          saved ? null : el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: newNetwork, title: 'Start over with an empty network' }, 'New'),
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: duplicate, disabled: !s.net.nodes.length }, 'Duplicate'),
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: remove }, saved ? 'Delete' : 'Discard'),
          saved ? el('a', { class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive', href: `${BASE}/${s.net.id}`, title: 'Open it under Networks, to reveal it to the players' }, 'Run ▸') : null,
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--primary', onClick: save, title: 'Save (Ctrl+S)' }, 'Save'))));
  }

  // --- palette ---------------------------------------------------------------------------------

  function renderPalette() {
    const sel = s.selected ? nodeOf(s.selected) : null;
    palette.replaceChildren(
      el('header', { class: 'tp-panel__head' },
        el('h2', { class: 'tp-panel__title' }, 'Net cards'),
        el('a', { class: 'app-link nr-palette__forge', href: `${BASE}/cards` }, '+ Forge a card')),
      el('div', { class: 'tp-panel__body nr-palette__body' },
        el('p', { class: 'tp-dim nr-hint' }, sel
          ? ['Click a card to add it below ', el('strong', {}, N.nodeTitle(sel, cardOf(sel.card))), ', or drag it onto any node.']
          : 'Click a card to start a branch at the top, or drag it onto a node to hang it there.'),
        s.cards.length > 6
          ? el('input', { class: 'tp-input', type: 'search', placeholder: 'Search cards', value: s.search, 'aria-label': 'Search cards', onInput: (e) => ((s.search = e.target.value), renderPaletteList()) })
          : null,
        el('div', { class: 'nr-palette__types', role: 'group', 'aria-label': 'Card type' },
          [{ id: '', label: 'All' }, ...NET_CARD_TYPES.filter((t) => s.cards.some((c) => c.category === t.id))].map((t) =>
            el('button', { type: 'button', class: `fd-seg__btn ${s.type === t.id ? 'is-on' : ''}`, 'aria-pressed': String(s.type === t.id), onClick: () => ((s.type = t.id), renderPalette()) }, t.label))),
        paletteList,
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost nr-palette__slot', onClick: () => addCard(null), title: 'A node with no card yet: fill it in later' }, '+ Empty slot')));
    renderPaletteList();
  }

  function renderPaletteList() {
    const q = s.search.trim().toLowerCase();
    const shown = s.cards.filter((c) => (!s.type || c.category === s.type) && (!q || c.name.toLowerCase().includes(q)));
    paletteList.replaceChildren(
      s.cards.length
        ? shown.length
          ? el('ul', { class: 'nr-palette__cards' }, shown.map((c) => el('li', {}, cardChip(c, { drag: true, onClick: () => addCard(c.id), title: c.summary || null }))))
          : el('p', { class: 'tp-muted' }, 'No cards match.')
        : el('div', { class: 'nr-palette__none' },
            el('p', { class: 'tp-muted' }, 'No net cards yet.'),
            el('a', { class: 'tp-frame tp-btn tp-btn--sm tp-btn--primary', href: `${BASE}/cards` }, 'Open the Card Forge')));
  }

  // --- the board ---------------------------------------------------------------------------------

  let treeCleanup = () => {};
  function renderBoard() {
    treeCleanup();
    const tree = renderTree(s.net, {
      content: (n) => {
        const c = cardOf(n.card);
        return nodeText({ type: c ? typeLabel(c.category) : n.card ? 'Missing card' : 'Empty slot', title: N.nodeTitle(n, c), dv: n.dv || c?.dv, count: n.count });
      },
      classOf: (n) => {
        const c = cardOf(n.card);
        return [c ? `nr-type--${c.category}` : 'is-empty', n.card && !c ? 'is-missing' : '', n.note ? 'has-note' : ''].join(' ');
      },
      selected: s.selected,
      onSelect: (id) => select(id === s.selected ? null : id),
      onDropCard: (id, card) => addCard(card, id),
      empty: el('div', { class: 'nr-canvas__empty' },
        el('p', { class: 'tp-h3' }, 'An empty network'),
        el('p', { class: 'tp-muted' }, 'Click a card in the palette (or drag one here) to place the first node. Each card you click next goes below the one selected.')),
    });
    treeCleanup = tree.cleanup;
    // A click on empty space lets go of the selection.
    tree.node.addEventListener('click', (e) => {
      if (s.selected && !e.target.closest('.nr-node')) select(null);
    });
    board.replaceChildren(
      el('header', { class: 'tp-panel__head' },
        el('h2', { class: 'tp-panel__title' }, 'Architecture'),
        el('span', { class: 'tp-dim' }, s.net.nodes.length ? `${s.net.nodes.length} node${s.net.nodes.length === 1 ? '' : 's'} · ${N.layout(s.net).rows} deep` : 'No nodes yet')),
      tree.node);
  }

  // --- inspector ---------------------------------------------------------------------------------

  const field = (label, control, hint) => el('label', { class: 'tp-field fd-field' }, el('span', { class: 'tp-label' }, label), control, hint ? el('span', { class: 'fd-field__hint tp-dim' }, hint) : null);
  const setNode = (patch, opts = { inspector: false }) => change(N.updateNode(s.net, s.selected, patch), opts);

  function cardSelect(n) {
    return el('select', { class: 'tp-select', onChange: (e) => setNode({ card: e.target.value || null }, {}) },
      el('option', { value: '', selected: !n.card }, 'Empty slot'),
      n.card && !cardOf(n.card) ? el('option', { value: n.card, selected: true }, 'Missing card (deleted)') : null,
      NET_CARD_TYPES.map((t) => {
        const of = s.cards.filter((c) => c.category === t.id);
        return of.length ? el('optgroup', { label: t.label }, of.map((c) => el('option', { value: c.id, selected: c.id === n.card }, `${c.name}${c.dv ? ` (${dvText(c.dv)})` : ''}`))) : null;
      }));
  }

  function renderInspector() {
    const n = s.selected ? nodeOf(s.selected) : null;
    if (!n) return renderNetworkSettings();
    const c = cardOf(n.card);
    const others = s.net.nodes.filter((o) => N.canLink(s.net, o.id, n.id));
    const titleOf = (id) => {
      const o = nodeOf(id);
      return o ? N.nodeTitle(o, cardOf(o.card)) : '?';
    };
    inspector.replaceChildren(
      el('header', { class: 'tp-panel__head' },
        el('h2', { class: 'tp-panel__title' }, N.nodeTitle(n, c)),
        el('span', { class: 'tp-badge' }, c ? typeLabel(c.category) : 'Node')),
      el('div', { class: 'tp-panel__body fd-inspector__body' },
        field('Card', el('span', { class: 'nr-inline' }, cardSelect(n), c ? el('a', { class: 'app-link', href: `${BASE}/${c.id}` }, 'Open') : null),
          'The net card this node is. Several nodes can use the same card.'),
        field('Label', el('input', { class: 'tp-input', value: n.label, maxlength: 60, placeholder: c?.name ?? 'e.g. Control Node (Cameras)', onInput: (e) => setNode({ label: e.target.value }) }),
          'What the map calls this node, instead of the card\'s name. Players read it once it\'s revealed.'),
        el('div', { class: 'nr-pair' },
          field('DV', el('input', { class: 'tp-input', value: n.dv, maxlength: 8, placeholder: c?.dv || '—', onInput: (e) => setNode({ dv: e.target.value }) }), 'Empty: the card\'s'),
          field('How many', el('input', { class: 'tp-input fd-num', type: 'number', min: 1, max: 99, value: n.count, onChange: (e) => setNode({ count: Math.min(99, Math.max(1, Math.round(Number(e.target.value) || 1))) }) }), 'Hellhound ×2')),
        field('GM note', el('textarea', { class: 'tp-textarea', rows: 3, maxlength: 2000, placeholder: 'What happens here, what it guards…', onInput: (e) => setNode({ note: e.target.value }) }, n.note),
          'Only you see this, on the Networks tab while running it.'),
        el('div', { class: 'tp-field fd-field' },
          el('span', { class: 'tp-label' }, 'Comes after'),
          n.parents.length
            ? el('span', { class: 'nr-links' }, n.parents.map((p) => el('span', { class: 'tp-badge vf-ref' }, titleOf(p),
                el('button', { type: 'button', class: 'vf-ref__x', 'aria-label': `Unlink from ${titleOf(p)}`, title: 'Unlink', onClick: () => change(N.unlink(s.net, p, n.id)) }, '×'))))
            : el('span', { class: 'tp-dim' }, 'Nothing: it starts a branch at the top'),
          others.length
            ? el('select', { class: 'tp-select', 'aria-label': 'Also comes after', onChange: (e) => e.target.value && change(N.link(s.net, e.target.value, n.id)) },
                el('option', { value: '' }, n.parents.length ? '+ Also comes after… (merge)' : '+ Comes after…'),
                others.map((o) => el('option', { value: o.id }, N.nodeTitle(o, cardOf(o.card)))))
            : null,
          el('span', { class: 'fd-field__hint tp-dim' }, 'Two branches that lead to one node merge into it, like the Hellhounds at the bottom of an architecture.')),
        el('div', { class: 'nr-actions' },
          el('span', { class: 'tp-label' }, 'Arrange'),
          el('span', { class: 'app-actions' },
            el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => change(N.nudge(s.net, n.id, -1)), title: 'Swap with the branch to its left' }, '← Left'),
            el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => change(N.nudge(s.net, n.id, 1)), title: 'Swap with the branch to its right' }, 'Right →'),
            el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => { const r = N.insertAbove(s.net, n.id); s.selected = r.id; change(r.net); renderPalette(); }, title: 'A new empty slot between this node and the ones above it' }, '+ Slot above'),
            el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => addCard(null, n.id), title: 'A new empty slot below this node' }, '+ Slot below'))),
        el('div', { class: 'nr-actions' },
          el('span', { class: 'tp-label' }, 'Remove'),
          el('span', { class: 'app-actions' },
            el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--danger', onClick: () => change(N.removeNode(s.net, n.id)), title: 'What hangs below it moves up (Delete key)' }, 'Remove node'),
            el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => change(N.removeBranch(s.net, n.id)), title: 'This node and everything that only it leads to' }, 'Remove branch')))),
    );
  }

  function renderNetworkSettings() {
    inspector.replaceChildren(
      el('header', { class: 'tp-panel__head' }, el('h2', { class: 'tp-panel__title' }, 'Network'), el('span', { class: 'tp-badge' }, 'No node selected')),
      el('div', { class: 'tp-panel__body fd-inspector__body' },
        field('Description', el('textarea', { class: 'tp-textarea', rows: 3, maxlength: 400, placeholder: 'Where it is, who runs it… (GM only)', onInput: (e) => change({ ...s.net, description: e.target.value }, { inspector: false }) }, s.net.description)),
        el('div', { class: 'nr-howto' },
          el('p', { class: 'tp-label' }, 'Building'),
          el('ul', {},
            el('li', {}, 'Click a card in the palette: it goes below the selected node and becomes the selection, so a line builds straight down.'),
            el('li', {}, 'To branch, select the node to branch from and click another card.'),
            el('li', {}, 'Drag a card onto any node to hang it there; onto empty space for a new branch at the top.'),
            el('li', {}, 'Select a node to set its label, DV and count, or to merge it after another branch.'),
            el('li', {}, 'Delete removes the selected node; Esc lets go of it; Ctrl+S saves.')))));
  }

  function renderAll() {
    renderToolbar();
    renderPalette();
    renderBoard();
    renderInspector();
  }

  // --- keys -------------------------------------------------------------------------------------

  const typing = (t) => t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    } else if (!typing(e.target) && s.selected && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      change(N.removeNode(s.net, s.selected));
      renderPalette();
    } else if (!typing(e.target) && s.selected && e.key === 'Escape') {
      select(null);
    }
  };
  const onUnload = (e) => {
    if (dirty()) e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', onUnload);

  // --- start: the draft, else the network asked for, else the last one, else a new one ---------------

  s.cards = await entitiesApi('netcards').list().catch(() => []);
  await refreshLibrary();
  let draft = null;
  try {
    draft = JSON.parse(store.get(DRAFT_KEY()) ?? 'null');
    // Kept as it was (so "unsaved changes" stays true to it), once it's known to be readable.
    if (draft?.net) N.normalizeNetwork({ ...draft.net, name: draft.net.name || 'Untitled' });
  } catch {
    draft = null;
  }
  // A new network nobody touched isn't worth reopening over the saved ones.
  const blank = (net) => !net.id && !net.nodes.length && !net.description && (!net.name || net.name === N.newNetwork().name);
  if (draft?.net && blank(draft.net)) draft = null;
  const want = takeWantedNetwork();
  if (draft?.net) {
    s.net = draft.net;
    s.saved = draft.saved ?? '';
    // Its network was deleted meanwhile: it becomes a new one.
    if (s.net.id && !s.library.some((x) => x.id === s.net.id)) {
      delete s.net.id;
      s.saved = '';
    }
    renderAll();
    if (want === 'new') await newNetwork();
    else if (want) await openNetwork(want);
  } else if (want && want !== 'new') {
    s.net = N.newNetwork();
    s.saved = JSON.stringify(s.net);
    await openNetwork(want);
  } else if (want === 'new') {
    load(N.newNetwork(), { isNew: true });
  } else {
    await openFirst();
  }

  return {
    unmount() {
      treeCleanup();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    },
  };
}
