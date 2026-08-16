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

  // ── Phase 3 — RAG Exclusion & Breadcrumbs (M10) ──────────────────────────

  // M10a — rag_excluded flag on notes
  `ALTER TABLE notes ADD COLUMN rag_excluded INTEGER NOT NULL DEFAULT 0`,

  // M10b — breadcrumb on note_title_chunks
  `ALTER TABLE note_title_chunks ADD COLUMN breadcrumb TEXT`,

  // M10c — breadcrumb on embeddings
  `ALTER TABLE embeddings ADD COLUMN breadcrumb TEXT`,

  // ── Chat Sessions (persistent chat history per note) ─────────────────────
  `CREATE TABLE IF NOT EXISTS chat_sessions (
    note_id            TEXT     PRIMARY KEY,
    messages           TEXT     NOT NULL DEFAULT '[]',
    persisted_meta     TEXT     NOT NULL DEFAULT '[]',
    linked_note_id     TEXT,
    linked_note_title  TEXT,
    last_saved_at      INTEGER,
    rag_scope          TEXT     NOT NULL DEFAULT 'all',
    web_search_enabled INTEGER  NOT NULL DEFAULT 0,
    updated_at         INTEGER  NOT NULL
  )`,

  // ── Chat session Recents titles (feature/chat-session-recents) ───────────
  `ALTER TABLE chat_sessions ADD COLUMN summary_title TEXT`,

  `ALTER TABLE chat_sessions ADD COLUMN summary_title_generated INTEGER NOT NULL DEFAULT 0`,

  // ── File Import (feature/file-import) ────────────────────────────────────
  `ALTER TABLE notes ADD COLUMN source_type TEXT NOT NULL DEFAULT 'note'`,

  `ALTER TABLE notes ADD COLUMN source_file TEXT`,

  `ALTER TABLE notes ADD COLUMN source_meta TEXT`,

  // ── Calendar + Goals + Score (feature/calendar-goals-score) ──────────────

  `CREATE TABLE IF NOT EXISTS calendar_events (
    id              TEXT    NOT NULL PRIMARY KEY,
    title           TEXT    NOT NULL,
    date            TEXT    NOT NULL,
    time            TEXT,
    duration_mins   INTEGER,
    category        TEXT    NOT NULL DEFAULT 'personal',
    source_id       TEXT,
    source_type     TEXT,
    colour_state    TEXT    NOT NULL DEFAULT 'blue',
    recurrence      TEXT,
    recurrence_end  TEXT,
    notes           TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_calendar_events_date
    ON calendar_events(date)`,

  `CREATE INDEX IF NOT EXISTS idx_calendar_events_source
    ON calendar_events(source_id, source_type)`,

  `CREATE TABLE IF NOT EXISTS calendar_event_occurrences (
    id              TEXT    NOT NULL PRIMARY KEY,
    event_id        TEXT    NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    occurrence_date TEXT    NOT NULL,
    colour_state    TEXT    NOT NULL DEFAULT 'blue',
    overridden      INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE INDEX IF NOT EXISTS idx_occurrences_event_date
    ON calendar_event_occurrences(event_id, occurrence_date)`,

  `CREATE TABLE IF NOT EXISTS goals (
    id              TEXT    NOT NULL PRIMARY KEY,
    title           TEXT    NOT NULL,
    description     TEXT,
    start_date      TEXT    NOT NULL,
    target_date     TEXT    NOT NULL,
    colour_state    TEXT    NOT NULL DEFAULT 'blue',
    progress        INTEGER NOT NULL DEFAULT 0,
    category        TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS goal_milestones (
    id              TEXT    NOT NULL PRIMARY KEY,
    goal_id         TEXT    NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    title           TEXT    NOT NULL,
    date            TEXT    NOT NULL,
    colour_state    TEXT    NOT NULL DEFAULT 'blue',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_milestones_goal
    ON goal_milestones(goal_id)`,

  `CREATE TABLE IF NOT EXISTS goal_links (
    id              TEXT    NOT NULL PRIMARY KEY,
    goal_id         TEXT    NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    source_id       TEXT    NOT NULL,
    source_type     TEXT    NOT NULL,
    weight          INTEGER NOT NULL DEFAULT 100,
    created_at      INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_goal_links_goal
    ON goal_links(goal_id)`,

  `CREATE TABLE IF NOT EXISTS daily_scores (
    id              TEXT    NOT NULL PRIMARY KEY,
    date            TEXT    NOT NULL UNIQUE,
    completed       INTEGER NOT NULL DEFAULT 0,
    total           INTEGER NOT NULL DEFAULT 0,
    streak_day      INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS score_event_log (
    id              TEXT    NOT NULL PRIMARY KEY,
    score_date      TEXT    NOT NULL,
    event_id        TEXT    NOT NULL,
    event_title     TEXT    NOT NULL,
    category        TEXT    NOT NULL,
    colour_state    TEXT    NOT NULL DEFAULT 'blue',
    locked          INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE INDEX IF NOT EXISTS idx_score_event_log_date
    ON score_event_log(score_date)`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_score_event_log_event_date
    ON score_event_log(event_id, score_date)`,

  // ─── Event Groups ──────────────────────────────────────────────────────────

  `CREATE TABLE IF NOT EXISTS event_groups (
    id         TEXT    NOT NULL PRIMARY KEY,
    name       TEXT    NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_event_groups_name
    ON event_groups(name)`,

  // ─── Add columns to calendar_events ────────────────────────────────────────

  `ALTER TABLE calendar_events ADD COLUMN group_id TEXT REFERENCES event_groups(id) ON DELETE SET NULL`,

  `ALTER TABLE calendar_events ADD COLUMN linked_note_id TEXT`,

  // ── Memory Blocks Architecture ────────────────────────────────────────────

  `CREATE TABLE IF NOT EXISTS episodes (
    id               TEXT    NOT NULL PRIMARY KEY,
    note_id          TEXT,
    opened_at        INTEGER NOT NULL,
    closed_at        INTEGER,
    message_count    INTEGER NOT NULL DEFAULT 0,
    topic_summary    TEXT,
    intent_tags      TEXT,
    boundary_score   REAL    NOT NULL DEFAULT 0,
    episode_embedding BLOB,
    created_at       INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_episodes_note_id
    ON episodes(note_id)`,

  `CREATE INDEX IF NOT EXISTS idx_episodes_opened_at
    ON episodes(opened_at DESC)`,

  `CREATE TABLE IF NOT EXISTS episode_messages (
    id              TEXT    NOT NULL PRIMARY KEY,
    episode_id      TEXT    NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    role            TEXT    NOT NULL CHECK(role IN ('user', 'assistant')),
    content         TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,
    query_embedding BLOB
  )`,

  `CREATE INDEX IF NOT EXISTS idx_episode_messages_episode_id
    ON episode_messages(episode_id, created_at ASC)`,

  `ALTER TABLE note_blocks ADD COLUMN episode_id TEXT`,

  `ALTER TABLE note_blocks ADD COLUMN memory_metadata TEXT`,

  `ALTER TABLE note_blocks ADD COLUMN query_embedding BLOB`,

  `ALTER TABLE note_blocks ADD COLUMN episode_embedding BLOB`,

  // ── Thought Graph (feature/thought-graph) ────────────────────────────────

  `CREATE TABLE IF NOT EXISTS thought_graphs (
    id          TEXT    NOT NULL PRIMARY KEY,
    title       TEXT    NOT NULL DEFAULT 'Untitled Thought Graph',
    source_type TEXT    NOT NULL CHECK(source_type IN ('conversation','note')),
    source_id   TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_thought_graphs_source
    ON thought_graphs(source_type, source_id)`,

  `CREATE TABLE IF NOT EXISTS thought_nodes (
    id          TEXT    NOT NULL PRIMARY KEY,
    graph_id    TEXT    NOT NULL REFERENCES thought_graphs(id) ON DELETE CASCADE,
    type        TEXT    NOT NULL CHECK(type IN ('claim','idea','question','counterargument','evidence','assumption','conclusion')),
    summary     TEXT    NOT NULL,
    body        TEXT,
    state       TEXT    NOT NULL DEFAULT 'open' CHECK(state IN ('open','resolved','parked')),
    source_ref  TEXT,
    source_kind TEXT    CHECK(source_kind IN ('conversation','note','external')),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_thought_nodes_graph ON thought_nodes(graph_id)`,

  `CREATE TABLE IF NOT EXISTS thought_edges (
    id          TEXT    NOT NULL PRIMARY KEY,
    graph_id    TEXT    NOT NULL REFERENCES thought_graphs(id) ON DELETE CASCADE,
    from_id     TEXT    NOT NULL REFERENCES thought_nodes(id) ON DELETE CASCADE,
    to_id       TEXT    NOT NULL REFERENCES thought_nodes(id) ON DELETE CASCADE,
    relation    TEXT    NOT NULL CHECK(relation IN ('supports','challenges','answers','leads_to','depends_on','refines')),
    created_at  INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_thought_edges_graph ON thought_edges(graph_id)`,
  `CREATE INDEX IF NOT EXISTS idx_thought_edges_from   ON thought_edges(from_id)`,
  `CREATE INDEX IF NOT EXISTS idx_thought_edges_to     ON thought_edges(to_id)`,

  `CREATE VIRTUAL TABLE IF NOT EXISTS thought_nodes_fts USING fts5(
    id UNINDEXED,
    graph_id UNINDEXED,
    summary,
    body,
    content='thought_nodes',
    content_rowid='rowid'
  )`,

  `CREATE TRIGGER IF NOT EXISTS thought_nodes_fts_insert
    AFTER INSERT ON thought_nodes
    BEGIN
      INSERT INTO thought_nodes_fts(rowid, id, graph_id, summary, body)
      VALUES (new.rowid, new.id, new.graph_id, new.summary, new.body);
    END`,

  `CREATE TRIGGER IF NOT EXISTS thought_nodes_fts_update
    AFTER UPDATE ON thought_nodes
    BEGIN
      INSERT INTO thought_nodes_fts(thought_nodes_fts, rowid, id, graph_id, summary, body)
      VALUES ('delete', old.rowid, old.id, old.graph_id, old.summary, old.body);
      INSERT INTO thought_nodes_fts(rowid, id, graph_id, summary, body)
      VALUES (new.rowid, new.id, new.graph_id, new.summary, new.body);
    END`,

  `CREATE TRIGGER IF NOT EXISTS thought_nodes_fts_delete
    AFTER DELETE ON thought_nodes
    BEGIN
      INSERT INTO thought_nodes_fts(thought_nodes_fts, rowid, id, graph_id, summary, body)
      VALUES ('delete', old.rowid, old.id, old.graph_id, old.summary, old.body);
    END`,
];

