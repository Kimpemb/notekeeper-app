// src/features/graph/db/thoughtGraphQueries.ts
//
// DB layer for Thought Graph. Mirrors goalQueries.ts's link-table pattern
// and queries.ts's createEpisode convention (crypto.randomUUID() + Date.now()
// inline — not the notes-table uuid()/now() helpers).
//
// IMPORTANT: thought_graphs.source_id is ALWAYS an episodes.id. Never write
// note_id into it directly, anywhere in this file. See design doc §2/§5.

import { getDb } from "@/features/notes/db/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ThoughtNodeType =
  | "claim" | "idea" | "question" | "counterargument"
  | "evidence" | "assumption" | "conclusion";

export type ThoughtNodeState = "open" | "resolved" | "parked";

export type ThoughtEdgeRelation =
  | "supports" | "challenges" | "answers"
  | "leads_to" | "depends_on" | "refines";

export interface ThoughtGraphRow {
  id:          string;
  title:       string;
  source_type: "conversation" | "note";
  source_id:   string;   // episodes.id — never a note_id, see file header
  created_at:  number;
  updated_at:  number;
}

export interface ThoughtNodeRow {
  id:          string;
  graph_id:    string;
  type:        ThoughtNodeType;
  summary:     string;
  body:        string | null;
  state:       ThoughtNodeState;
  source_ref:  string | null;
  source_kind: "conversation" | "note" | "external" | null;
  created_at:  number;
  updated_at:  number;
}

export interface ThoughtEdgeRow {
  id:         string;
  graph_id:   string;
  from_id:    string;
  to_id:      string;
  relation:   ThoughtEdgeRelation;
  created_at: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

// ─── Graph lifecycle ────────────────────────────────────────────────────────

/** Get or create the thought graph for an episode. One graph per episode. */
export async function getOrCreateThoughtGraphForEpisode(
  episodeId: string
): Promise<ThoughtGraphRow> {
  const db = await getDb();
  const existing = await db.select<ThoughtGraphRow[]>(
    `SELECT * FROM thought_graphs WHERE source_type = 'conversation' AND source_id = $1 LIMIT 1`,
    [episodeId]
  );
  if (existing[0]) return existing[0];

  const id = uuid();
  const ts = now();
  await db.execute(
    `INSERT INTO thought_graphs (id, title, source_type, source_id, created_at, updated_at)
     VALUES ($1, 'Untitled Thought Graph', 'conversation', $2, $3, $3)`,
    [id, episodeId, ts]
  );
  return {
    id,
    title:       "Untitled Thought Graph",
    source_type: "conversation",
    source_id:   episodeId,
    created_at:  ts,
    updated_at:  ts,
  };
}

/**
 * All thought graphs for a note, merged across every episode that note has
 * ever had (design doc §1.1 — merged canvas, not an episode picker).
 * Routes through episodes.note_id, never touches thought_graphs directly
 * by note — see design doc §5 discipline rule.
 */
export async function getThoughtGraphsForNote(noteId: string): Promise<ThoughtGraphRow[]> {
  const db = await getDb();
  return db.select<ThoughtGraphRow[]>(
    `SELECT tg.* FROM thought_graphs tg
     JOIN episodes e ON e.id = tg.source_id
     WHERE e.note_id = $1
     ORDER BY tg.created_at ASC`,
    [noteId]
  );
}

// ─── Nodes ────────────────────────────────────────────────────────────────────

export async function getThoughtNodes(graphId: string): Promise<ThoughtNodeRow[]> {
  const db = await getDb();
  return db.select<ThoughtNodeRow[]>(
    `SELECT * FROM thought_nodes WHERE graph_id = $1 ORDER BY created_at ASC`,
    [graphId]
  );
}

export async function getThoughtNodesForGraphs(graphIds: string[]): Promise<ThoughtNodeRow[]> {
  if (graphIds.length === 0) return [];
  const db = await getDb();
  const placeholders = graphIds.map((_, i) => `$${i + 1}`).join(",");
  return db.select<ThoughtNodeRow[]>(
    `SELECT * FROM thought_nodes WHERE graph_id IN (${placeholders}) ORDER BY created_at ASC`,
    graphIds
  );
}

export async function createThoughtNodeRow(input: {
  graphId:     string;
  type:        ThoughtNodeType;
  summary:     string;
  body?:       string | null;
  sourceRef?:  string | null;
  sourceKind?: "conversation" | "note" | "external" | null;
  // Optional pre-generated id — used by the extraction pass (chat.ts) so the
  // model can reference this node's real id in same-pass edges immediately,
  // instead of waiting for confirmation. Falls back to generating a fresh
  // one when not supplied, preserving existing callers unchanged.
  id?:         string;
}): Promise<ThoughtNodeRow> {
  const db = await getDb();
  const id = input.id ?? uuid();
  const ts = now();
  await db.execute(
    `INSERT INTO thought_nodes
       (id, graph_id, type, summary, body, state, source_ref, source_kind, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $8)`,
    [
      id,
      input.graphId,
      input.type,
      input.summary,
      input.body ?? null,
      input.sourceRef ?? null,
      input.sourceKind ?? null,
      ts,
    ]
  );
  return {
    id,
    graph_id:    input.graphId,
    type:        input.type,
    summary:     input.summary,
    body:        input.body ?? null,
    state:       "open",
    source_ref:  input.sourceRef ?? null,
    source_kind: input.sourceKind ?? null,
    created_at:  ts,
    updated_at:  ts,
  };
}

export async function deleteThoughtNodeRow(nodeId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM thought_nodes WHERE id = $1`, [nodeId]);
}

export async function updateThoughtNodeStateRow(
  nodeId: string,
  state:  ThoughtNodeState
): Promise<{ previousState: ThoughtNodeState } | null> {
  const db = await getDb();
  const rows = await db.select<{ state: ThoughtNodeState }[]>(
    `SELECT state FROM thought_nodes WHERE id = $1`,
    [nodeId]
  );
  if (!rows[0]) return null;
  const previousState = rows[0].state;
  await db.execute(
    `UPDATE thought_nodes SET state = $1, updated_at = $2 WHERE id = $3`,
    [state, now(), nodeId]
  );
  return { previousState };
}

// Dedup guard — same-summary check within a graph, mirrors goal_links'
// (source_id, source_type) dedup pattern. Case-insensitive, trimmed.
export async function findThoughtNodeBySummary(
  graphId: string,
  summary: string
): Promise<ThoughtNodeRow | null> {
  const db = await getDb();
  const rows = await db.select<ThoughtNodeRow[]>(
    `SELECT * FROM thought_nodes WHERE graph_id = $1 AND LOWER(TRIM(summary)) = LOWER(TRIM($2)) LIMIT 1`,
    [graphId, summary]
  );
  return rows[0] ?? null;
}

// ─── Edges ────────────────────────────────────────────────────────────────────

export async function getThoughtEdges(graphId: string): Promise<ThoughtEdgeRow[]> {
  const db = await getDb();
  return db.select<ThoughtEdgeRow[]>(
    `SELECT * FROM thought_edges WHERE graph_id = $1 ORDER BY created_at ASC`,
    [graphId]
  );
}

export async function getThoughtEdgesForGraphs(graphIds: string[]): Promise<ThoughtEdgeRow[]> {
  if (graphIds.length === 0) return [];
  const db = await getDb();
  const placeholders = graphIds.map((_, i) => `$${i + 1}`).join(",");
  return db.select<ThoughtEdgeRow[]>(
    `SELECT * FROM thought_edges WHERE graph_id IN (${placeholders}) ORDER BY created_at ASC`,
    graphIds
  );
}

export async function createThoughtEdgeRow(input: {
  graphId:  string;
  fromId:   string;
  toId:     string;
  relation: ThoughtEdgeRelation;
}): Promise<ThoughtEdgeRow> {
  const db = await getDb();
  const id = uuid();
  const ts = now();
  await db.execute(
    `INSERT INTO thought_edges (id, graph_id, from_id, to_id, relation, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, input.graphId, input.fromId, input.toId, input.relation, ts]
  );
  return {
    id,
    graph_id:   input.graphId,
    from_id:    input.fromId,
    to_id:      input.toId,
    relation:   input.relation,
    created_at: ts,
  };
}

export async function deleteThoughtEdgeRow(edgeId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM thought_edges WHERE id = $1`, [edgeId]);
}

// Dedup guard for edges — same (from_id, to_id, relation) triple.
export async function findThoughtEdge(
  graphId:  string,
  fromId:   string,
  toId:     string,
  relation: ThoughtEdgeRelation
): Promise<ThoughtEdgeRow | null> {
  const db = await getDb();
  const rows = await db.select<ThoughtEdgeRow[]>(
    `SELECT * FROM thought_edges
     WHERE graph_id = $1 AND from_id = $2 AND to_id = $3 AND relation = $4 LIMIT 1`,
    [graphId, fromId, toId, relation]
  );
  return rows[0] ?? null;
}