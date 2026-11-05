// Records every version of every demo file TEMPEST has shipped (demo/history.json), so an
// installed demo can be brought up to date safely (server/demo.js): a file that still
// matches one of these versions was never touched by the GM and can be replaced with the
// new one (or removed, if the demo dropped it); anything else the GM changed stays theirs.
//
// Versions come from the history kept so far, the current demo files, the repository's
// commits (when git is available), and any earlier copies of demo/projects given on the
// command line. Run it after changing the demo, before shipping:
//
//   node scripts/build-demo-history.mjs [<an older copy of demo/projects> …]
//   (GIT=<path to git> picks the git to use; without one, commits are skipped)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fingerprint } = require('../server/demo.js');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = path.join(ROOT, 'demo', 'projects');
const OUT = path.join(ROOT, 'demo', 'history.json');
const PROJECT_ID = /^proj_[0-9a-f]{8}$/;

let history = {};
try {
  history = JSON.parse(fs.readFileSync(OUT, 'utf8'));
} catch {
  /* first run */
}
let added = 0;
const remember = (id, rel, content) => {
  const list = (history[id] ??= {})[rel] ??= [];
  const h = fingerprint(content);
  if (!list.includes(h)) (list.push(h), (added += 1));
};

/** Every file of every project under a copy of demo/projects. */
function addTree(base) {
  if (!fs.existsSync(base)) return console.warn(`skipped ${base}: not found`);
  for (const id of fs.readdirSync(base).filter((n) => PROJECT_ID.test(n))) {
    const dir = path.join(base, id);
    for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!e.isFile() || e.name.endsWith('.tmp')) continue;
      const full = path.join(e.parentPath ?? e.path, e.name);
      remember(id, path.relative(dir, full).split(path.sep).join('/'), fs.readFileSync(full));
    }
  }
}

addTree(DEMO);
for (const extra of process.argv.slice(2)) addTree(path.resolve(extra));

// Every committed version.
const git = process.env.GIT || 'git';
try {
  const run = (...args) => execFileSync(git, args, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
  const revs = run('log', '--format=%H', '--', 'demo/projects').toString().split('\n').filter(Boolean);
  for (const rev of revs) {
    const files = run('ls-tree', '-r', '--name-only', rev, 'demo/projects').toString().split('\n').filter(Boolean);
    for (const file of files) {
      const [, , id, ...rest] = file.split('/');
      if (!PROJECT_ID.test(id) || !rest.length) continue;
      remember(id, rest.join('/'), run('show', `${rev}:${file}`));
    }
  }
  console.log(`read ${revs.length} commit${revs.length === 1 ? '' : 's'}`);
} catch (err) {
  console.warn(`commits skipped (${err.code === 'ENOENT' ? 'no git found; set GIT' : err.message.split('\n')[0]})`);
}

// Sorted, so the file only changes when a version is added.
const sorted = Object.fromEntries(Object.keys(history).sort().map((id) => [id, Object.fromEntries(Object.keys(history[id]).sort().map((rel) => [rel, history[id][rel]]))]));
fs.writeFileSync(OUT, `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`demo/history.json: ${added} new version${added === 1 ? '' : 's'}`);
