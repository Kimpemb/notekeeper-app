import Database from "@tauri-apps/plugin-sql";

let _db: Database | null = null;
async function getDb(): Promise<Database> {
  if (!_db) _db = await Database.load("sqlite:idemora.db");
  return _db;
}

export interface CanvasRow {
  id: string;
  name: string;
  data: string;
  created_at: number;
  updated_at: number;
}

export async function createCanvasInDb(id: string, name: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    `INSERT INTO canvases (id, name, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, name, JSON.stringify({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }), now, now]
  );
}

export async function getCanvas(id: string): Promise<CanvasRow | null> {
  const db = await getDb();
  const rows = await db.select<CanvasRow[]>(
    `SELECT * FROM canvases WHERE id = ?`, [id]
  );
  return rows[0] ?? null;
}

export async function saveCanvas(id: string, data: object): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE canvases SET data = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(data), Date.now(), id]
  );
}

// ── NEW: persists the canvas name column ──────────────────────────────────────
export async function saveCanvasName(id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE canvases SET name = ?, updated_at = ? WHERE id = ?`,
    [name, Date.now(), id]
  );
}

export async function listCanvases(): Promise<CanvasRow[]> {
  const db = await getDb();
  return db.select<CanvasRow[]>(
    `SELECT * FROM canvases ORDER BY updated_at DESC`
  );
}

export async function deleteCanvas(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM canvases WHERE id = ?`, [id]);
}