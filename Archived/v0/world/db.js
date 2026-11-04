// SQLite access for campaign files. Uses Node's built-in node:sqlite (no installs).

// node:sqlite is stable in practice but still flagged experimental; keep that one
// warning out of the logs without hiding any others.
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const text = typeof warning === 'string' ? warning : warning?.message;
  if (text && text.includes('SQLite is an experimental feature')) return;
  return emitWarning.call(process, warning, ...rest);
};

const { DatabaseSync } = require('node:sqlite');

// Each entry upgrades the schema by one version. Never edit a shipped entry;
// append a new one.
const MIGRATIONS = [
  `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL            -- JSON
  );

  CREATE TABLE entity_types (
    id      TEXT PRIMARY KEY,
    name    TEXT NOT NULL,
    plural  TEXT NOT NULL,
    lex_key TEXT,                  -- theme lexicon key for the display name
    fields  TEXT NOT NULL,         -- JSON array of field definitions
    builtin INTEGER NOT NULL DEFAULT 0,
    hidden  INTEGER NOT NULL DEFAULT 0
  );

  -- Append-only source of truth. Current state is a projection of this table.
  CREATE TABLE changes (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    batch       TEXT NOT NULL,     -- one GM action; undone/redone as a unit
    event_id    TEXT,              -- in-world event that caused this change
    game_time   INTEGER NOT NULL,  -- minutes since the campaign calendar epoch
    recorded_at TEXT NOT NULL,     -- real-world ISO timestamp
    session_id  TEXT,
    entity_id   TEXT NOT NULL,
    op          TEXT NOT NULL CHECK (op IN ('create', 'update', 'delete', 'restore')),
    patch       TEXT NOT NULL,     -- JSON: flat keys (name, visibility, secretFields, data.<key>)
    prior       TEXT,              -- JSON: values those keys had just before, for diffs
    note        TEXT,
    undone_at   TEXT
  );
  CREATE INDEX changes_entity ON changes (entity_id, game_time, seq);
  CREATE INDEX changes_batch ON changes (batch);
  CREATE INDEX changes_time ON changes (game_time, seq);

  -- Projection: every entity as of the world clock.
  CREATE TABLE entities (
    id            TEXT PRIMARY KEY,
    type          TEXT NOT NULL,
    name          TEXT NOT NULL,
    visibility    TEXT NOT NULL,
    secret_fields TEXT NOT NULL,   -- JSON array
    data          TEXT NOT NULL,   -- JSON object
    deleted       INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX entities_type ON entities (type, deleted);

  -- Projection: relation entities indexed by endpoint.
  CREATE TABLE relations (
    id      TEXT PRIMARY KEY,
    from_id TEXT NOT NULL,
    to_id   TEXT NOT NULL,
    kind    TEXT NOT NULL,
    value   REAL,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX relations_from ON relations (from_id, kind);
  CREATE INDEX relations_to ON relations (to_id, kind);

  CREATE VIRTUAL TABLE entities_fts USING fts5 (id UNINDEXED, name, body);
  `,
  `
  -- v2: types carry a presentation order and a navigation category.
  ALTER TABLE entity_types ADD COLUMN ord INTEGER NOT NULL DEFAULT 1000;
  ALTER TABLE entity_types ADD COLUMN category TEXT NOT NULL DEFAULT 'extra';
  `,
  `
  -- v3: images live inside the universe file, content-addressed so the same
  -- upload is stored once. Not history-tracked: entities reference them by id.
  CREATE TABLE assets (
    id         TEXT PRIMARY KEY,
    mime       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    data       BLOB NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
];

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/** Run fn inside a write transaction; rolls back on throw. */
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDb, transaction, SCHEMA_VERSION: MIGRATIONS.length };
