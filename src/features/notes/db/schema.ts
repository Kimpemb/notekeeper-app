// src/features/notes/db/schema.ts
// Each entry in ALL_MIGRATIONS is a single, complete SQL statement.
// tauri-plugin-sql executes one statement per db.execute() call.

export const ALL_MIGRATIONS: string[] = [
  // ── Tables ──────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT 'Untitled',
    content     TEXT NOT NULL DEFAULT '{}',
    plaintext   TEXT NOT NULL DEFAULT '',
    tags        TEXT,
    parent_id   TEXT REFERENCES notes(id) ON DELETE SET NULL,
    sync_id     TEXT NOT NULL UNIQUE,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS note_versions (
    id          TEXT PRIMARY KEY,
    note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    plaintext   TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS backlinks (
    source_id   TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    target_id   TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    PRIMARY KEY (source_id, target_id)
  )`,

  `CREATE TABLE IF NOT EXISTS note_visits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id     TEXT NOT NULL,
    visited_at  INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS app_settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  )`,

  // ── Indexes ──────────────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_notes_parent_id  ON notes(parent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_versions_note_id ON note_versions(note_id)`,
  `CREATE INDEX IF NOT EXISTS idx_backlinks_target ON backlinks(target_id)`,
  `CREATE INDEX IF NOT EXISTS idx_visits_note_id   ON note_visits(note_id)`,

  // ── FTS5 virtual table ───────────────────────────────────────────────────
  `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    id UNINDEXED,
    title,
    plaintext,
    content='notes',
    content_rowid='rowid'
  )`,

  // ── FTS triggers ─────────────────────────────────────────────────────────
  `CREATE TRIGGER IF NOT EXISTS notes_fts_insert
    AFTER INSERT ON notes
    BEGIN
      INSERT INTO notes_fts(rowid, id, title, plaintext)
      VALUES (new.rowid, new.id, new.title, new.plaintext);
    END`,

  `CREATE TRIGGER IF NOT EXISTS notes_fts_update
    AFTER UPDATE ON notes
    BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, id, title, plaintext)
      VALUES ('delete', old.rowid, old.id, old.title, old.plaintext);
      INSERT INTO notes_fts(rowid, id, title, plaintext)
      VALUES (new.rowid, new.id, new.title, new.plaintext);
    END`,

  `CREATE TRIGGER IF NOT EXISTS notes_fts_delete
    AFTER DELETE ON notes
    BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, id, title, plaintext)
      VALUES ('delete', old.rowid, old.id, old.title, old.plaintext);
    END`,

  // ── Version snapshot trigger ─────────────────────────────────────────────
  `CREATE TRIGGER IF NOT EXISTS notes_version_on_update
    AFTER UPDATE OF content ON notes
    WHEN new.content != old.content
    BEGIN
      INSERT INTO note_versions(id, note_id, content, plaintext, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        new.id,
        old.content,
        old.plaintext,
        old.updated_at
      );
    END`,

  // ── Version prune trigger ────────────────────────────────────────────────
  `CREATE TRIGGER IF NOT EXISTS notes_version_prune
    AFTER INSERT ON note_versions
    BEGIN
      DELETE FROM note_versions
      WHERE note_id = NEW.note_id
        AND id NOT IN (
          SELECT id FROM note_versions
          WHERE note_id = NEW.note_id
          ORDER BY created_at DESC
          LIMIT 50
        );
    END`,
];