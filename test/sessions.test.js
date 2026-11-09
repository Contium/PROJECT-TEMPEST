// Sessions and handouts (app/sessions/session-model.js): checked saves, the players' copies
// (never GM notes or obscured text), pushing them, and the players' Codex.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectLibrary } = require('../server/projects');
const { createDisplay } = require('../server/display');
const { createCodex } = require('../server/codex');

const model = () => import('../app/sessions/session-model.js');

test('sessions and handouts are checked and cleaned', async () => {
  const M = await model();
  const s = M.normalizeSession({
    number: '3.4', title: '  Cold Storage ', date: '2026-11-14', status: 'nonsense',
    plan: [{ text: 'Meet Ledger' }, { text: '   ' }, { id: 'b123456', text: 'Second crew', done: true }, { id: 'b123456', text: 'duplicate id' }],
    cast: ['char_12345678', 'char_12345678', 'sess_12345678', 'hand_12345678', 'nope'],
    recapShared: 'yes',
  });
  assert.equal(s.number, 3);
  assert.equal(s.title, 'Cold Storage');
  assert.equal(s.status, 'planned');
  assert.deepEqual(s.plan.map((b) => b.text), ['Meet Ledger', 'Second crew'], 'blank lines and repeated ids are dropped');
  assert.match(s.plan[0].id, /^b[0-9a-f]{6}$/);
  assert.deepEqual(s.cast, ['char_12345678'], 'only entries, once each');
  assert.equal(s.recapShared, false);
  assert.equal(M.normalizeSession({ date: '2026-13-45' }).date, null);
  assert.throws(() => M.normalizeSession({ plan: Array.from({ length: 61 }, (_, i) => ({ text: `line ${i}` })) }), M.SessionError);

  const h = M.normalizeHandout({ title: '', style: 'scroll', image: 'nope', obscure: 'blurred', session: 'sess_00000001' });
  assert.deepEqual([h.title, h.style, h.image, h.obscure, h.session, h.revealed], ['Untitled handout', 'letter', null, null, 'sess_00000001', false]);
  assert.equal(M.sessionTitle({ number: 2, title: '' }), 'Session 2');
  assert.equal(M.sessionTitle({ number: 2, title: 'Patient Zero' }), 'Session 2: Patient Zero');
});

test('players get recaps and handouts, never notes or obscured words', async () => {
  const M = await model();
  const recap = M.playerRecap(M.normalizeSession({ id: 'sess_00000001', number: 1, title: 'One', notes: 'GM secret', plan: [{ text: 'secret beat' }], recap: 'What they saw' }));
  assert.deepEqual(Object.keys(recap).sort(), ['date', 'id', 'number', 'recap', 'title']);
  const h = M.normalizeHandout({ id: 'hand_00000001', title: 'Intercept', style: 'datapad', text: 'Kill the witnesses', obscure: 'encrypted' });
  const copy = M.playerHandout(h);
  assert.equal(copy.text, '');
  assert.equal(copy.length, 'Kill the witnesses'.length, 'how much is hidden, not what');
  assert.ok(!JSON.stringify(copy).includes('witnesses'));
  assert.equal(M.playerHandout({ ...h, obscure: null }).text, 'Kill the witnesses');
  assert.deepEqual(M.sessionsForPlayers([
    { id: 'sess_00000001', number: 1, recap: 'a', recapShared: true },
    { id: 'sess_00000002', number: 2, recap: '', recapShared: true },
    { id: 'sess_00000003', number: 3, recap: 'c', recapShared: false },
    { id: 'sess_00000004', number: 4, recap: 'd', recapShared: true },
  ]).map((r) => r.number), [4, 1], 'shared recaps only, latest first');
});

test('pushing a handout or a recap shares it, and the Codex holds them as players see them', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-sessions-'));
  try {
    const library = createProjectLibrary(dir);
    const project = await library.create({ name: 'Night Shift' });
    const stores = await library.open(project.id);
    const display = createDisplay(path.join(dir, 'display.json'), library);
    const codex = createCodex(library);

    const night = await stores.sessions.create({ number: 1, title: 'Cold Storage', notes: 'The client is Arasaka', recap: '' });
    assert.match(night.id, /^sess_[0-9a-f]{8}$/);
    const note = await stores.handouts.create({ title: 'Intercept', style: 'datapad', text: 'Leave nobody alive', obscure: 'static', session: night.id });
    const letter = await stores.handouts.create({ title: 'Ledger\'s contract', style: 'letter', text: 'Half up front.' });
    assert.equal((await stores.handouts.create({ title: 'x', style: 'note', text: 'y'.repeat(9000) })).text.length, 8000, 'long text is cut, not refused');

    assert.deepEqual((await codex.list()).entries.filter((x) => ['handouts', 'sessions'].includes(x.group)), [], 'nothing shared yet');
    await assert.rejects(codex.entry(note.id), /Not in the Codex/);
    await assert.rejects(display.push({ mode: 'recap', project: project.id, id: night.id }), /no recap yet/);

    const shown = await display.push({ mode: 'handout', project: project.id, id: note.id });
    assert.equal(shown.madeKnown, true);
    assert.equal(shown.title, 'Intercept');
    assert.equal(shown.handout.obscure, 'static');
    assert.ok(!JSON.stringify(shown).includes('nobody alive'), 'obscured words never reach a screen');
    assert.equal((await stores.handouts.get(note.id)).revealed, true);
    // The old image-only handout push still works the same way.
    await assert.rejects(display.push({ mode: 'handout', project: project.id, image: 'img_000000000000000000000000' }), /./);

    await stores.sessions.save(night.id, { ...night, recap: 'They got Sato out.\n\nNot everyone did.' });
    const recap = await display.push({ mode: 'recap', project: project.id, id: night.id });
    assert.equal(recap.title, 'Session 1: Cold Storage');
    assert.equal(recap.madeKnown, true);
    assert.ok(!JSON.stringify(recap).includes('Arasaka'), 'GM notes stay with the GM');

    const all = await codex.list();
    const listed = all.entries.filter((x) => ['handouts', 'sessions'].includes(x.group));
    assert.deepEqual(listed.map((x) => [x.group, x.title, x.summary]), [
      ['handouts', 'Intercept', 'Static'],
      ['sessions', 'Cold Storage', 'They got Sato out.'],
    ]);
    assert.ok(!JSON.stringify(all).includes(letter.title), 'unrevealed handouts stay out');
    assert.equal((await codex.entry(night.id)).recap.recap, 'They got Sato out.\n\nNot everyone did.');
    assert.ok(!JSON.stringify(await codex.entry(note.id)).includes('nobody alive'));

    // Cracked: the GM clears the text, and the players can read it.
    await stores.handouts.save(note.id, { ...(await stores.handouts.get(note.id)), obscure: null });
    assert.equal((await codex.entry(note.id)).handout.text, 'Leave nobody alive');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
