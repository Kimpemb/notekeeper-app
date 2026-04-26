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

  // ── sort_order column (migration — safe to run on existing DBs) ───────────
  `ALTER TABLE notes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`,

  // Week 3 — Semantic Similarity
  `CREATE TABLE IF NOT EXISTS suggestion_feedback (
    source_id   TEXT    NOT NULL,
    target_id   TEXT    NOT NULL,
    action      TEXT    NOT NULL CHECK(action IN ('accepted', 'ignored')),
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (source_id, target_id)
  )`,

  // ── Frontmatter column for structured metadata (Week 4) ──────────────────
  `ALTER TABLE notes ADD COLUMN frontmatter TEXT`,

  `CREATE TABLE IF NOT EXISTS note_blocks (
    block_id    TEXT NOT NULL,
    note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    block_type  TEXT NOT NULL DEFAULT 'paragraph',
    plaintext   TEXT NOT NULL DEFAULT '',
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (block_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_blocks_note_id ON note_blocks(note_id)`,

  `CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
    block_id UNINDEXED,
    note_id  UNINDEXED,
    plaintext,
    content='note_blocks',
    content_rowid='rowid'
  )`,

  `CREATE TRIGGER IF NOT EXISTS blocks_fts_insert
    AFTER INSERT ON note_blocks
    BEGIN
      INSERT INTO blocks_fts(rowid, block_id, note_id, plaintext)
      VALUES (new.rowid, new.block_id, new.note_id, new.plaintext);
    END`,

  `CREATE TRIGGER IF NOT EXISTS blocks_fts_update
    AFTER UPDATE ON note_blocks
    BEGIN
      INSERT INTO blocks_fts(blocks_fts, rowid, block_id, note_id, plaintext)
      VALUES ('delete', old.rowid, old.block_id, old.note_id, old.plaintext);
      INSERT INTO blocks_fts(rowid, block_id, note_id, plaintext)
      VALUES (new.rowid, new.block_id, new.note_id, new.plaintext);
    END`,

  `CREATE TRIGGER IF NOT EXISTS blocks_fts_delete
    AFTER DELETE ON note_blocks
    BEGIN
      INSERT INTO blocks_fts(blocks_fts, rowid, block_id, note_id, plaintext)
      VALUES ('delete', old.rowid, old.block_id, old.note_id, old.plaintext);
    END`,

  `CREATE TABLE IF NOT EXISTS ai_summaries (
    note_id     TEXT    PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
    summary     TEXT    NOT NULL,
    note_hash   INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS ai_tag_cache (
    note_id     TEXT    PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
    tags        TEXT    NOT NULL,
    note_hash   INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS ai_history (
    id          TEXT    PRIMARY KEY,
    note_id     TEXT    NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    role        TEXT    NOT NULL CHECK(role IN ('user', 'assistant')),
    content     TEXT    NOT NULL,
    created_at  INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_ai_history_note_id ON ai_history(note_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS embeddings (
    block_id    TEXT    NOT NULL,
    note_id     TEXT    NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    model_id    TEXT    NOT NULL,
    vector      BLOB    NOT NULL,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (block_id, model_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_embeddings_note_id ON embeddings(note_id)`,

  `CREATE TABLE IF NOT EXISTS embedding_jobs (
    block_id        TEXT    PRIMARY KEY,
    note_id         TEXT    NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    status          TEXT    NOT NULL DEFAULT 'pending'
                            CHECK(status IN ('pending','processing','done','failed')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    updated_at      INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_embedding_jobs_status
    ON embedding_jobs(status, next_attempt_at)`,

  `CREATE TABLE IF NOT EXISTS ai_conversation_summary (
    note_id     TEXT    PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
    summary     TEXT    NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS canvases (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT 'Untitled Canvas',
    data       TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `ALTER TABLE notes ADD COLUMN is_canvas INTEGER NOT NULL DEFAULT 0`,

  `ALTER TABLE notes ADD COLUMN canvas_state TEXT DEFAULT NULL`,

  // ── RAG v3 — new tables (appended, safe on existing DBs) ─────────────────
  // note_blocks v3 schema is rebuilt via migrateNoteBlocksV3() in initDb,
  // not here, because it requires DROP + recreate with new columns.
  // These two tables are genuinely new — no prior version exists.

  `CREATE TABLE IF NOT EXISTS note_title_chunks (
    note_id     TEXT    NOT NULL PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    source_type TEXT    NOT NULL DEFAULT 'note',
    updated_at  INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS embedding_quota_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id TEXT    NOT NULL,
    model_id    TEXT    NOT NULL,
    requests    INTEGER NOT NULL DEFAULT 0,
    date        TEXT    NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_quota_log_provider_date
    ON embedding_quota_log(provider_id, date)`,

    // ── Slot Rotation & Quota Management ─────────────────────────────────────

// Add key_id to embedding_quota_log and rebuild unique constraint
`ALTER TABLE embedding_quota_log ADD COLUMN key_id TEXT NOT NULL DEFAULT ''`,

`CREATE UNIQUE INDEX IF NOT EXISTS idx_quota_log_unique
  ON embedding_quota_log(provider_id, model_id, key_id, date)`,

`CREATE TABLE IF NOT EXISTS exhaustion_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id     TEXT    NOT NULL,
  model_id        TEXT    NOT NULL,
  key_id          TEXT    NOT NULL,
  slot            TEXT    NOT NULL,
  reason          TEXT    NOT NULL,
  exhausted_at    INTEGER NOT NULL,
  last_checked_at INTEGER,
  recovered_at    INTEGER
)`,

`CREATE TABLE IF NOT EXISTS exhaustion_log_archive (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id     TEXT    NOT NULL,
  model_id        TEXT    NOT NULL,
  key_id          TEXT    NOT NULL,
  slot            TEXT    NOT NULL,
  reason          TEXT    NOT NULL,
  exhausted_at    INTEGER NOT NULL,
  last_checked_at INTEGER,
  recovered_at    INTEGER,
  archived_at     INTEGER NOT NULL
)`,
];