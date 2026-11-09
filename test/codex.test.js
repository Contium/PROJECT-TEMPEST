// The players' Codex (server/codex.js): only what the players know of, each entry only as
// its own sheet allows; pushing an entry makes it known.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectLibrary } = require('../server/projects');
const { createDisplay } = require('../server/display');
const { createCodex, handleCodex } = require('../server/codex');

const load = async () => ({
  E: await import('../app/forge/entity-model.js'),
  T: await import('../app/forge/templates/cyberpunk-red-player.js'),
});

test('the Codex holds known entries, revealed news and places, and nothing else', async () => {
  const { E, T } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-codex-'));
  try {
    const library = createProjectLibrary(dir);
    const codex = createCodex(library);
    await assert.rejects(codex.list(), /No campaign/);
    const project = await library.create({ name: 'Night Shift' });
    const stores = await library.open(project.id);
    const preset = T.build();
    // A secret on the sheet: the Notes field is Rumored.
    preset.fields.cpr_notes.visibility = 'rumored';
    const make = (name, extra = {}) => stores.characters.create({ ...E.forge(preset, { values: { ...E.defaultValues(preset), name, category: 'npc', cpr_notes: 'Works for Arasaka' } }), ...extra });
    const fixer = await make('Padre', { known: true });
    const secret = await make('The Mole');
    assert.equal(fixer.known, true, 'known is kept on save');
    assert.equal(secret.known, undefined);
    await stores.screamsheets.create({ headline: 'Hidden story', body: 'x', revealed: false });
    const news = await stores.screamsheets.create({ headline: 'Gang war in Heywood', body: 'First paragraph.\n\nSecond.', revealed: true });
    await stores.pois.create({ name: 'Secret lab', type: 'poi', lon: 1, lat: 2, revealed: false });
    await stores.pois.create({ name: 'Afterlife', type: 'landmark', lon: 3, lat: 4, revealed: true });

    const all = await codex.list();
    assert.equal(all.project.name, 'Night Shift');
    assert.deepEqual(all.entries.map((x) => x.title).sort(), ['Afterlife', 'Gang war in Heywood', 'Padre']);
    assert.deepEqual(all.groups.map((g) => g.id), ['players', 'npcs', 'monsters', 'creatures', 'world', 'factions', 'items', 'news', 'places', 'handouts', 'sessions'], 'every tab, People only when needed');
    const padre = all.entries.find((x) => x.title === 'Padre');
    assert.deepEqual([padre.group, padre.sub], ['npcs', 'NPC'], 'characters get their category\'s tab');
    assert.equal(all.entries.find((x) => x.id === news.id).summary, 'First paragraph.');

    const sheet = await codex.entry(fixer.id);
    assert.equal(sheet.entity.name, 'Padre');
    assert.equal(sheet.entity.values.cpr_notes, undefined, 'Rumored fields never reach players');
    assert.ok(!JSON.stringify(sheet).includes('Arasaka'));
    await assert.rejects(codex.entry(secret.id), /Not in the Codex/);
    await assert.rejects(codex.entry('ss_00000000'), /Not in the Codex/);
    assert.equal((await codex.entry(news.id)).article.headline, 'Gang war in Heywood');

    // A sheet that hides its category: under People, so the tab gives nothing away.
    const hidden = structuredClone(preset);
    hidden.fields.category.visibility = 'rumored';
    const beast = await stores.characters.create({ ...E.forge(hidden, { values: { ...E.defaultValues(hidden), name: 'Something', category: 'monster' } }), known: true });
    const listed = (await codex.list()).entries.find((x) => x.id === beast.id);
    assert.deepEqual([listed.group, listed.sub], ['people', 'Character']);

    // Pushing an entry puts it in the Codex.
    const display = createDisplay(path.join(dir, 'display.json'), library);
    const shown = await display.push({ mode: 'entity', project: project.id, id: secret.id });
    assert.equal(shown.madeKnown, true);
    assert.equal(display.get().madeKnown, undefined, 'only the pusher hears it');
    assert.equal((await codex.entry(secret.id)).entity.name, 'The Mole');
    assert.equal((await display.push({ mode: 'entity', project: project.id, id: secret.id })).madeKnown, undefined);

    // The route.
    const res = {};
    const ok = await handleCodex(codex, { method: 'GET' }, res, `/api/codex/${encodeURIComponent('char_ffffffff')}`, { sendJson: (r, status, data) => Object.assign(r, { status, data }) });
    assert.equal(ok, true);
    assert.equal(res.status, 404);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
