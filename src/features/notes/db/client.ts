import Database from "@tauri-apps/plugin-sql";
import { instrumentDb } from "@/lib/bootProfiler";

let db: Database | null = null;
let initPromise: Promise<Database> | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;
  
  if (!initPromise) {
    initPromise = (async () => {
      const instance = await Database.load("sqlite:idemora.db");
      await instance.execute(`PRAGMA journal_mode=WAL`);
      await instance.execute(`PRAGMA synchronous=NORMAL`);
      await instance.execute(`PRAGMA foreign_keys=ON`);
      await instance.execute(`PRAGMA busy_timeout=5000`);
      instrumentDb(instance); // dev-only slow-SQL logger; no-op in production
      db = instance;
      return instance;
    })();
  }
  
  return initPromise;
}

export function isDbReady(): boolean {
  return db !== null;
}