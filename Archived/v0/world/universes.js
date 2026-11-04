// Universe library: one `<id>.tempest` SQLite file per universe.
// Kept in %LOCALAPPDATA% by default rather than Documents, because cloud-synced
// folders (OneDrive) can corrupt live SQLite files. Override with TEMPEST_UNIVERSES_DIR.

const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('../launcher/paths');
const { Universe } = require('./universe');
const { badRequest, notFound } = require('./errors');

const EXT = '.tempest';
const UNIVERSE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LEGACY_DIR = path.join(DATA_DIR, 'campaigns'); // before universes existed

class UniverseLibrary {
  #open = new Map();

  constructor(dir = process.env.TEMPEST_UNIVERSES_DIR || path.join(DATA_DIR, 'universes')) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    if (dir === path.join(DATA_DIR, 'universes')) this.#adoptLegacy();
  }

  // Move files from the old campaigns folder (each one becomes a universe and
  // upgrades its model on first open). Files already present here are left alone.
  #adoptLegacy() {
    if (!fs.existsSync(LEGACY_DIR)) return;
    for (const file of fs.readdirSync(LEGACY_DIR)) {
      const target = path.join(this.dir, file);
      if (!fs.existsSync(target)) fs.renameSync(path.join(LEGACY_DIR, file), target);
    }
    if (!fs.readdirSync(LEGACY_DIR).length) fs.rmdirSync(LEGACY_DIR);
  }

  #file(id) {
    return path.join(this.dir, `${id}${EXT}`);
  }

  list() {
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith(EXT))
      .map((f) => {
        const id = path.basename(f, EXT);
        try {
          const meta = this.open(id).meta();
          return { ...meta, modified: fs.statSync(this.#file(id)).mtime.toISOString() };
        } catch (err) {
          return { id, error: err.message };
        }
      })
      .sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? ''));
  }

  open(id) {
    if (!UNIVERSE_ID.test(id ?? '')) throw badRequest(`Invalid universe id "${id}"`);
    let universe = this.#open.get(id);
    if (!universe) {
      if (!fs.existsSync(this.#file(id))) throw notFound(`No universe "${id}"`);
      universe = new Universe(this.#file(id));
      this.#open.set(id, universe);
    }
    return universe;
  }

  /** Create a universe; its id is derived from the name ("Night City!" → night-city, night-city-2…). */
  create(options) {
    const base = slugify(options?.id ?? options?.name ?? '') || 'universe';
    let id = base;
    for (let n = 2; fs.existsSync(this.#file(id)); n++) id = `${base}-${n}`;
    const universe = Universe.create(this.#file(id), options);
    this.#open.set(id, universe);
    return universe;
  }

  closeAll() {
    for (const universe of this.#open.values()) universe.close();
    this.#open.clear();
  }
}

function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

module.exports = { UniverseLibrary, slugify };
