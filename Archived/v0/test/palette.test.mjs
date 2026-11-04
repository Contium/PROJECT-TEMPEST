import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMatch } from '../app/palette.js';

const rank = (names, q) => names.map((n) => [n, scoreMatch(n, q).score]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([n]) => n);

test('exact beats prefix beats word prefix beats initials beats substring beats scattered letters', () => {
  const s = (t, q) => scoreMatch(t, q).score;
  assert.ok(s('Kabuki', 'kabuki') > s('Kabuki Night Market', 'kabuki'));
  assert.ok(s('Kabuki Night Market', 'kabuki') > s('Patch\'s Kabuki Clinic', 'kabuki'));
  assert.ok(s('Patch\'s Kabuki Clinic', 'kabuki') > s('Kabuki Night Market', 'knm'));
  assert.ok(s('Kabuki Night Market', 'knm') > s('Maelstrom', 'strom'));
  assert.ok(s('Maelstrom', 'strom') > s('Maelstrom', 'mlsm'));
  assert.equal(s('Maelstrom', 'zzz'), 0);
  assert.equal(s('Maelstrom', ''), 0);
});

test('ranking a realistic list', () => {
  const names = ['Wakako Okada', 'Okada owes Patch', 'Kabuki Night Market', 'Kabuki', 'Tyger Claws', 'Rogue Drone Rampages Through Watson!'];
  assert.deepEqual(rank(names, 'kab'), ['Kabuki', 'Kabuki Night Market']);
  assert.deepEqual(rank(names, 'okada').slice(0, 2), ['Okada owes Patch', 'Wakako Okada']);
  assert.deepEqual(rank(names, 'drone'), ['Rogue Drone Rampages Through Watson!']);
  // Initials (Tyger Claws) outrank a plain substring ("Pa-tc-h")
  assert.deepEqual(rank(names, 'tc'), ['Tyger Claws', 'Okada owes Patch']);
});

test('the matched span is reported for highlighting', () => {
  assert.deepEqual(scoreMatch('Wakako Okada', 'oka'), { score: 75, start: 7, end: 10 });
  assert.deepEqual(scoreMatch('Tyger Claws', 'tyg'), { score: 89.2, start: 0, end: 3 });
});
