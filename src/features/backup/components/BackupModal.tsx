// src/features/backup/components/BackupModal.tsx
//
// Three flows:
// Export   — password entry → encrypt → download .nkbackup
// Restore  — upload .nkbackup → password entry → decrypt → restore DB
// Auto     — configure scheduled backups to a user-chosen folder

import { useState, useEffect } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";

// ─── Types ────────────────────────────────────────────────────────────────────

type Flow   = "idle" | "export" | "restore" | "auto";
type Status = "idle" | "loading" | "success" | "error";

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 mb-3 mt-6 first:mt-0">
      {children}
    </p>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value:        string;
  onChange:     (v: string) => void;
  placeholder?: string;
  disabled?:    boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Enter password…"}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 placeholder-zinc-300 dark:placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
      />
      <button
        onClick={() => setShow((v) => !v)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        title={show ? "Hide password" : "Show password"}
      >
        {show ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 7s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.2"/>
            <circle cx="7" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M2 2l10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 7s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.2"/>
            <circle cx="7" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
        )}
      </button>
    </div>
  );
}

// ─── Auto-backup flow ─────────────────────────────────────────────────────────

function AutoBackupFlow({ onBack }: { onBack: () => void }) {
  const [enabled,   setEnabled]   = useState(false);
  const [frequency, setFrequency] = useState("daily");
  const [folder,    setFolder]    = useState("");
  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [lastAt,    setLastAt]    = useState<string | null>(null);
  const [status,    setStatus]    = useState<Status>("idle");
  const [message,   setMessage]   = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);

  // Load existing settings on mount
  useEffect(() => {
    (async () => {
      const { getSchedulerSettings } = await import("@/features/backup/lib/scheduler");
      const s = await getSchedulerSettings();
      setEnabled(s.enabled === "true");
      setFrequency(s.frequency);
      setFolder(s.folder);
      setLastAt(s.lastAt);
      setLoading(false);
    })();
  }, []);

  async function handlePickFolder() {
    const { pickBackupFolder } = await import("@/lib/tauri/fs");
    const picked = await pickBackupFolder();
    if (picked) setFolder(picked);
  }

  async function handleSave() {
    if (enabled) {
      if (!folder.trim())        { setMessage("Please select a backup folder."); return; }
      if (!password.trim())      { setMessage("Please enter a backup password."); return; }
      if (password.length < 8)   { setMessage("Password must be at least 8 characters."); return; }
      if (password !== confirm)  { setMessage("Passwords do not match."); return; }
    }

    setStatus("loading");
    setMessage(null);

    try {
      const { saveSchedulerSettings } = await import("@/features/backup/lib/scheduler");
      await saveSchedulerSettings({ enabled, frequency, folder, password });
      setStatus("success");
      setMessage(enabled ? "Auto-backup enabled." : "Auto-backup disabled.");
      setPassword("");
      setConfirm("");
    } catch {
      setStatus("error");
      setMessage("Failed to save settings.");
    }
  }

  const isLoading = status === "loading" || loading;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <button onClick={onBack} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
          ← Back
        </button>
        <span className="text-xs text-zinc-300 dark:text-zinc-600">/</span>
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Auto-backup</span>
      </div>

      {loading ? (
        <p className="text-xs text-zinc-400 animate-pulse">Loading…</p>
      ) : (
        <div className="space-y-4">

          {/* Enable toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
            <div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Enable auto-backup</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">Automatically back up on app launch</p>
            </div>
            <button
              onClick={() => setEnabled((v) => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${enabled ? "bg-blue-500" : "bg-zinc-200 dark:bg-zinc-700"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${enabled ? "translate-x-4" : ""}`} />
            </button>
          </div>

          {enabled && (
            <>
              {/* Frequency */}
              <div>
                <SectionTitle>Frequency</SectionTitle>
                <div className="flex gap-2">
                  {(["daily", "weekly", "on_change"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFrequency(f)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors duration-150 ${
                        frequency === f
                          ? "bg-blue-500 text-white border-blue-500"
                          : "bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {f === "on_change" ? "On change" : f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Folder */}
              <div>
                <SectionTitle>Backup folder</SectionTitle>
                <div className="flex gap-2">
                  <div className="flex-1 px-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 truncate">
                    {folder || "No folder selected"}
                  </div>
                  <button
                    onClick={handlePickFolder}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 transition-colors"
                  >
                    Browse
                  </button>
                </div>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1.5 leading-snug">
                  Point this at your Dropbox, iCloud Drive, or Google Drive folder for automatic cloud sync.
                </p>
              </div>

              {/* Password */}
              <div>
                <SectionTitle>Backup password</SectionTitle>
                <div className="space-y-2">
                  <PasswordInput value={password} onChange={setPassword} placeholder="Password (min. 8 characters)" disabled={isLoading} />
                  <PasswordInput value={confirm}  onChange={setConfirm}  placeholder="Confirm password"             disabled={isLoading} />
                </div>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1.5 leading-snug">
                  This password encrypts every automatic backup. Store it somewhere safe.
                </p>
              </div>
            </>
          )}

          {/* Last backup */}
          {lastAt && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Last backup: {new Date(lastAt).toLocaleString()}
            </p>
          )}

          {/* Status message */}
          {message && (
            <p className={`text-xs ${status === "error" ? "text-red-500 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
              {status === "success" ? `✓ ${message}` : message}
            </p>
          )}

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={isLoading}
            className="w-full py-2 rounded-lg text-sm font-medium bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors duration-150 flex items-center justify-center gap-2"
          >
            {isLoading && (
              <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 8" strokeLinecap="round"/>
              </svg>
            )}
            {isLoading ? "Saving…" : "Save settings"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function BackupModal() {
  const loadNotes = useNoteStore((s) => s.loadNotes);

  const [flow,     setFlow]     = useState<Flow>("idle");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [status,   setStatus]   = useState<Status>("idle");
  const [message,  setMessage]  = useState<string | null>(null);

  function reset() {
    setFlow("idle");
    setPassword("");
    setConfirm("");
    setStatus("idle");
    setMessage(null);
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  async function handleExport() {
    const { exportBackup } = await import("@/features/backup/lib/backup");
    if (!password.trim())          { setMessage("Please enter a password."); return; }
    if (password !== confirm)      { setMessage("Passwords do not match."); return; }
    if (password.length < 8)       { setMessage("Password must be at least 8 characters."); return; }

    setStatus("loading");
    setMessage(null);

    try {
      const result = await exportBackup(password);
      setStatus("success");
      setMessage(`Backup saved — ${result.noteCount} note${result.noteCount !== 1 ? "s" : ""} exported.`);
      setPassword("");
      setConfirm("");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Export failed.");
    }
  }

  // ── Restore ─────────────────────────────────────────────────────────────────

  async function handleRestore() {
    const { restoreBackup } = await import("@/features/backup/lib/backup");
    if (!password.trim()) { setMessage("Please enter the backup password."); return; }

    setStatus("loading");
    setMessage(null);

    try {
      const result = await restoreBackup(password);
      await loadNotes();
      setStatus("success");
      setMessage(`Restore complete — ${result.noteCount} note${result.noteCount !== 1 ? "s" : ""} restored.`);
      setPassword("");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Restore failed.");
    }
  }

  const isLoading = status === "loading";

  // ── Auto-backup flow ────────────────────────────────────────────────────────

  if (flow === "auto") return <AutoBackupFlow onBack={reset} />;

  // ── Idle ────────────────────────────────────────────────────────────────────

  if (flow === "idle") {
    return (
      <div>
        <SectionTitle>Backup & Restore</SectionTitle>
        <div className="space-y-3">

          <div className="p-3 rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Export backup</p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-snug">Encrypt and download all your notes as a .nkbackup file.</p>
              </div>
              <button
                onClick={() => { setFlow("export"); setMessage(null); }}
                className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-500 hover:bg-blue-600 text-white transition-colors duration-150"
              >
                Export
              </button>
            </div>
          </div>

          <div className="p-3 rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Restore from backup</p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-snug">Upload a .nkbackup file and restore your notes.</p>
              </div>
              <button
                onClick={() => { setFlow("restore"); setMessage(null); }}
                className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 transition-colors duration-150"
              >
                Restore
              </button>
            </div>
          </div>

          <div className="p-3 rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Auto-backup</p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-snug">Schedule automatic backups to iCloud, Dropbox, or any local folder.</p>
              </div>
              <button
                onClick={() => { setFlow("auto"); setMessage(null); }}
                className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 transition-colors duration-150"
              >
                Configure
              </button>
            </div>
          </div>

        </div>

        <div className="mt-4 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800">
          <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">
            Backups are AES-256 encrypted. Only you can decrypt them with your password. Backups can only be restored in Idemora.
          </p>
        </div>
      </div>
    );
  }

  // ── Export flow ─────────────────────────────────────────────────────────────

  if (flow === "export") {
    return (
      <div>
        <div className="flex items-center gap-2 mb-4">
          <button onClick={reset} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">← Back</button>
          <span className="text-xs text-zinc-300 dark:text-zinc-600">/</span>
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Export backup</span>
        </div>

        {status === "success" ? (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800">
              <p className="text-sm text-green-700 dark:text-green-400 font-medium">✓ {message}</p>
            </div>
            <button onClick={reset} className="w-full py-1.5 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">Done</button>
          </div>
        ) : (
          <div className="space-y-3">
            <SectionTitle>Set a password</SectionTitle>
            <PasswordInput value={password} onChange={setPassword} placeholder="Password (min. 8 characters)" disabled={isLoading} />
            <PasswordInput value={confirm}  onChange={setConfirm}  placeholder="Confirm password"             disabled={isLoading} />
            {message && <p className="text-xs text-red-500 dark:text-red-400">{message}</p>}
            <button
              onClick={handleExport}
              disabled={isLoading}
              className="w-full py-2 rounded-lg text-sm font-medium bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors duration-150 flex items-center justify-center gap-2"
            >
              {isLoading && <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 8" strokeLinecap="round"/></svg>}
              {isLoading ? "Encrypting…" : "Export & Download"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Restore flow ────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <button onClick={reset} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">← Back</button>
        <span className="text-xs text-zinc-300 dark:text-zinc-600">/</span>
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Restore from backup</span>
      </div>

      {status === "success" ? (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800">
            <p className="text-sm text-green-700 dark:text-green-400 font-medium">✓ {message}</p>
            <p className="text-xs text-green-600 dark:text-green-500 mt-1">Restart the app to see all restored notes.</p>
          </div>
          <button onClick={reset} className="w-full py-1.5 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">Done</button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">Restoring will overwrite existing notes with the same ID. This cannot be undone.</p>
          </div>
          <SectionTitle>Enter backup password</SectionTitle>
          <PasswordInput value={password} onChange={setPassword} placeholder="Backup password" disabled={isLoading} />
          {message && <p className="text-xs text-red-500 dark:text-red-400">{message}</p>}
          <button
            onClick={handleRestore}
            disabled={isLoading}
            className="w-full py-2 rounded-lg text-sm font-medium bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors duration-150 flex items-center justify-center gap-2"
          >
            {isLoading && <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 8" strokeLinecap="round"/></svg>}
            {isLoading ? "Restoring…" : "Select file & Restore"}
          </button>
        </div>
      )}
    </div>
  );
}