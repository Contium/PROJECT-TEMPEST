import { test } from 'node:test';
import assert from 'node:assert/strict';

// A minimal DOM: just enough of document/head/<html> for ThemeEngine.apply().
const SWAP = 'data-theme-swapping';
const log = [];

function makeRoot() {
  const attrs = new Map();
  const data = {};
  const root = {
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    hasAttribute: (k) => attrs.has(k),
    get offsetWidth() {
      // A layout read: this is where the browser computes the new theme's styles.
      log.push({ flush: true, theme: data.theme, variant: data.variant, swapping: attrs.has(SWAP), links: head.links.map((l) => l.dataset.tp) });
      return 1;
    },
  };
  root.dataset = new Proxy(data, {
    set(t, k, v) {
      if (k === 'theme') log.push({ set: v, swapping: attrs.has(SWAP) });
      t[k] = v;
      return true;
    },
  });
  return root;
}

const head = {
  links: [],
  append(link) {
    link.remove = () => (this.links = this.links.filter((l) => l !== link));
    this.links.push(link);
    queueMicrotask(() => link.onload?.());
  },
  querySelector(sel) {
    const [, tp, href] = sel.match(/data-tp="([^"]*)"\]\[href="([^"]*)"/);
    return this.links.find((l) => l.dataset.tp === tp && l.href === href) ?? null;
  },
  querySelectorAll(sel) {
    const prefix = sel.match(/data-tp\^="([^"]*)"/)[1];
    return this.links.filter((l) => l.dataset.tp.startsWith(prefix));
  },
};

const THEMES = [
  { id: 'cyberpunk-red', path: '/themes/cyberpunk-red/', default: true },
  { id: 'neo-kitsch', path: '/themes/neo-kitsch/' },
  { id: 'moontown', path: '/themes/moontown/' },
];
const MANIFESTS = {
  'cyberpunk-red': { stylesheet: 'theme.css' },
  'neo-kitsch': { stylesheet: 'theme.css', extends: 'cyberpunk-red' },
  moontown: { stylesheet: 'theme.css' },
};

const root = makeRoot();
globalThis.document = {
  documentElement: root,
  head,
  createElement: () => ({ dataset: {} }),
  querySelectorAll: () => [],
};
globalThis.window = { addEventListener() {} };
globalThis.CSS = { escape: (s) => s };
globalThis.fetch = async (url) => {
  if (url === '/api/themes') return { ok: true, json: async () => THEMES };
  const t = THEMES.find((x) => url === `${x.path}theme.json`);
  return { ok: true, json: async () => MANIFESTS[t.id] };
};

const { ThemeEngine } = await import('../src/theme-engine/theme-engine.js');

test('a theme swap is committed with transitions suppressed, then re-enabled after a style flush', async () => {
  const engine = new ThemeEngine({ root });
  await engine.refresh();
  await engine.apply('cyberpunk-red', { animate: false, persist: false });

  log.length = 0;
  await engine.apply('moontown', { animate: false, persist: false });

  assert.deepEqual(log, [
    { set: 'moontown', swapping: true },
    // The flush sees the new theme, the old stylesheet already gone, and transitions still off.
    { flush: true, theme: 'moontown', variant: undefined, swapping: true, links: ['theme:moontown'] },
  ]);
  assert.equal(root.hasAttribute(SWAP), false, 'transitions are back on once the swap is committed');
  assert.equal(root.dataset.theme, 'moontown');
});

test('variants swap the same way and keep their parent stylesheet', async () => {
  const engine = new ThemeEngine({ root });
  await engine.refresh();
  await engine.apply('moontown', { animate: false, persist: false });

  log.length = 0;
  await engine.apply('neo-kitsch', { animate: false, persist: false });

  assert.deepEqual(log, [
    { set: 'cyberpunk-red', swapping: true },
    { flush: true, theme: 'cyberpunk-red', variant: 'neo-kitsch', swapping: true, links: ['theme:cyberpunk-red', 'theme:neo-kitsch'] },
  ]);
  assert.equal(root.hasAttribute(SWAP), false);
});
