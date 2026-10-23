import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

let db;

const MIGRATIONS = [
  `
  CREATE TABLE members (
    id INTEGER PRIMARY KEY,
    last_name TEXT NOT NULL DEFAULT '',
    first_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT NOT NULL DEFAULT '',
    voice_part TEXT NOT NULL DEFAULT '',
    is_admin INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE member_choirs (
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    choir TEXT NOT NULL,
    PRIMARY KEY (member_id, choir)
  );

  CREATE TABLE login_codes (
    id INTEGER PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL DEFAULT '',
    end_time TEXT NOT NULL DEFAULT '',
    starts_at TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    venue TEXT NOT NULL DEFAULT '',
    is_tour INTEGER NOT NULL DEFAULT 0,
    deadline_at TEXT NOT NULL,
    dress_rehearsal_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    published_at TEXT,
    closed_at TEXT,
    report_sent_at TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    external_uid TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE event_choirs (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    choir TEXT NOT NULL,
    PRIMARY KEY (event_id, choir)
  );

  CREATE TABLE responses (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    set_by_admin INTEGER NOT NULL DEFAULT 0,
    responded_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (event_id, member_id)
  );

  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read_at TEXT
  );
  CREATE INDEX notifications_member ON notifications(member_id, created_at);

  CREATE TABLE reminder_log (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    sent_at TEXT NOT NULL
  );
  CREATE INDEX reminder_log_event_member ON reminder_log(event_id, member_id, kind);

  CREATE TABLE push_subscriptions (
    id INTEGER PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE email_log (
    id INTEGER PRIMARY KEY,
    to_address TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // A naptárból legutóbb importált értékek – újraimportáláskor csak a naptárban változott mezőket írjuk felül.
  `ALTER TABLE events ADD COLUMN external_data TEXT;`,
  // Melyik naptárból jött az esemény – a naptárból törölt események felismeréséhez.
  `ALTER TABLE events ADD COLUMN external_source TEXT;`,
  // Meghívottak: 'all' = a kórus(ok) minden tagja, 'selected' = csak az event_invites-ban szereplők.
  `ALTER TABLE events ADD COLUMN invite_mode TEXT NOT NULL DEFAULT 'all';
  CREATE TABLE event_invites (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, member_id)
  );`,
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate();
  return db;
}

function migrate() {
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let i = version; i < MIGRATIONS.length; i++) {
    tx(() => {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
}

export function getDb() {
  if (!db) throw new Error('Az adatbázis nincs megnyitva');
  return db;
}

let depth = 0;
export function tx(fn) {
  // Egymásba ágyazott hívásnál a külső tranzakció a mérvadó.
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}

export const nowIso = (now = new Date()) => new Date(now).toISOString();
