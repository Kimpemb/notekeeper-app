// src/features/backup/lib/scheduler.ts
//
// Called once on app launch. Silently runs a backup if all conditions are met.
// Never throws — errors are swallowed to avoid disrupting app startup.
//
// Settings keys:
//   backup_enabled       "true" | "false"
//   backup_frequency     "daily" | "weekly" | "on_change"
//   backup_folder        absolute path string
//   backup_auto_password encrypted backup password
//   backup_last_at       ISO timestamp of last successful backup
//   backup_last_hash     SHA-256 hash of last bundle JSON

const SETTINGS = {
  enabled:   "backup_enabled",
  frequency: "backup_frequency",
  folder:    "backup_folder",
  password:  "backup_auto_password",
  lastAt:    "backup_last_at",
  lastHash:  "backup_last_hash",
} as const;

const MS = {
  day:  1000 * 60 * 60 * 24,
  week: 1000 * 60 * 60 * 24 * 7,
} as const;

// ─── Hash helper ──────────────────────────────────────────────────────────────

async function hashString(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const buffer  = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Main scheduler ───────────────────────────────────────────────────────────

export async function runScheduledBackupIfDue(): Promise<void> {
  try {
    const { getSetting, setSetting } = await import("@/features/notes/db/queries");

    const enabled   = await getSetting(SETTINGS.enabled);
    const frequency = await getSetting(SETTINGS.frequency);
    const folder    = await getSetting(SETTINGS.folder);
    const password  = await getSetting(SETTINGS.password);
    const lastAt    = await getSetting(SETTINGS.lastAt);
    const lastHash  = await getSetting(SETTINGS.lastHash);

    // ── Guards ────────────────────────────────────────────────────────────────
    if (enabled !== "true") return;
    if (!folder?.trim())    return;
    if (!password?.trim())  return;
    if (!frequency)         return;

    // ── Assemble bundle ───────────────────────────────────────────────────────
    const { assembleBundle } = await import("@/features/backup/lib/bundler");
    const bundle     = await assembleBundle();
    const bundleJson = JSON.stringify(bundle);
    const hash       = await hashString(bundleJson);

    // ── Check if due ──────────────────────────────────────────────────────────
    const now     = Date.now();
    const lastMs  = lastAt ? new Date(lastAt).getTime() : 0;
    const elapsed = now - lastMs;

    let isDue = false;
    if (frequency === "on_change") {
      isDue = hash !== lastHash;
    } else if (frequency === "daily") {
      isDue = elapsed >= MS.day;
    } else if (frequency === "weekly") {
      isDue = elapsed >= MS.week;
    }

    if (!isDue) return;

    // ── Run silent backup ─────────────────────────────────────────────────────
    const { compress }           = await import("@/features/backup/lib/compression");
    const { encrypt }            = await import("@/features/backup/lib/crypto");
    const { saveBackupToFolder } = await import("@/lib/tauri/fs");

    const compressed = await compress(bundleJson);
    const encrypted  = await encrypt(compressed, password);

    const date     = new Date().toISOString().slice(0, 10);
    const fileName = `idemora-auto-${date}.nkbackup`;

    await saveBackupToFolder(encrypted, folder, fileName);

    // ── Update tracking ───────────────────────────────────────────────────────
    await setSetting(SETTINGS.lastAt,   new Date().toISOString());
    await setSetting(SETTINGS.lastHash, hash);

  } catch (err) {
    console.warn("[scheduler] Auto-backup failed silently:", err);
  }
}

// ─── Settings helpers (used by BackupModal) ───────────────────────────────────

export async function getSchedulerSettings() {
  const { getSetting } = await import("@/features/notes/db/queries");
  return {
    enabled:   (await getSetting(SETTINGS.enabled))   ?? "false",
    frequency: (await getSetting(SETTINGS.frequency)) ?? "daily",
    folder:    (await getSetting(SETTINGS.folder))    ?? "",
    lastAt:    (await getSetting(SETTINGS.lastAt))    ?? null,
  };
}

export async function saveSchedulerSettings(opts: {
  enabled:   boolean;
  frequency: string;
  folder:    string;
  password:  string;
}): Promise<void> {
  const { setSetting } = await import("@/features/notes/db/queries");
  await setSetting(SETTINGS.enabled,   opts.enabled ? "true" : "false");
  await setSetting(SETTINGS.frequency, opts.frequency);
  await setSetting(SETTINGS.folder,    opts.folder);
  await setSetting(SETTINGS.password,  opts.password);
}