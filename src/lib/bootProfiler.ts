// src/lib/bootProfiler.ts
//
// Dev-only startup profiler (`tauri dev`). Every export is a no-op in production builds.
//
// What it gives you in the devtools console:
//   [boot-prof]  label  start=…ms  took=…ms   one line per timed step (same clock as the [boot] logs)
//   [slow-sql]   any single SQL statement slower than SLOW_SQL_MS, with how many other statements
//                were in flight when it started (a pile-up means the DB connection is the bottleneck)
//   __bootProf.report()      table of every timed step, sorted by start time
//   __bootProf.profileDb()   row counts + on-disk size per table (shows what the 900 MB is)
import type Database from "@tauri-apps/plugin-sql";

const ENABLED = import.meta.env.DEV;
const SLOW_SQL_MS = 250;

interface Row { label: string; start: number; ms: number }
const rows: Row[] = [];
let inflight = 0;

function record(label: string, start: number, ms: number) {
  rows.push({ label, start: Math.round(start), ms: Math.round(ms) });
  console.log(`[boot-prof] ${label}  start=${Math.round(start)}ms  took=${Math.round(ms)}ms`);
}

/** Time an async step. Returns the step's result unchanged. */
export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!ENABLED) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    record(label, start, performance.now() - start);
  }
}

/** Mark a moment in time (a zero-length step). */
export function bootMark(label: string): void {
  if (ENABLED) record(label, performance.now(), 0);
}

/** Wrap db.select / db.execute so slow statements are logged. */
export function instrumentDb(db: Database): void {
  if (!ENABLED) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrap = <F extends (query: string, ...rest: any[]) => Promise<any>>(fn: F, kind: string): F =>
    (async (query: string, ...rest: unknown[]) => {
      const start = performance.now();
      const others = inflight;
      inflight++;
      try {
        return await fn(query, ...rest);
      } finally {
        inflight--;
        const ms = performance.now() - start;
        if (ms > SLOW_SQL_MS) {
          console.warn(
            `[slow-sql] ${kind} ${ms.toFixed(0)}ms (started @${start.toFixed(0)}, ${others} others in flight) ` +
              query.replace(/\s+/g, " ").slice(0, 110)
          );
        }
      }
    }) as F;
  db.select = wrap(db.select.bind(db), "select");
  db.execute = wrap(db.execute.bind(db), "execute");
}

async function profileDb(getDb: () => Promise<Database>): Promise<void> {
  const db = await getDb();
  const tables = await db.select<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
  );
  const counts: { table: string; rows: number }[] = [];
  for (const t of tables) {
    try {
      const r = await db.select<{ c: number }[]>(`SELECT COUNT(*) AS c FROM "${t.name}"`);
      counts.push({ table: t.name, rows: r[0]?.c ?? 0 });
    } catch { /* virtual tables can refuse COUNT(*) */ }
  }
  counts.sort((a, b) => b.rows - a.rows);
  console.log("[profileDb] row counts per table");
  console.table(counts);
  try {
    const sizes = await db.select<{ name: string; mb: number }[]>(
      `SELECT name, ROUND(SUM(pgsize) / 1048576.0, 1) AS mb FROM dbstat GROUP BY name ORDER BY SUM(pgsize) DESC LIMIT 25`
    );
    console.log("[profileDb] on-disk size (MB) per table/index");
    console.table(sizes);
  } catch {
    console.log("[profileDb] dbstat is not available in this SQLite build; row counts only");
  }
}

/** Expose helpers on window for use from the devtools console. */
export function installBootProf(getDb: () => Promise<Database>): void {
  if (!ENABLED) return;
  (window as unknown as Record<string, unknown>).__bootProf = {
    report: () => console.table([...rows].sort((a, b) => a.start - b.start)),
    profileDb: () => profileDb(getDb),
  };
}
