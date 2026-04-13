import Database from "@tauri-apps/plugin-sql";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;
  db = await Database.load("sqlite:idemora.db");
  await db.execute(`PRAGMA journal_mode=WAL`);
  await db.execute(`PRAGMA synchronous=FULL`);
  await db.execute(`PRAGMA foreign_keys=ON`);
  await db.execute(`PRAGMA busy_timeout=5000`);
  return db;
}