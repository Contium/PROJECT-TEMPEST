// TEMPEST theme engine — loads, hot-swaps and persists themes at runtime.
//
// A theme is a folder in /themes containing theme.json (manifest) and a
// stylesheet that scopes its token overrides to :root[data-theme="<id>"].
// A variant declares "extends": "<parent id>"; its parent's stylesheet loads
// first, data-theme stays the parent id and data-variant carries the variant
// id, so variant CSS scopes to :root[data-theme="<parent>"][data-variant="<id>"].
//
// The new stylesheets are fully loaded before data-theme flips, so swaps never
// flash unstyled content. Theme and effects level propagate to every other
// open TEMPEST window (e.g. a player-facing display) through the storage event.

const THEME_KEY = 'tempest.theme';
const EFFECTS_KEY = 'tempest.effects';
const ENTER_ATTR = 'data-theme-entering';
const ENTER_MS = 600;
const SWAP_ATTR = 'data-theme-swapping';

/** Intensity of decorative effects (scanlines, glitch, boot flicker…). Themes read :root[data-effects]. */
export const EFFECT_LEVELS = ['off', 'subtle', 'full'];
const DEFAULT_EFFECTS = 'subtle';

function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — setting still applies for this window */
  }
}

function loadStylesheet(href, marker) {
  const existing = document.head.querySelector(`link[data-tp="${marker}"][href="${CSS.escape(href)}"]`);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.tp = marker;
    link.onload = () => resolve(link);
    link.onerror = () => reject(new Error(`Failed to load ${href}`));
    document.head.append(link);
  });
}

// Later manifests in the chain win; lexicon and font lists merge.
function mergeChain(chain) {
  return chain.reduce(
    (acc, m) => ({
      ...acc,
      ...m,
      lexicon: { ...acc.lexicon, ...m.lexicon },
      fonts: { stylesheets: [...new Set([...(acc.fonts?.stylesheets ?? []), ...(m.fonts?.stylesheets ?? [])])] },
    }),
    {},
  );
}

export class ThemeEngine extends EventTarget {
  #registryUrl;
  #root;
  #themes = [];
  #manifests = new Map();
  #current = null;
  #pending = null;

  constructor({ registryUrl = '/api/themes', root = document.documentElement } = {}) {
    super();
    this.#registryUrl = registryUrl;
    this.#root = root;
  }

  /** Fetch the installed-theme registry and apply the stored (or default) theme + effects level. */
  async init() {
    const storedEffects = readStored(EFFECTS_KEY);
    this.setEffects(EFFECT_LEVELS.includes(storedEffects) ? storedEffects : DEFAULT_EFFECTS, { persist: false });

    await this.refresh();
    window.addEventListener('storage', (e) => {
      if (!e.newValue) return;
      if (e.key === THEME_KEY && e.newValue !== this.#current?.id) this.apply(e.newValue, { persist: false });
      if (e.key === EFFECTS_KEY && e.newValue !== this.effects) this.setEffects(e.newValue, { persist: false });
    });
    const stored = readStored(THEME_KEY);
    const initial = this.#themes.find((t) => t.id === stored) || this.#themes.find((t) => t.default) || this.#themes[0];
    if (!initial) throw new Error('No themes installed');
    await this.apply(initial.id, { animate: false });
    return this;
  }

  /** Re-read the registry, e.g. after a theme folder was added on disk. */
  async refresh() {
    const res = await fetch(this.#registryUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Theme registry unavailable (${res.status})`);
    this.#themes = await res.json();
    this.#manifests.clear();
    this.dispatchEvent(new CustomEvent('registry', { detail: this.list() }));
    return this.list();
  }

  list() {
    return this.#themes.map((t) => ({ ...t }));
  }

  /** The active theme's resolved manifest (variant merged over its parents). */
  get current() {
    return this.#current;
  }

  get effects() {
    return this.#root.dataset.effects;
  }

  setEffects(level, { persist = true } = {}) {
    if (!EFFECT_LEVELS.includes(level)) throw new Error(`Unknown effects level "${level}"`);
    this.#root.dataset.effects = level;
    if (persist) writeStored(EFFECTS_KEY, level);
    this.dispatchEvent(new CustomEvent('effects', { detail: { level } }));
  }

  async manifest(id) {
    if (this.#manifests.has(id)) return this.#manifests.get(id);
    const entry = this.#themes.find((t) => t.id === id);
    if (!entry) throw new Error(`Unknown theme "${id}"`);
    const res = await fetch(`${entry.path}theme.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Manifest for "${id}" unavailable (${res.status})`);
    const manifest = { ...(await res.json()), id, path: entry.path };
    this.#manifests.set(id, manifest);
    return manifest;
  }

  /** Root-first list of manifests: [base, …, id]. */
  async #resolveChain(id, seen = new Set()) {
    if (seen.has(id)) throw new Error(`Theme inheritance loop at "${id}"`);
    seen.add(id);
    const own = await this.manifest(id);
    return own.extends ? [...(await this.#resolveChain(own.extends, seen)), own] : [own];
  }

  /** Hot-swap to another theme. Concurrent calls resolve to the last request. */
  async apply(id, { persist = true, animate = true } = {}) {
    const token = Symbol(id);
    this.#pending = token;

    const chain = await this.#resolveChain(id);
    const manifest = mergeChain(chain);
    const sheets = chain.map((m) => ({ href: `${m.path}${m.stylesheet}`, marker: `theme:${m.id}` }));
    await Promise.all([
      ...sheets.map((s) => loadStylesheet(s.href, s.marker)),
      ...manifest.fonts.stylesheets.map((href) => loadStylesheet(href, 'font').catch(() => null)), // fonts are optional: fall back offline
    ]);
    if (this.#pending !== token) return this.#current;

    const previous = this.#current;
    // Commit the swap with transitions off (components.css), then force a style
    // flush so every element already holds the new theme's values when they come
    // back on. Without this, each frame/button/link would start a crossfade from
    // the old theme's colours, which never finishes while frames are throttled.
    this.#root.setAttribute(SWAP_ATTR, '');
    this.#root.dataset.theme = chain[0].id;
    if (chain.length > 1) this.#root.dataset.variant = id;
    else delete this.#root.dataset.variant;
    // Drop outgoing theme stylesheets only after the new ones are live.
    const keep = new Set(sheets.map((s) => s.marker));
    document.head.querySelectorAll('link[data-tp^="theme:"]').forEach((link) => keep.has(link.dataset.tp) || link.remove());
    void this.#root.offsetWidth; // style + layout flush, pseudo-elements included
    this.#root.removeAttribute(SWAP_ATTR);
    if (animate) {
      this.#root.setAttribute(ENTER_ATTR, '');
      setTimeout(() => this.#root.removeAttribute(ENTER_ATTR), ENTER_MS);
    }

    this.#current = manifest;
    this.applyLexicon();
    if (persist) writeStored(THEME_KEY, id);
    this.dispatchEvent(new CustomEvent('change', { detail: { theme: manifest, previous } }));
    return manifest;
  }

  /** Look up a themed term, e.g. t('currency') → "Eurobucks". */
  t(key, fallback = key) {
    return this.#current?.lexicon?.[key] ?? fallback;
  }

  /** Fill every [data-lex="key"] element under `scope` with the themed term. */
  applyLexicon(scope = document) {
    scope.querySelectorAll('[data-lex]').forEach((el) => {
      el.textContent = this.t(el.dataset.lex, el.textContent);
      if (el.hasAttribute('data-text')) el.dataset.text = el.textContent; // keep .tp-glitch mirror in sync
    });
  }
}
