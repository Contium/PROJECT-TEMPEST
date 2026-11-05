// Combat › Netrunning: net cards (a preset kind with Stat Blocks), networks, and
// what players get when one is pushed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectLibrary } = require('../server/projects');
const { createDisplay } = require('../server/display');

const load = async () => ({
  P: await import('../app/forge/preset-model.js'),
  E: await import('../app/forge/entity-model.js'),
  N: await import('../app/netrun/network-model.js'),
  T: await import('../app/forge/templates/index.js'),
});

/** The Steeltooth Bar architecture: a line that branches after the cameras and merges at the Hellhounds. */
function steeltooth(N) {
  const ids = ['n000001', 'n000002', 'n000003', 'n000004', 'n000005', 'n000006', 'n000007', 'n000008'];
  const [pw6, skunk, cams, pw8, liche, file, alarm, hounds] = ids;
  return N.normalizeNetwork({
    name: 'Steeltooth Bar',
    nodes: [
      { id: pw6, label: 'Password', dv: '6', parents: [] },
      { id: skunk, label: 'Skunk', parents: [pw6] },
      { id: cams, label: 'Control Node (Cameras)', dv: '8', parents: [skunk] },
      { id: pw8, label: 'Password', dv: '8', parents: [cams] },
      { id: liche, label: 'Liche, Raven', parents: [cams] },
      { id: file, label: 'File', dv: '8', parents: [pw8], note: 'Payroll for the bouncers' },
      { id: alarm, label: 'Control Node (Alarm)', dv: '8', parents: [liche] },
      { id: hounds, label: 'Hellhound', count: 2, parents: [file, alarm] },
    ],
  });
}

test('Stat Blocks: named stats in a row, short text values', async () => {
  const { P, E } = await load();
  const f = P.newField('statblock', 'netcards');
  assert.equal(f.stats.length, 3);
  const p = P.newPreset('ICE', 'netcards');
  p.fields.stats = { ...f, id: 'stats', stats: [{ id: 'per', label: 'PER' }, { id: 'per', label: 'Again' }, { id: 'BAD id', label: '' }], default: { per: 4, nope: 1 } };
  p.layout.main.push('stats');
  const clean = P.normalizePreset(p);
  const stats = clean.fields.stats.stats;
  assert.deepEqual(stats.map((s) => s.label), ['PER', 'Again', 'STAT']);
  assert.equal(new Set(stats.map((s) => s.id)).size, 3, 'ids made unique');
  assert.deepEqual(clean.fields.stats.default, { per: '4' }, 'numbers become text; unknown stats dropped');
  const card = E.forge(clean, { values: { name: 'Hellhound', category: 'ice', stats: { per: '6', [stats[1].id]: 'x'.repeat(40), [stats[2].id]: '  ' } } });
  assert.deepEqual(card.values.stats, { per: '6', [stats[1].id]: 'x'.repeat(12) }, 'trimmed to 12 characters, blanks left out');
  assert.ok(P.addableOf('characters').some((a) => a.type === 'statblock'), 'monsters can have stat blocks too');
});

test('net cards are their own kind, filed under Combat › Netrunning', async () => {
  const { P, E } = await load();
  assert.deepEqual(P.categoriesOf('netcards').map((c) => c.id), ['password', 'file', 'control', 'ice', 'demon', 'other']);
  const card = E.forge(P.newPreset('Card', 'netcards'), { values: { name: 'Skunk', category: 'ice', dv: '6' } });
  assert.match(card.id, /^ncard_[0-9a-f]{8}$/);
  assert.equal(E.kindOfId(card.id), 'netcards');
  assert.equal(E.hrefOf(card), `#/combat/netrunning/${card.id}`);
  assert.throws(() => P.newField('cast', 'netcards'), /can be added/);
});

test('the Cyberpunk RED net card templates build valid presets', async () => {
  const { P, E, T } = await load();
  const net = T.templatesFor('netcards');
  assert.deepEqual(net.map((t) => t.id), ['cyberpunk-red-black-ice', 'cyberpunk-red-demon', 'cyberpunk-red-net-node']);
  for (const t of net) {
    const p = P.normalizePreset(t.build());
    assert.equal(p.kind, 'netcards', t.id);
    E.forge(p, { values: { ...E.defaultValues(p), name: 'Test' } });
  }
  const ice = P.normalizePreset(T.templatesFor('netcards')[0].build());
  assert.deepEqual(ice.fields.ice_stats.stats.map((s) => s.label), ['PER', 'SPD', 'ATK', 'DEF', 'REZ']);
});

test('networks are checked: links only to real nodes, never in a loop', async () => {
  const { N } = await load();
  assert.throws(() => N.normalizeNetwork({ name: ' ' }), /needs a name/);
  const net = N.normalizeNetwork({
    name: 'Loop',
    nodes: [
      { id: 'n00000a', parents: ['n00000c'] },
      { id: 'n00000b', parents: ['n00000a', 'n00000a', 'n00000b', 'nowhere'] },
      { id: 'n00000c', parents: ['n00000b'], card: 'char_0000beef', count: 400 },
      { id: 'n00000a', parents: [] },
      { id: 'bad' },
    ],
    revealed: ['n00000b', 'gone'],
    hints: 'yes',
  });
  assert.deepEqual(net.nodes.map((n) => n.id), ['n00000a', 'n00000b', 'n00000c'], 'duplicates and bad ids dropped');
  assert.deepEqual(net.nodes.map((n) => n.parents), [['n00000c'], ['n00000a'], []], 'the link that closed the loop is dropped');
  assert.equal(net.nodes[2].card, null, 'only net cards');
  assert.equal(net.nodes[2].count, 99);
  assert.deepEqual(net.revealed, ['n00000b']);
  assert.equal(net.hints, false);
  assert.equal(N.canLink(net, 'n00000b', 'n00000c'), false, 'b is below c already');
});

test('the layout draws the architecture as the rulebook does', async () => {
  const { N } = await load();
  const net = steeltooth(N);
  const { pos, cols, rows } = N.layout(net);
  const at = (i) => [pos[net.nodes[i].id].x, pos[net.nodes[i].id].y];
  assert.deepEqual([cols, rows], [2, 6]);
  assert.deepEqual(at(0), [0.5, 0], 'the line runs down the middle…');
  assert.deepEqual(at(2), [0.5, 2]);
  assert.deepEqual([at(3), at(4)], [[0, 3], [1, 3]], '…branches in two…');
  assert.deepEqual([at(5), at(6)], [[0, 4], [1, 4]]);
  assert.deepEqual(at(7), [0.5, 5], '…and merges at the Hellhounds, below both');
  assert.deepEqual(N.readingOrder(net).map((n) => n.label).slice(0, 5), ['Password', 'Skunk', 'Control Node (Cameras)', 'Password', 'Liche, Raven']);
});

test('editing a network', async () => {
  const { N } = await load();
  let net = N.newNetwork('Test');
  let r = N.addNode(net, null, 'ncard_00000001');
  const top = r.id;
  r = N.addNode(r.net, top);
  const mid = r.id;
  r = N.addNode(r.net, mid);
  const low = r.id;
  net = r.net;
  assert.deepEqual(net.nodes.map((n) => n.parents), [[], [top], [mid]]);
  const removed = N.removeNode(net, mid);
  assert.deepEqual(removed.nodes.find((n) => n.id === low).parents, [top], 'what hung below moves up');
  assert.deepEqual(N.removeBranch(net, mid).nodes.map((n) => n.id), [top], 'a branch goes with its node');
  const ins = N.insertAbove(net, low);
  assert.deepEqual(ins.net.nodes.find((n) => n.id === low).parents, [ins.id]);
  assert.deepEqual(ins.net.nodes.find((n) => n.id === ins.id).parents, [mid]);
  net = { ...net, revealed: [top] };
  assert.equal(N.nextToReveal(net).id, mid, 'the next one down');
});

test('players see only revealed nodes, never GM notes; hints show blank boxes', async () => {
  const { N, P, E } = await load();
  const M = await import('../app/push/push-model.js');
  const p = P.newPreset('Node', 'netcards');
  const secret = { ...P.newField('longtext', 'netcards'), id: 'contents', label: 'Contents', visibility: 'rumored' };
  p.fields.contents = secret;
  p.layout.main.push('contents');
  const card = { ...E.forge(P.normalizePreset(p), { values: { name: 'Payroll File', category: 'file', dv: '8', contents: 'Bouncer wages' } }), id: 'ncard_0000f11e' };
  const base = steeltooth(N);
  base.nodes[5].card = card.id;
  base.nodes[5].label = '';
  const [pw6, skunk, , , , file] = base.nodes.map((n) => n.id);

  const none = N.playerNetwork({ ...base, revealed: [] }, new Map(), M.playerEntity);
  assert.deepEqual(none.nodes, [], 'nothing revealed, nothing shown');
  const hinted = N.playerNetwork({ ...base, revealed: [pw6], hints: true }, new Map(), M.playerEntity);
  assert.deepEqual(hinted.nodes.map((n) => [n.id, n.hidden]), [[pw6, false], [skunk, true]], 'the way ahead, as a blank box');
  assert.equal(hinted.nodes[1].title, undefined);

  const view = N.playerNetwork({ ...base, revealed: [pw6, file] }, new Map([[card.id, card]]), M.playerEntity, { focus: file });
  assert.deepEqual(view.nodes.map((n) => n.id), [pw6, file]);
  assert.deepEqual(view.nodes[1].parents, [], 'links only between nodes players can see');
  assert.equal(view.nodes[1].title, 'Payroll File', 'no label: the card\'s name, as its sheet allows');
  assert.equal(view.nodes[1].type, 'File');
  assert.equal(view.nodes[1].dv, '8');
  assert.equal(view.focus, file);
  const text = JSON.stringify(view);
  assert.ok(!text.includes('Bouncer wages') && !text.includes('Payroll for the bouncers'), 'rumored card fields and GM notes stay with the GM');
  assert.equal(N.playerNetwork({ ...base, revealed: [pw6] }, new Map(), null, { focus: file }).focus, null, 'a hidden node is never lit');
});

test('networks are stored per project and pushed as the players\' copy', async () => {
  const { N, P, E } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-net-'));
  try {
    const library = createProjectLibrary(dir);
    const project = await library.create({ name: 'Run' });
    const stores = await library.open(project.id);
    const made = await stores.netcards.create(E.forge(P.newPreset('Card', 'netcards'), { values: { name: 'Skunk', category: 'ice' } }));
    assert.equal((await stores.netcards.list())[0].name, 'Skunk');
    const net = steeltooth(N);
    net.nodes[1].card = made.id;
    const saved = await stores.networks.create(net);
    assert.match(saved.id, /^net_[0-9a-f]{8}$/);
    assert.equal((await stores.networks.list())[0].name, 'Steeltooth Bar');

    const display = createDisplay(path.join(dir, 'display.json'), library);
    const shown = await display.push({ mode: 'network', project: project.id, id: saved.id, focus: net.nodes[1].id });
    assert.equal(shown.title, 'Steeltooth Bar');
    assert.deepEqual(shown.network.nodes, [], 'nothing revealed yet');
    assert.equal(shown.network.focus, null);

    await stores.networks.save(saved.id, { ...saved, revealed: [net.nodes[0].id, net.nodes[1].id] });
    const later = await display.push({ mode: 'network', project: project.id, id: saved.id, focus: net.nodes[1].id });
    assert.deepEqual(later.network.nodes.map((n) => n.title), ['Password', 'Skunk']);
    assert.equal(later.network.nodes[1].card.name, 'Skunk', 'the lit node brings its card, as players see it');
    assert.ok(!JSON.stringify(later).includes('Payroll for the bouncers'));
    await assert.rejects(display.push({ mode: 'network', project: project.id, id: 'net_00000000' }), /No such network/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
