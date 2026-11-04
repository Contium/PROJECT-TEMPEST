import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, resolve, visibleSections } from '../app/sections.js';

const at = (path, opts) => {
  const r = resolve(path, opts);
  return r.kind === 'section' ? `${r.section.id}/${r.tab?.id ?? ''}` : r.kind === 'redirect' ? `→ ${r.to}` : r.kind;
};

test('the sections and their tabs', () => {
  assert.deepEqual(SECTIONS.map((s) => [s.label, s.tabs.map((t) => t.label)]), [
    ['Characters', ['Players', 'NPCs', 'Monsters', 'Creatures']],
    ['World', ['Events', 'Stories', 'Rumors', 'Screamsheets', 'Timeline']],
    ['World View', []],
    ['Combat', []],
    ['Items', []],
    ['The Forge', ['Characters/Creatures', 'Stories/Rumors/Events', 'Items']],
  ]);
});

test('The Forge opens on its preset chooser, and each preset type has its own address', () => {
  assert.equal(at('/forge'), 'forge/');
  assert.equal(at('/forge', { lastTab: () => 'items' }), 'forge/', 'the chooser, not the last preset');
  assert.equal(at('/forge/characters'), 'forge/characters');
  assert.equal(at('/forge/stories'), 'forge/stories');
  assert.equal(at('/forge/items'), 'forge/items');
  assert.equal(at('/forge/spells'), '→ /forge');
});

test('hash paths resolve to sections and tabs', () => {
  assert.equal(at('/characters/npcs'), 'characters/npcs');
  assert.equal(at('#/world/stories/'), 'world/stories');
  assert.equal(at('/world/timeline'), 'world/timeline');
  assert.equal(resolve('/world/screamsheets/new').item, 'new', 'the generator');
  assert.equal(at('/combat'), 'combat/');
  assert.equal(at('/items'), 'items/');
  assert.equal(at('/player'), 'player');
  assert.equal(at('/projects'), 'projects');
  assert.equal(at('/settings'), 'settings');
});

test('character tabs open single entries by id', () => {
  const r = resolve('/characters/npcs/char_0a1b2c3d');
  assert.deepEqual([r.kind, r.tab.id, r.item], ['section', 'npcs', 'char_0a1b2c3d']);
  assert.equal(at('/characters/npcs/a/b'), '→ /characters/players');
  assert.equal(at('/world/events/story_0a1b2c3d'), 'world/events');
  assert.equal(at('/world/timeline/story_0a1b2c3d'), '→ /characters/players', 'only tabs with detail pages');
  assert.equal(at('/characters/npcs/../x'), '→ /characters/players');
});

test('anything else redirects somewhere sensible', () => {
  assert.equal(at('/'), '→ /characters/players');
  assert.equal(at('/nowhere'), '→ /characters/players');
  assert.equal(at('/characters'), '→ /characters/players', 'a section opens on its first tab');
  assert.equal(at('/characters', { lastTab: () => 'monsters' }), '→ /characters/monsters', '…or the tab you were last on');
  assert.equal(at('/characters', { lastTab: () => 'gone' }), '→ /characters/players');
  assert.equal(at('/characters/dragons'), '→ /characters/players');
  assert.equal(at('/combat/round-1'), '→ /combat', 'sections without tabs take no tab');
  assert.equal(resolve('/items/item_0a1b2c3d').item, 'item_0a1b2c3d', '…but Items opens entries by id');
  assert.equal(at('/items/a/b'), '→ /characters/players');
  assert.equal(at('/world/events/one/two'), '→ /characters/players');
});

test('World View shows only while the map system is Planetary', () => {
  const ids = (mode) => visibleSections({ settings: { maps: { mode } } }).map((s) => s.id);
  assert.ok(ids('planetary').includes('worldview'));
  for (const mode of [null, 'planar', 'cartographer', 'galactic']) assert.ok(!ids(mode).includes('worldview'), String(mode));
  assert.ok(!visibleSections(null).some((s) => s.id === 'worldview'));
  assert.equal(at('/worldview'), 'worldview/');
  assert.equal(resolve('/worldview/nightcity').item, 'nightcity', 'a unique location\'s own map');
});
