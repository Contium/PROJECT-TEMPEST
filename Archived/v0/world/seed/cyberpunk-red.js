// Creates the "Cyberpunk RED (Sample)" universe: every level of the model, from
// Sol down to individual contacts, with eras reaching back before play began,
// a few days of in-play history, reveal-gated secrets and one scheduled event.
// Run: npm run seed   (skips if the sample already exists)

const { UniverseLibrary } = require('../universes');

const ID = 'cyberpunk-red-sample';
const EPOCH = '2045-08-01T00:00';
/** Game minutes for an ISO date-time in this universe's calendar. */
const at = (iso) => (Date.parse(`${iso}Z`) - Date.parse(`${EPOCH}Z`)) / 60_000;

const library = new UniverseLibrary();
if (library.list().some((x) => x.id === ID)) {
  console.log(`Sample universe "${ID}" already exists in ${library.dir}`);
  process.exit(0);
}

const u = library.create({
  id: ID,
  name: 'Cyberpunk RED (Sample)',
  system: 'Cyberpunk RED',
  theme: 'cyberpunk-red',
  summary: 'Two decades after the Fourth Corporate War. The Net is gone, the megacorps are rebuilding, and Night City runs on chrome, favours and fear.',
  calendar: { type: 'gregorian', epoch: EPOCH },
});

const known = { visibility: 'known' };
const make = (type, id, name, data = {}, extra = {}) => ({ op: 'create', type, id, name, data, ...known, ...extra });
const share = (id, from, fromName, to, toName, value) =>
  make('relation', id, `${fromName} controls ${toName}`, { from, to, kind: 'controls', value });
const update = (id, data) => ({ op: 'update', id, data });

// --- Deep background, recorded long before play so it exists in every era ---------
u.setClock(at('2020-01-01T00:00'));
u.applyBatch({
  note: 'Setting background',
  ops: [
    make('era', 'era_war', 'Fourth Corporate War', { start: at('2021-01-01T00:00'), end: at('2025-01-01T00:00'), summary: 'Arasaka and Militech drag the world into open war. Ends with the Net shattered and Night City scarred.' }),
    make('era', 'era_red', 'Time of the Red', { start: at('2025-01-01T00:00'), summary: 'The long red dusk after the war: rebuilding, local power, and no global Net.' }),

    make('system', 'sys_sol', 'Sol', { kind: 'Star system' }),
    make('world', 'wld_earth', 'Earth', { kind: 'Planet', parent: 'sys_sol' }),

    make('nation', 'nat_nusa', 'New United States', { parent: 'wld_earth', government: 'Federal republic (in name)', tier: 5 }),
    make('nation', 'nat_norcal', 'Free State of Northern California', { parent: 'wld_earth', government: 'Free State', tier: 3 }),

    make('global_faction', 'gfa_arasaka', 'Arasaka', { kind: 'Megacorp', tier: 5, parent: 'wld_earth', goals: 'Return to Night City and finish what the war started.' }),
    make('global_faction', 'gfa_militech', 'Militech', { kind: 'Megacorp', tier: 5, parent: 'wld_earth', members: ['nat_nusa'], summary: 'Arms giant and the New US government\'s favourite contractor.' }),

    make('religion', 'rel_rebuilt', 'Church of the Rebuilt', {
      deities: 'The Rebuilt Saint', tier: 2,
      tenets: 'Flesh fails; faith and good chrome endure. Every scar is a prayer.',
      secrets: 'The Church launders eurobucks for a Maelstrom chop-shop.',
    }),

    make('region', 'reg_nc', 'Night City', { parent: 'nat_norcal', population: 5_800_000, threat: 4, summary: 'A Free City on the coast, rebuilt around the crater of Arasaka Tower.' }),
    make('region', 'reg_watson', 'Watson', { parent: 'reg_nc', threat: 3, summary: 'Northern borough, gutted by the corporate pull-out and run by whoever holds the block.' }),

    make('regional_faction', 'rfa_council', 'Night City Council', { kind: 'City government', parent: 'reg_nc', tier: 3 }),
    make('regional_faction', 'rfa_ncpd', 'NCPD', { kind: 'Police', parent: 'reg_nc', tier: 4 }),

    make('community', 'com_kabuki', 'Kabuki', {
      kind: 'District', parent: 'reg_watson', population: 48_200, threat: 3, governed_by: 'rfa_council', bribe: 350,
      tags: ['night-market', 'black-clinics'],
      summary: 'Night market district under the old monorail. Stalls run hot goods, braindance rigs and black-clinic chrome. Power has been shifting since the last raid.',
      gm_notes: 'Maelstrom is probing the Claws here before a real push.',
    }),

    make('group', 'grp_claws', 'Tyger Claws', { kind: 'Gang', tier: 4, base: 'com_kabuki', parent: 'gfa_arasaka', goals: 'Push Maelstrom out of Watson for good.' },
      { secretFields: ['parent'] }), // nobody knows they answer to Arasaka
    make('group', 'grp_maelstrom', 'Maelstrom', { kind: 'Gang', tier: 3, base: 'reg_watson', goals: 'Take the clinics: chrome supply.' }),
    make('group', 'grp_merchants', 'Kabuki Stallholders', { kind: 'Merchant guild', tier: 1, base: 'com_kabuki' }),

    make('place', 'plc_market', 'Kabuki Night Market', { kind: 'Market', parent: 'com_kabuki', owner: 'grp_claws', threat: 2 }),
    make('place', 'plc_clinic', "Patch's Clinic", { kind: 'Black clinic', parent: 'com_kabuki', threat: 2 }),
  ],
});

u.applyBatch({
  gameTime: at('2023-08-20T09:00'),
  event: { name: 'Arasaka Tower destroyed', visibility: 'known', data: { severity: 5, location: 'reg_nc', participants: ['gfa_arasaka', 'gfa_militech'] } },
});

// --- Play begins -------------------------------------------------------------------
u.setClock(at('2045-08-01T12:00'));
u.applyBatch({
  note: 'Campaign setup',
  ops: [
    make('team', 'tem_crew', 'The Crew', { kind: 'Edgerunner crew', base: 'com_kabuki', summary: 'The players.' }),
    make('team', 'tem_squad', 'Pylon Squad', { kind: 'Strike team', parent: 'grp_maelstrom', base: 'reg_watson' }, { visibility: 'hidden' }),

    make('individual', 'ind_rook', 'Rook', {
      role: 'Solo', pc: true, player: 'Sam', tier: 3, affiliation: 'tem_crew', location: 'com_kabuki', nation: 'nat_norcal', status: 'alive', disposition: 'allied',
      hp: 40, armor: 11, initiative: 8,
    }),
    make('individual', 'ind_vex', 'Vex', {
      role: 'Netrunner', pc: true, player: 'Alex', tier: 3, affiliation: 'tem_crew', location: 'com_kabuki', status: 'alive', disposition: 'allied',
      hp: 30, armor: 7, initiative: 6, slots: 'NET actions 3, Programs 4',
    }),

    // The GM's bestiary: stat blocks that join fights as numbered mooks.
    make('combatant', 'mob_ganger', 'Maelstrom Ganger', {
      kind: 'Chromed street soldier', tier: 2, affiliation: 'grp_maelstrom', side: 'enemy', hp: 25, armor: 7, initiative: 5,
      attacks: 'Heavy pistol 3d6 · Brawling 2d6 · Grenade (1)',
    }, { visibility: 'hidden' }),
    make('combatant', 'mob_drone', 'Security Drone', {
      kind: 'Flying combat drone', tier: 2, side: 'enemy', hp: 15, armor: 11, initiative: 7, attacks: 'SMG 2d6, autofire',
    }, { visibility: 'hidden' }),
    make('combatant', 'mob_ncpd', 'NCPD Beat Cop', {
      kind: 'Police officer', tier: 1, affiliation: 'rfa_ncpd', side: 'neutral', hp: 30, armor: 11, initiative: 4,
      attacks: 'Heavy pistol 3d6 · Stun baton 2d6',
    }, { visibility: 'hidden' }),
    make('individual', 'ind_okada', 'Wakako Okada', {
      role: 'Fixer', tier: 5, affiliation: 'grp_claws', location: 'plc_market', status: 'alive', disposition: 'neutral',
      motive: 'Wants Maelstrom bled before she commits Claws soldiers.',
    }),
    make('individual', 'ind_patch', 'Jun "Patch" Mori', { role: 'Ripperdoc', tier: 3, location: 'plc_clinic', religion: 'rel_rebuilt', status: 'alive', disposition: 'friendly' }),
    make('individual', 'ind_silvia', 'Silvia Ro', {
      role: 'Netrunner', tier: 4, memberships: ['grp_maelstrom'], status: 'alive', disposition: 'neutral',
      rumor: 'A netrunner who sells Claws comm logs to anyone paying.', motive: 'Working for Maelstrom.',
    }, { visibility: 'rumored', secretFields: ['memberships'] }),
    make('individual', 'ind_bigdee', 'Big Dee', { role: 'Bouncer', tier: 2, affiliation: 'grp_merchants', location: 'plc_market', status: 'alive', disposition: 'neutral' }),
    make('individual', 'ind_vendor', 'Stall Vendor', { role: 'Merchant', tier: 1, affiliation: 'grp_merchants', location: 'plc_market', status: 'alive' }),
    make('individual', 'ind_hollow', 'Kenji Hollow', { role: 'Maelstrom infiltrator', tier: 3, affiliation: 'grp_maelstrom', memberships: ['tem_squad'], status: 'alive', disposition: 'hostile' }, { visibility: 'hidden' }),

    update('plc_clinic', { owner: 'ind_patch' }),

    share('rel_claws_kabuki', 'grp_claws', 'Tyger Claws', 'com_kabuki', 'Kabuki', 0.7),
    share('rel_maelstrom_kabuki', 'grp_maelstrom', 'Maelstrom', 'com_kabuki', 'Kabuki', 0.1),
    share('rel_ncpd_kabuki', 'rfa_ncpd', 'NCPD', 'com_kabuki', 'Kabuki', 0.14),
    share('rel_merchants_kabuki', 'grp_merchants', 'Kabuki Stallholders', 'com_kabuki', 'Kabuki', 0.06),
    make('relation', 'rel_okada_patch', 'Okada owes Patch', { from: 'ind_okada', to: 'ind_patch', kind: 'owes a favour to', value: 2, summary: 'Patch kept her alive through a bad cyberpsychosis scare.' }),
    make('relation', 'rel_dee_silvia', 'Big Dee distrusts Silvia', { from: 'ind_bigdee', to: 'ind_silvia', kind: 'distrusts', value: -1 }),

    make('campaign', 'cmp_kabuki', 'Kabuki Heat', { status: 'active', era: 'era_red', party: 'tem_crew', started: at('2045-08-01T18:00'), summary: 'The crew gets caught between the Claws and Maelstrom as Kabuki tips toward war.' }),
    make('session', 'ses_12', 'Gig #12', { campaign: 'cmp_kabuki', number: 12, started: at('2045-08-01T18:00'), played_on: '2026-10-30' }),
  ],
});
u.setMeta({ active_session: 'ses_12' });

u.setClock(at('2045-08-01T18:37'));
u.applyBatch({ event: { name: 'Crew paid 1,200 eb for safe passage', visibility: 'known', data: { severity: 1, location: 'com_kabuki', participants: ['tem_crew'] } } });

u.setClock(at('2045-08-02T20:03'));
u.applyBatch({
  event: { name: 'NCPD patrol frequency reduced: budget cuts', visibility: 'known', data: { severity: 2, location: 'com_kabuki', participants: ['rfa_ncpd'] } },
  ops: [update('rel_ncpd_kabuki', { value: 0.11 }), update('rel_claws_kabuki', { value: 0.73 })],
});

u.setClock(at('2045-08-03T21:50'));
u.applyBatch({
  event: { name: 'Okada posts a job: retrieve a stolen shard from a clinic', visibility: 'known', data: { severity: 2, participants: ['ind_okada', 'tem_crew'] } },
  ops: [update('ind_okada', { disposition: 'friendly' })],
});

u.setClock(at('2045-08-03T22:14'));
u.applyBatch({
  event: { name: 'Maelstrom crew spotted near the monorail pylons', visibility: 'known', data: { severity: 4, location: 'com_kabuki', participants: ['grp_maelstrom'] } },
  ops: [update('rel_maelstrom_kabuki', { value: 0.21 }), update('rel_claws_kabuki', { value: 0.62 }), update('com_kabuki', { threat: 4 })],
});

u.setClock(at('2045-08-03T23:00'));

// Scheduled: the GM's plan if the crew doesn't intervene.
u.applyBatch({
  gameTime: at('2045-08-04T03:00'),
  note: 'Planned escalation if the crew does not intervene',
  event: { name: 'Maelstrom ambush at the night market', visibility: 'hidden', data: { severity: 5, location: 'plc_market', participants: ['tem_squad', 'ind_bigdee', 'ind_hollow'] } },
  ops: [update('ind_bigdee', { status: 'injured' }), update('com_kabuki', { threat: 5 })],
});

const meta = u.meta();
console.log(`Created "${meta.name}" (${ID}) at ${library.dir}`);
console.log(`World clock: ${meta.clockLabel} (${meta.era?.name}) — ${u.list().length} entities, ${u.timeline({ limit: 1000 }).length} batches`);
library.closeAll();
