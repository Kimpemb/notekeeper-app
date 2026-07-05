// src/features/backup/components/BackupModal.tsx
//
// Four flows:
// Export    — password entry → encrypt → download .nkbackup
// Restore   — upload .nkbackup → password entry → decrypt → restore DB
// Auto      — configure scheduled backups to a user-chosen folder
// Telegram  — configure + send backup via Telegram bot

import { useState, useEffect } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";

// ─── Types ────────────────────────────────────────────────────────────────────

type Flow   = "idle" | "export" | "restore" | "auto" | "telegram";
type Status = "idle" | "loading" | "success" | "error";

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-widest text-idemora-text-muted mb-3 mt-6 first:mt-0">
      {children}
    </p>
  );
}

function PasswordInput({
  value, onChange, placeholder, disabled,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean;
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
        className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-idemora-border bg-idemora-bg-secondary text-idemora-text-normal placeholder-idemora-text-faint focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
      />
      <button
        onClick={() => setShow((v) => !v)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-100"
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
      if (!folder.trim())       { setMessage("Please select a backup folder."); return; }
      if (!password.trim())     { setMessage("Please enter a backup password."); return; }
      if (password.length < 8)  { setMessage("Password must be at least 8 characters."); return; }
      if (password !== confirm) { setMessage("Passwords do not match."); return; }
    }
    setStatus("loading");
    setMessage(null);
    try {
      const { saveSchedulerSettings } = await import("@/features/backup/lib/scheduler");
      await saveSchedulerSettings({ enabled, frequency, folder, password, tgEnabled: false, tgToken: "", tgChatId: "" });
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
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="text-sm text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-100 flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M8.5 3L4.5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>
        <span className="text-sm text-idemora-text-faint">/</span>
        <span className="text-sm font-medium text-idemora-text-normal">Auto-backup</span>
      </div>

      {loading ? <p className="text-xs text-idemora-text-muted animate-pulse">Loading…</p> : (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg border border-idemora-border bg-idemora-bg-secondary">
            <div>
              <p className="text-sm font-medium text-idemora-text-normal">Enable auto-backup</p>
              <p className="text-xs text-idemora-text-muted mt-0.5">Automatically back up on app launch</p>
            </div>
            <button
              onClick={() => setEnabled((v) => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${enabled ? "bg-blue-500" : "bg-idemora-bg-primary border border-idemora-border"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${enabled ? "translate-x-4" : ""}`} />
            </button>
          </div>

          {enabled && (
            <>
              <div>
                <SectionTitle>Frequency</SectionTitle>
                <div className="flex gap-2">
                  {(["daily", "weekly", "on_change"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFrequency(f)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors duration-150 ${
                        frequency === f
                          ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                          : "bg-idemora-bg-secondary text-idemora-text-muted border-idemora-border hover:bg-black/[0.06] dark:hover:bg-white/[0.07]"
                      }`}
                    >
                      {f === "on_change" ? "On change" : f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-1.5 mb-3">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-idemora-text-muted">Backup folder</p>
                  <div className="relative group">
                    <button className="w-3.5 h-3.5 rounded-full border border-idemora-border text-idemora-text-muted hover:text-idemora-text-normal flex items-center justify-center transition-colors">
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                        <path d="M4 2h.01M4 3.5v2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      </svg>
                    </button>
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 p-2.5 rounded-lg bg-idemora-bg-secondary border border-idemora-border text-idemora-text-normal text-xs leading-relaxed shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-50">
                      <p className="font-medium mb-1 text-idemora-text-normal">How cloud sync works</p>
                      <p>iCloud Drive and OneDrive create a real folder on your computer — just point Idemora there and it syncs automatically.</p>
                      <p className="mt-1.5">Google Drive requires the <span className="text-blue-400">Google Drive for Desktop</span> app to work the same way.</p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 px-3 py-2 text-xs rounded-lg border border-idemora-border bg-idemora-bg-secondary text-idemora-text-muted truncate">
                    {folder || "No folder selected"}
                  </div>
                  <button
                    onClick={handlePickFolder}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-idemora-bg-secondary text-idemora-text-normal border border-idemora-border hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100"
                  >
                    Browse
                  </button>
                </div>
                <p className="text-xs text-idemora-text-muted mt-1.5 leading-snug">
                  Point this at your iCloud Drive, OneDrive, or Google Drive folder for automatic cloud sync.
                </p>
              </div>

              <div>
                <SectionTitle>Backup password</SectionTitle>
                <div className="space-y-2">
                  <PasswordInput value={password} onChange={setPassword} placeholder="Password (min. 8 characters)" disabled={isLoading} />
                  <PasswordInput value={confirm}  onChange={setConfirm}  placeholder="Confirm password"             disabled={isLoading} />
                </div>
                <p className="text-xs text-idemora-text-muted mt-1.5 leading-snug">
                  This password encrypts every automatic backup. Store it somewhere safe.
                </p>
              </div>
            </>
          )}

          {lastAt && (
            <p className="text-xs text-idemora-text-muted">
              Last backup: {new Date(lastAt).toLocaleString()}
            </p>
          )}

          {message && (
            <p className={`text-xs ${status === "error" ? "text-red-400" : "text-green-500"}`}>
              {status === "success" ? `✓ ${message}` : message}
            </p>
          )}

          <button
            onClick={handleSave}
            disabled={isLoading}
            className="w-full py-2 rounded-lg text-sm font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-100 flex items-center justify-center gap-2"
          >
            {isLoading && <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 8" strokeLinecap="round"/></svg>}
            {isLoading ? "Saving…" : "Save settings"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Telegram flow ────────────────────────────────────────────────────────────

function TelegramFlow({ onBack }: { onBack: () => void }) {
  const [botToken,  setBotToken]  = useState("");
  const [chatId,    setChatId]    = useState("");
  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [tgEnabled, setTgEnabled] = useState(false);
  const [status,    setStatus]    = useState<Status>("idle");
  const [message,   setMessage]   = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [step,      setStep]      = useState<"setup" | "ready">("setup");

  useEffect(() => {
    (async () => {
      const { getSetting } = await import("@/features/notes/db/queries");
      const token   = await getSetting("backup_tg_token");
      const chat    = await getSetting("backup_tg_chat_id");
      const enabled = await getSetting("backup_tg_enabled");
      if (token)   setBotToken(token);
      if (chat)    { setChatId(chat); setStep("ready"); }
      setTgEnabled(enabled === "true");
      setLoading(false);
    })();
  }, []);

  async function handleFetchChatId() {
    if (!botToken.trim()) { setMessage("Please enter your bot token."); return; }
    setStatus("loading");
    setMessage(null);
    try {
      const { getTelegramChatId } = await import("../lib/telegram");
      const id = await getTelegramChatId(botToken);
      setChatId(id);
      setStep("ready");
      setStatus("idle");
      setMessage(null);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not fetch chat ID.");
    }
  }

  async function handleSave() {
    if (!botToken.trim()) { setMessage("Bot token is required."); return; }
    if (!chatId.trim())   { setMessage("Chat ID is required. Fetch it first."); return; }
    if (tgEnabled) {
      if (!password.trim())     { setMessage("Please enter a backup password."); return; }
      if (password.length < 8)  { setMessage("Password must be at least 8 characters."); return; }
      if (password !== confirm) { setMessage("Passwords do not match."); return; }
    }
    setStatus("loading");
    setMessage(null);
    try {
      const { setSetting } = await import("@/features/notes/db/queries");
      await setSetting("backup_tg_token",   botToken);
      await setSetting("backup_tg_chat_id", chatId);
      await setSetting("backup_tg_enabled", tgEnabled ? "true" : "false");
      if (tgEnabled) await setSetting("backup_tg_password", password);
      setStatus("success");
      setMessage(tgEnabled ? "Telegram backup enabled." : "Settings saved.");
      setPassword("");
      setConfirm("");
    } catch {
      setStatus("error");
      setMessage("Failed to save settings.");
    }
  }

  async function handleSendNow() {
    if (!botToken.trim() || !chatId.trim()) { setMessage("Configure and save your bot first."); return; }
    if (!password.trim()) { setMessage("Enter a password to encrypt the backup."); return; }
    setStatus("loading");
    setMessage(null);
    try {
      const { assembleBundle }    = await import("@/features/backup/lib/bundler");
      const { compress }          = await import("@/features/backup/lib/compression");
      const { encrypt }           = await import("@/features/backup/lib/crypto");
      const { sendTelegramBackup} = await import("@/features/backup/lib/telegram");

      const bundle     = await assembleBundle();
      const json       = JSON.stringify(bundle);
      const compressed = await compress(json);
      const encrypted  = await encrypt(compressed, password);

      const date      = new Date().toISOString().slice(0, 10);
      const fileName  = `idemora-backup-${date}.nkbackup`;
      const bytes     = new TextEncoder().encode(encrypted);

      await sendTelegramBackup(botToken, chatId, fileName, bytes);
      setStatus("success");
      setMessage(`Sent — ${bundle.noteCount} note${bundle.noteCount !== 1 ? "s" : ""} backed up to Telegram.`);
      setPassword("");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Send failed.");
    }
  }

  const isLoading = status === "loading" || loading;

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="text-sm text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-100 flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M8.5 3L4.5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>
        <span className="text-sm text-idemora-text-faint">/</span>
        <span className="text-sm font-medium text-idemora-text-normal">Telegram backup</span>
      </div>

      {loading ? <p className="text-xs text-idemora-text-muted animate-pulse">Loading…</p> : (
        <div className="space-y-4">

          {/* Setup guide */}
          <div className="p-3 rounded-lg border border-idemora-border bg-idemora-bg-secondary space-y-1.5">
            <p className="text-xs font-medium text-idemora-text-normal">How to set up your bot</p>
            <ol className="text-xs text-idemora-text-muted space-y-1 list-decimal list-inside leading-relaxed">
              <li>Open Telegram → search <span className="font-mono text-idemora-text-normal">@BotFather</span> → send <span className="font-mono text-idemora-text-normal">/newbot</span></li>
              <li>Enter a display name, then a username ending in <span className="font-mono text-idemora-text-normal">bot</span> — BotFather will give you a token</li>
              <li>Click the bot link in BotFather's reply → tap <span className="font-medium text-idemora-text-normal">Start</span> → send it any message (e.g. <span className="font-mono text-idemora-text-normal">hi</span>)</li>
              <li>Paste your token below → click <span className="font-medium text-idemora-text-normal">Fetch chat ID</span></li>
              <li>If Fetch fails, go back to Telegram → send your bot another message → retry</li>
            </ol>
            <p className="text-xs text-idemora-text-muted leading-relaxed pt-0.5">
              The bot must receive at least one message from you before the app can detect it.
            </p>
          </div>

          {/* Bot token */}
          <div>
            <SectionTitle>Bot token</SectionTitle>
            <div className="flex gap-2">
              <input
                type="text"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                disabled={isLoading}
                autoComplete="off"
                spellCheck={false}
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-idemora-border bg-idemora-bg-secondary text-idemora-text-normal placeholder-idemora-text-faint focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
              <button
                onClick={handleFetchChatId}
                disabled={isLoading}
                className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-idemora-bg-secondary text-idemora-text-normal border border-idemora-border hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100 disabled:opacity-50"
              >
                Fetch chat ID
              </button>
            </div>
          </div>

          {/* Chat ID */}
          {chatId && (
            <div>
              <SectionTitle>Chat ID</SectionTitle>
              <div className="px-3 py-2 text-sm rounded-lg border border-green-500/30 bg-green-500/10 text-green-400 font-mono">
                {chatId} ✓
              </div>
            </div>
          )}

          {step === "ready" && (
            <>
              {/* Auto-send toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg border border-idemora-border bg-idemora-bg-secondary">
                <div>
                  <p className="text-sm font-medium text-idemora-text-normal">Send on every auto-backup</p>
                  <p className="text-xs text-idemora-text-muted mt-0.5">Deliver to Telegram after each scheduled backup</p>
                </div>
                <button
                  onClick={() => setTgEnabled((v) => !v)}
                  className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${tgEnabled ? "bg-blue-500" : "bg-idemora-bg-primary border border-idemora-border"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${tgEnabled ? "translate-x-4" : ""}`} />
                </button>
              </div>

              {/* Password for send now */}
              <div>
                <SectionTitle>Backup password</SectionTitle>
                <div className="space-y-2">
                  <PasswordInput value={password} onChange={setPassword} placeholder="Password (min. 8 characters)" disabled={isLoading} />
                  {tgEnabled && <PasswordInput value={confirm} onChange={setConfirm} placeholder="Confirm password" disabled={isLoading} />}
                </div>
                <p className="text-xs text-idemora-text-muted mt-1.5 leading-snug">
                  Used to encrypt the backup before sending.
                </p>
              </div>

              {/* Send now */}
              <button
                onClick={handleSendNow}
                disabled={isLoading}
                className="w-full py-2 rounded-lg text-sm font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-100 flex items-center justify-center gap-2"
              >
                {isLoading && <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 8" strokeLinecap="round"/></svg>}
                {isLoading ? "Sending…" : "Send backup now"}
              </button>
            </>
          )}

          {/* Status message */}
          {message && (
            <p className={`text-xs ${status === "error" ? "text-red-400" : "text-green-500"}`}>
              {status === "success" ? `✓ ${message}` : message}
            </p>
          )}

          {/* Save settings */}
          {step === "ready" && (
            <button
              onClick={handleSave}
              disabled={isLoading}
              className="w-full py-1.5 rounded-lg text-xs font-medium bg-idemora-bg-secondary text-idemora-text-muted border border-idemora-border hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100 disabled:opacity-50"
            >
              Save settings
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function BackupModal() {

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

  async function handleExport() {
    const { exportBackup } = await import("@/features/backup/lib/backup");
    if (!password.trim())         { setMessage("Please enter a password."); return; }
    if (password !== confirm)     { setMessage("Passwords do not match."); return; }
    if (password.length < 8)      { setMessage("Password must be at least 8 characters."); return; }
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

  async function handleRestore() {
    const { restoreBackup } = await import("@/features/backup/lib/backup");
    if (!password.trim()) { setMessage("Please enter the backup password."); return; }
    setStatus("loading");
    setMessage(null);
    try {
      const result = await restoreBackup(password);
      // Merge by ID instead of loadNotes() — loadNotes() calls getAllNotesMeta(),
      // which omits `content` and blanks every currently-mounted editor's text.
      useNoteStore.getState().mergeImportedNotes(result.notes);
      setStatus("success");
      setMessage(`Restore complete — ${result.noteCount} note${result.noteCount !== 1 ? "s" : ""} restored.`);
      setPassword("");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Restore failed.");
    }
  }

  const isLoading = status === "loading";

  if (flow === "auto")     return <AutoBackupFlow onBack={reset} />;
  if (flow === "telegram") return <TelegramFlow   onBack={reset} />;

  if (flow === "idle") {
    return (
      <div>
        <SectionTitle>Backup & Restore</SectionTitle>
        <div className="space-y-3">

          <div className="p-3 rounded-lg border border-idemora-border bg-idemora-bg-secondary">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-idemora-text-normal">Export backup</p>
                <p className="text-xs text-idemora-text-muted leading-snug">Encrypt and download all your notes as a .nkbackup file.</p>
              </div>
              <button onClick={() => { setFlow("export"); setMessage(null); }} className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors duration-100">Export</button>
            </div>
          </div>

          <div className="p-3 rounded-lg border border-idemora-border bg-idemora-bg-secondary">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-idemora-text-normal">Restore from backup</p>
                <p className="text-xs text-idemora-text-muted leading-snug">Upload a .nkbackup file and restore your notes.</p>
              </div>
              <button onClick={() => { setFlow("restore"); setMessage(null); }} className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-idemora-bg-secondary text-idemora-text-normal border border-idemora-border hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100">Restore</button>
            </div>
          </div>

          <div className="p-3 rounded-lg border border-idemora-border bg-idemora-bg-secondary">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-idemora-text-normal">Auto-backup</p>
                <p className="text-xs text-idemora-text-muted leading-snug">Schedule automatic backups to iCloud, Dropbox, or any local folder.</p>
              </div>
              <button onClick={() => { setFlow("auto"); setMessage(null); }} className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-idemora-bg-secondary text-idemora-text-normal border border-idemora-border hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100">Configure</button>
            </div>
          </div>

          <div className="p-3 rounded-lg border border-idemora-border bg-idemora-bg-secondary">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-idemora-text-normal">Telegram backup</p>
                <p className="text-xs text-idemora-text-muted leading-snug">Send encrypted backups to your private Telegram chat.</p>
              </div>
              <button onClick={() => { setFlow("telegram"); setMessage(null); }} className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-idemora-bg-secondary text-idemora-text-normal border border-idemora-border hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100">Configure</button>
            </div>
          </div>

        </div>

        <div className="mt-4 p-3 rounded-lg border border-idemora-border bg-idemora-bg-secondary">
          <p className="text-xs text-idemora-text-muted leading-relaxed">
            Backups are AES-256 encrypted. Only you can decrypt them with your password. Backups can only be restored in Idemora.
          </p>
        </div>
      </div>
    );
  }

  if (flow === "export") {
    return (
      <div>
        <div className="flex items-center gap-3 mb-5">
          <button onClick={reset} className="text-sm text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-100 flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M8.5 3L4.5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back
          </button>
          <span className="text-sm text-idemora-text-faint">/</span>
          <span className="text-sm font-medium text-idemora-text-normal">Export backup</span>
        </div>
        {status === "success" ? (
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-green-500/30 bg-green-500/10">
              <p className="text-sm text-green-400 font-medium">✓ {message}</p>
            </div>
            <button onClick={reset} className="w-full py-1.5 rounded-lg text-xs font-medium bg-idemora-bg-secondary text-idemora-text-muted border border-idemora-border hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100">Done</button>
          </div>
        ) : (
          <div className="space-y-3">
            <SectionTitle>Set a password</SectionTitle>
            <PasswordInput value={password} onChange={setPassword} placeholder="Password (min. 8 characters)" disabled={isLoading} />
            <PasswordInput value={confirm}  onChange={setConfirm}  placeholder="Confirm password"             disabled={isLoading} />
            {message && <p className="text-xs text-red-400">{message}</p>}
            <button onClick={handleExport} disabled={isLoading} className="w-full py-2 rounded-lg text-sm font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-100 flex items-center justify-center gap-2">
              {isLoading && <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 8" strokeLinecap="round"/></svg>}
              {isLoading ? "Encrypting…" : "Export & Download"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <button onClick={reset} className="text-sm text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-100 flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M8.5 3L4.5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>
        <span className="text-sm text-idemora-text-faint">/</span>
        <span className="text-sm font-medium text-idemora-text-normal">Restore from backup</span>
      </div>
      {status === "success" ? (
        <div className="space-y-3">
          <div className="p-3 rounded-lg border border-green-500/30 bg-green-500/10">
            <p className="text-sm text-green-400 font-medium">✓ {message}</p>
          </div>
          <button onClick={reset} className="w-full py-1.5 rounded-lg text-xs font-medium bg-idemora-bg-secondary text-idemora-text-muted border border-idemora-border hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100">Done</button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
            <p className="text-xs text-amber-400 leading-relaxed">Restoring will overwrite existing notes with the same ID. This cannot be undone.</p>
          </div>
          <SectionTitle>Enter backup password</SectionTitle>
          <PasswordInput value={password} onChange={setPassword} placeholder="Backup password" disabled={isLoading} />
          {message && <p className="text-xs text-red-400">{message}</p>}
          <button onClick={handleRestore} disabled={isLoading} className="w-full py-2 rounded-lg text-sm font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-100 flex items-center justify-center gap-2">
            {isLoading && <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 8" strokeLinecap="round"/></svg>}
            {isLoading ? "Restoring…" : "Select file & Restore"}
          </button>
        </div>
      )}
    </div>
  );
}