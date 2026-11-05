// Combat › Netrunning: NET architectures, in three sub-tabs.
//
//   #/combat/netrunning/builder    Network Builder: put net cards together into a network
//   #/combat/netrunning/cards      Card Forge: design net card presets and make cards from them
//   #/combat/netrunning/networks   Networks: every network saved, to run and reveal to players
//   #/combat/netrunning/ncard_…    one net card's page (Card Forge)
//   #/combat/netrunning/net_…      one network, running (Networks)
//
// The tab alone reopens the sub-tab last used in the project.

import { el, store } from '../ui.js';
import { entitiesApi, currentProjectId } from '../api.js';
import * as designer from '../forge/designer.js';
import { entryPage } from '../entities/view.js';
import { NET_CARD_TYPES } from '../forge/preset-model.js';
import * as builder from './builder.js';
import * as networks from './networks.js';
import { BASE, cardChip } from './parts.js';

export const SUBTABS = [
  { id: 'builder', label: 'Network Builder', hint: 'Put net cards together into a NET architecture' },
  { id: 'cards', label: 'Card Forge', hint: 'Design net cards: passwords, files, control nodes, Black ICE, demons' },
  { id: 'networks', label: 'Networks', hint: 'Your saved networks: run one and reveal it to the players' },
];
const SUB_KEY = () => `tempest.${currentProjectId()}.netrun.sub`;

export async function mount(root, ctx) {
  const item = ctx.item;
  if (!item) {
    const last = store.get(SUB_KEY());
    location.replace(`${BASE}/${SUBTABS.some((t) => t.id === last) ? last : 'builder'}`);
    return {};
  }
  const active = /^ncard_/.test(item) ? 'cards' : /^net_/.test(item) ? 'networks' : item;
  if (!SUBTABS.some((t) => t.id === active)) {
    location.replace(`${BASE}/builder`);
    return {};
  }
  store.set(SUB_KEY(), active);

  const host = el('div', { class: 'nr-sub', role: 'tabpanel' });
  root.replaceChildren(el('div', { class: 'nr' },
    el('nav', { class: 'tp-tabs nr-subtabs', role: 'tablist', 'aria-label': 'Netrunning' },
      SUBTABS.map((t) => el('a', { class: 'tp-tab', role: 'tab', href: `${BASE}/${t.id}`, title: t.hint, 'aria-selected': String(t.id === active) }, t.label))),
    host));

  if (/^ncard_/.test(item)) return (await entryPage(host, item, { kind: 'netcards', back: `${BASE}/cards`, backLabel: 'Card Forge' })) ?? {};
  if (active === 'cards') return cardForge(host);
  if (active === 'builder') return builder.mount(host);
  return networks.mount(host, { id: /^net_/.test(item) ? item : null });
}

// --- Card Forge ---------------------------------------------------------------------------------

const LIB_KEY = () => `tempest.${currentProjectId()}.netrun.library`;

/** The Forge's designer for net cards, under a library of the cards made so far. */
async function cardForge(host) {
  const library = el('details', { class: 'tp-frame tp-panel nr-library' });
  library.open = store.get(LIB_KEY()) !== 'closed';
  library.addEventListener('toggle', () => store.set(LIB_KEY(), library.open ? 'open' : 'closed'));
  const forgeHost = el('div', { class: 'nr-forge' });
  host.append(library, forgeHost);

  async function drawLibrary() {
    const cards = await entitiesApi('netcards').list().catch(() => []);
    const groups = NET_CARD_TYPES.map((t) => ({ type: t, cards: cards.filter((c) => c.category === t.id) })).filter((g) => g.cards.length);
    library.replaceChildren(
      el('summary', { class: 'tp-panel__head nr-library__head' },
        el('h2', { class: 'tp-panel__title' }, 'Your net cards'),
        el('span', { class: 'tp-badge' }, String(cards.length)),
        el('span', { class: 'tp-dim nr-library__hint' }, 'Open a card to edit, push or delete it. Make new ones with Create New below.')),
      el('div', { class: 'tp-panel__body' },
        cards.length
          ? groups.map((g) => el('section', { class: 'nr-library__group' },
              el('h3', { class: 'tp-label' }, g.type.label),
              el('ul', { class: 'nr-library__list' }, g.cards.map((c) => el('li', {}, cardChip(c, { href: `${BASE}/${c.id}` }))))))
          : el('p', { class: 'tp-muted' }, 'No net cards yet. Pick a preset (or start from a template with New ▾), then fill in Create New below.')));
  }
  await drawLibrary();
  const handle = await designer.mount(forgeHost, { kind: 'netcards', onCreated: drawLibrary });
  return handle ?? {};
}
