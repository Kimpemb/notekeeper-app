// src/features/ai/components/ChatPanel.tsx
//
// RAG v3 — Milestone 8 + Phase 3 (M14 scope, save flow)

import { useEffect, useRef, useState, useCallback, type ReactElement } from "react";
import { subscribeToIndexerStatus } from "@/features/ai/lib/indexer";
import { onRecovery } from "@/features/ai/lib/client";
import {
  streamChatWithNotes,
  type ChatMessage,
  type RelatedNote,
  type Tier1ResultCard,
} from "@/features/ai/lib/chat";
import { clearAIHistory, clearConversationSummary, getAllDescendants } from "@/features/notes/db/queries";
import { useNoteStore }        from "@/features/notes/store/useNoteStore";
import { useUIStore }          from "@/features/ui/store/useUIStore";
import { useAIStore }          from "@/features/ai/store/useAIStore";
import { isAIReady }           from "@/features/ai/lib/client";
import type { AICallError }    from "@/features/ai/lib/client";
import { QuickSwitch }         from "@/features/ai/components/QuickSwitch";
import { SaveNoteDialog }      from "@/features/ai/components/SaveNoteDialog";
import { useChatSessionStore } from "@/features/ai/store/useChatSessionStore";
import type { ExcludedTitleMatch } from "@/features/ai/lib/search/hybrid"
import { useAppSettings } from "@/features/ui/store/useAppSettings"
import {
  WEB_SEARCH_PROVIDERS,
  getWebSearchProvider,
  type WebSearchResult,
} from "@/features/ai/lib/search/webSearchProvider"

interface Props {
  noteId: string;
  paneId: 1 | 2;
}

interface MessageMeta {
  sourceTitles:        string[];
  sourceNoteIds:       string[];
  usedEmbeddings:      boolean;
  confidence:          "high" | "medium" | "low";
  relatedNotes:        RelatedNote[];
  tier1Results?:       Tier1ResultCard[];
  excludedNoteNotices?: ExcludedTitleMatch[];
  titleMatchedNoteIds?: string[];
  webNudge?:            "limited" | "zero";
}

// ─── Toast system ─────────────────────────────────────────────────────────────

interface Toast {
  id:        string;
  message:   string;
  prominent: boolean;
}

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, prominent = false) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, prominent }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, prominent ? 5000 : 3000);
  }, []);

  return { toasts, addToast };
}

function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-10 right-5 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`px-3 py-2 rounded-lg shadow-lg border text-xs font-medium animate-fade-in ${
            toast.prominent
              ? "bg-violet-500 text-white border-violet-600"
              : "bg-idemora-bg-primary text-idemora-text-normal border-idemora-border"
          }`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

// ─── Quota exhausted card ─────────────────────────────────────────────────────

function QuotaExhaustedCard({ onRetry }: { onRetry: () => void }) {
  const hasAnyValidKey = useAIStore((s) => s.hasAnyValidKey);
  return (
    <div className="mx-3 mt-2 rounded-lg border border-red-100 bg-red-50/40 p-3 space-y-2.5">
      <div className="flex items-center gap-1.5">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="text-red-400 shrink-0">
          <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M5.5 3.5v2.5M5.5 7.5v.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        <p className="text-xs font-semibold text-red-600">All providers exhausted</p>
      </div>
      <p className="text-[11px] text-red-500 leading-relaxed">
        Daily quota reached on all configured providers. Add a new key or wait for quota reset.
      </p>
      <div className="flex items-center gap-2 pt-0.5">
        <button
          onClick={onRetry}
          disabled={!hasAnyValidKey()}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-600 border border-red-200 hover:bg-red-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
        >
          Retry
        </button>
        <p className="text-[10px] text-red-400">
          {hasAnyValidKey()
            ? "A key is available — tap retry to try again."
            : "Add a key in Settings → AI to continue."}
        </p>
      </div>
    </div>
  );
}

// ─── WebNudge component ──────────────────────────────────────────────────────

function WebNudge({
  messageId,
  nudge,
  query,
  onSearchComplete,
  onDismiss,
}: {
  messageId:        string;
  nudge:            "limited" | "zero";
  query:            string;
  onSearchComplete: (messageId: string, results: WebSearchResult[]) => void;
  onDismiss:        (messageId: string) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const { settings }              = useAppSettings();

  const provider = WEB_SEARCH_PROVIDERS.find(
    (p) => p.id === (settings.web_search_provider ?? "tinyfish")
  ) ?? WEB_SEARCH_PROVIDERS[0];

  const missingKey = provider.requiresKey && !(settings.web_search_api_key ?? "").trim();

  async function handleSearch() {
    if (missingKey) {
      setError(`Web search requires a ${provider.label.split(" ")[0]} API key. Add it in Settings → Web Search.`);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const p       = getWebSearchProvider();
      const results = await p.search(query);
      onSearchComplete(messageId, results);
    } catch {
      setError("Search failed. Check your connection and try again.");
    } finally {
      setSearching(false);
    }
  }

  const copy = nudge === "zero"
    ? "Nothing found in your notes."
    : "Limited results from your notes.";

  return (
    <div className="mx-4 mb-2 ml-9 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="text-sky-400 shrink-0">
            <circle cx="4.5" cy="4.5" r="3.5" stroke="currentColor" strokeWidth="1"/>
            <path d="M4.5 1.5C3.8 2.5 3.4 3.4 3.4 4.5s.4 2 1.1 3M4.5 1.5C5.2 2.5 5.6 3.4 5.6 4.5s-.4 2-1.1 3M1.5 4.5h6"
              stroke="currentColor" strokeWidth="0.7" strokeLinecap="round"/>
          </svg>
          <span className="text-[11px] text-idemora-text-muted">{copy}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleSearch}
            disabled={searching}
            className="px-2 py-0.5 rounded text-[10px] font-medium bg-sky-50/40 text-sky-500 border border-sky-200 hover:bg-sky-100/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
          >
            {searching ? (
              <svg width="9" height="9" viewBox="0 0 9 9" className="animate-spin" fill="none">
                <circle cx="4.5" cy="4.5" r="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="9 4" strokeLinecap="round"/>
              </svg>
            ) : "Search the web"}
          </button>
          <button
            onClick={() => onDismiss(messageId)}
            className="px-2 py-0.5 rounded text-[10px] text-idemora-text-muted hover:text-idemora-text-normal border border-transparent hover:border-idemora-border transition-colors duration-100"
          >
            Dismiss
          </button>
        </div>
      </div>
      {error && (
        <p className="text-[10px] text-amber-500 leading-relaxed">{error}</p>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ChatPanel({ noteId, paneId }: Props) {
  const [messages, setMessages]     = useState<ChatMessage[]>([]);
  const [metaMap, setMetaMap]       = useState<Map<string, MessageMeta>>(new Map());
  const [input, setInput]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [callError, setCallError]   = useState<AICallError | null>(null);
  const [indexingPaused, setIndexingPaused] = useState(false);
  const [allExhausted, setAllExhausted]     = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [oneTimeInclusions, setOneTimeInclusions] = useState<Set<string>>(new Set());
  const [selectedMessage, setSelectedMessage] = useState<{
    user:      { role: "user" | "assistant"; content: string };
    assistant: { role: "user" | "assistant"; content: string };
  } | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [dismissedNudges, setDismissedNudges] = useState<Set<string>>(new Set());
  const [webResultsMap, setWebResultsMap] = useState<Map<string, WebSearchResult[]>>(new Map());

  const { toasts, addToast } = useToasts();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);
  const prevProviderRef = useRef<string | null>(null);
  const prevModelRef    = useRef<string | null>(null);

  // Use a ref to always have current ragScope / session inside handleSend
  // without needing them in the useCallback dep array
  const ragScopeRef    = useRef<"all" | "note">("all");
  const linkedNoteRef  = useRef<string | null>(null);

  const notes          = useNoteStore((s) => s.notes);
  const openTab        = useUIStore((s) => s.openTab);
  const openTabInPane2 = useUIStore((s) => s.openTabInPane2);
  const closeChat      = useUIStore((s) => s.closeChat);
  const setProviderStatus = useAIStore((s) => s.setProviderStatus);
  const primarySlot    = useAIStore((s) => s.primarySlot);
  const embeddingProvider = useAIStore((s) => s.embeddingProvider);
  const rpdBudget      = useAIStore((s) => s.rpdBudget);

  const aiReady    = isAIReady();
  const isFreeTier = !aiReady;
  const currentNote = notes.find((n) => n.id === noteId);
  const embeddingBudget = rpdBudget[embeddingProvider];

  const session           = useChatSessionStore((s) => s.sessions[paneId]);
  const setLinkedNote     = useChatSessionStore((s) => s.setLinkedNote);
  const stampSavedAt      = useChatSessionStore((s) => s.stampSavedAt);
  const clearSession      = useChatSessionStore((s) => s.clearSession);
  const setRagScope       = useChatSessionStore((s) => s.setRagScope);
  const ragScope          = session.ragScope;

  const setWebSearchEnabled = useChatSessionStore((s) => s.setWebSearchEnabled)
  const webSearchEnabled    = session.webSearchEnabled
  const appWebSearch        = useAppSettings((s) => s.settings.web_search_enabled === 1)

  // Keep refs in sync so handleSend always reads current values
  useEffect(() => { ragScopeRef.current   = ragScope; },            [ragScope]);
  useEffect(() => { linkedNoteRef.current = session.linkedNoteId; }, [session.linkedNoteId]);

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    return subscribeToIndexerStatus((status) => setIndexingPaused(status.paused));
  }, []);

  useEffect(() => {
    return onRecovery(() => {
      setAllExhausted(false);
      addToast("Provider recovered — ready to chat", true);
    });
  }, [addToast]);

  useEffect(() => {
    const handleOnline  = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const primaryRotation = useAIStore((s) => s.primaryRotation);
  useEffect(() => {
    if (prevProviderRef.current === null) {
      prevProviderRef.current = primaryRotation.provider;
      prevModelRef.current    = primaryRotation.model;
      return;
    }
    if (primaryRotation.provider !== prevProviderRef.current) {
      addToast(`Switched to ${primaryRotation.provider} — previous provider quota reached`, true);
    } else if (primaryRotation.model !== prevModelRef.current) {
      addToast(`Switched to ${primaryRotation.model}`);
    }
    prevProviderRef.current = primaryRotation.provider;
    prevModelRef.current    = primaryRotation.model;
  }, [primaryRotation, addToast]);

  useEffect(() => {
    if (callError?.code === "ALL_EXHAUSTED") setAllExhausted(true);
  }, [callError]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [noteId]);

  useEffect(() => {
    setMessages([]);
    setMetaMap(new Map());
    setCallError(null);
    clearSession(paneId);
    setDismissedNudges(new Set());
    setWebResultsMap(new Map());
    setWebSearchEnabled(paneId, appWebSearch);
  }, [noteId]);

  // M5: Reactive subscription — watch note store for linked note lifecycle events
  useEffect(() => {
    if (!session?.linkedNoteId) return;
    return useNoteStore.subscribe((state) => {
      const linkedId = useChatSessionStore.getState().getSession(paneId).linkedNoteId;
      if (!linkedId) return;
      const { markLinkedNoteTrashed, markLinkedNoteDeleted, markLinkedNoteRestored, setLinkedNoteTitle } =
        useChatSessionStore.getState();
      const activeNote = state.notes.find((n) => n.id === linkedId);
      if (activeNote) {
        if (session.linkedNoteTrashed) markLinkedNoteRestored(paneId, activeNote.title);
        if (activeNote.title !== session.linkedNoteTitle) setLinkedNoteTitle(paneId, activeNote.title);
        return;
      }
      const trashedNote = state.trashedNotes?.find((n) => n.id === linkedId);
      if (trashedNote) { markLinkedNoteTrashed(paneId); return; }
      if (!session.linkedNoteDeleted) markLinkedNoteDeleted(paneId);
    });
  }, [paneId, session?.linkedNoteId, session?.linkedNoteTrashed, session?.linkedNoteDeleted, session?.linkedNoteTitle]);

  // ── Scope resolution ───────────────────────────────────────────────────────

  async function resolveScopeNoteIds(extraNoteIds?: string[]): Promise<string[] | undefined> {
    if (ragScopeRef.current === "all" && (!extraNoteIds || extraNoteIds.length === 0)) return undefined;
    let base: string[] = [];
    if (ragScopeRef.current === "note") {
      const descendants = await getAllDescendants(noteId);
      base = [noteId, ...descendants.map((d: { id: string }) => d.id)];
    }
    const merged = [...new Set([...base, ...(extraNoteIds ?? [])])];
    return merged.length > 0 ? merged : undefined;
  }

  // ── M19: handleWebSearch function ─────────────────────────────────────────

  async function handleWebSearch(
    userQuery:  string,
    webResults: import("@/features/ai/lib/search/webSearchProvider").WebSearchResult[],
  ) {
    const assistantId  = crypto.randomUUID()
    const assistantMsg: ChatMessage = {
      id: assistantId, role: "assistant", content: "", createdAt: Date.now(),
    }

    setMessages((prev) => [...prev, assistantMsg])
    setLoading(true)
    setStreamingId(assistantId)
    setCallError(null)

    const scopeNoteIds = await resolveScopeNoteIds()

    try {
      const meta = await streamChatWithNotes(
        userQuery,
        notes,
        noteId,
        currentNote,
        scopeNoteIds,
        {
          onChunk: (token) => {
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, content: m.content + token } : m)
            )
          },
          onDone:  () => { setStreamingId(null); setLoading(false) },
          onError: (err) => { setStreamingId(null); setLoading(false); setCallError(err) },
        },
        undefined,    // overrideNoteIds — not applicable for web search turns
        webResults,   // injected web results
      )

      setMetaMap((prev) =>
        new Map(prev).set(assistantId, {
          sourceTitles:        meta.sourceTitles,
          sourceNoteIds:       meta.sourceNoteIds,
          usedEmbeddings:      meta.usedEmbeddings,
          confidence:          meta.confidence,
          relatedNotes:        meta.relatedNotes,
          tier1Results:        meta.tier1Results,
          excludedNoteNotices: meta.excludedNoteNotices,
          titleMatchedNoteIds: meta.titleMatchedNoteIds,
          webNudge:            undefined, // no nudge on web-grounded responses
        })
      )
    } catch { /* errors handled by onError above */ }
  }

  // ── Send ───────────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const q = input.trim();
    if (!q || loading || isFreeTier) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(), role: "user", content: q, createdAt: Date.now(),
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId, role: "assistant", content: "", createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setLoading(true);
    setStreamingId(assistantId);
    setCallError(null);

    let errorHandled = false;

    try {
      const scopeNoteIds = await resolveScopeNoteIds();

      const meta = await streamChatWithNotes(
        q,
        notes,
        noteId,
        currentNote,
        scopeNoteIds,
        {
          onChunk: (token) => {
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, content: m.content + token } : m)
            );
          },
          onDone: () => {
            setStreamingId(null);
            setLoading(false);
          },
          onError: (err: AICallError) => {
            errorHandled = true;
            setMessages((prev) => prev.filter((m) => m.id !== assistantId));
            if (err.code === "AUTH_FAILED" || err.code === "QUOTA_EXCEEDED") {
              setProviderStatus(primarySlot.provider, "error", err.message);
            }
            setCallError(err);
            setStreamingId(null);
            setLoading(false);
          },
        }
      );

      setMetaMap((prev) =>
        new Map(prev).set(assistantId, {
          sourceTitles:        meta.sourceTitles,
          sourceNoteIds:       meta.sourceNoteIds,
          usedEmbeddings:      meta.usedEmbeddings,
          confidence:          meta.confidence,
          relatedNotes:        meta.relatedNotes,
          tier1Results:        meta.tier1Results,
          excludedNoteNotices: meta.excludedNoteNotices,
          titleMatchedNoteIds: meta.titleMatchedNoteIds,
          webNudge:            meta.webNudge,
        })
      );
    } catch (rawErr) {
      if (!errorHandled) {
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        const err = rawErr as Partial<AICallError>;
        setCallError(err?.code ? (rawErr as AICallError) : {
          code: "UNKNOWN", provider: primarySlot.provider, model: primarySlot.model,
          message: "Something went wrong. Please try again.", retryable: false, name: "AICallError",
        } as AICallError);
        setStreamingId(null);
        setLoading(false);
      }
    }
  // resolveScopeNoteIds uses refs so doesn't need to be a dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, loading, isFreeTier, notes, noteId, currentNote, primarySlot, setProviderStatus]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  async function handleClear() {
    setMessages([]);
    setMetaMap(new Map());
    setCallError(null);
    setOneTimeInclusions(new Set());
    setDismissedNudges(new Set());
    setWebResultsMap(new Map());
    clearSession(paneId);
    await Promise.all([clearAIHistory(noteId), clearConversationSummary(noteId)]);
  }

  function handleOpenNote(id: string) {
    if (paneId === 2) openTabInPane2(id);
    else openTab(id);
  }

  const handleOneTimeInclusion = useCallback(async (inclusionNoteId: string) => {
  const allInclusions = [...oneTimeInclusions, inclusionNoteId];
  setOneTimeInclusions(new Set(allInclusions));

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg) return;

  const assistantId = crypto.randomUUID();
  const assistantMsg: ChatMessage = {
    id: assistantId, role: "assistant", content: "", createdAt: Date.now(),
  };
  setMessages((prev) => [...prev, assistantMsg]);
  setLoading(true);
  setStreamingId(assistantId);

  const scopeNoteIds = await resolveScopeNoteIds(allInclusions);

  try {
    const meta = await streamChatWithNotes(
      lastUserMsg.content,
      notes,
      noteId,
      currentNote,
      scopeNoteIds,
      {
        onChunk: (token) => {
          setMessages((prev) =>
            prev.map((m) => m.id === assistantId ? { ...m, content: m.content + token } : m)
          );
        },
        onDone:  () => { setStreamingId(null); setLoading(false); },
        onError: (err) => { setStreamingId(null); setLoading(false); setCallError(err); },
      },
      allInclusions,
    );
    setMetaMap((prev) =>
      new Map(prev).set(assistantId, {
        sourceTitles:        meta.sourceTitles,
        sourceNoteIds:       meta.sourceNoteIds,
        usedEmbeddings:      meta.usedEmbeddings,
        confidence:          meta.confidence,
        relatedNotes:        meta.relatedNotes,
        tier1Results:        meta.tier1Results,
        excludedNoteNotices: meta.excludedNoteNotices,
        titleMatchedNoteIds: meta.titleMatchedNoteIds,
        webNudge:            meta.webNudge,
      })
    );
  } catch { /* errors handled by onError above */ }
}, [messages, notes, noteId, currentNote, oneTimeInclusions]);

  function handleScopeToggle() {
    if (ragScope === "note") {
      setRagScope(paneId, "all");
    } else {
      // noteId is always defined — no save/link required to scope
      setRagScope(paneId, "note");
    }
  }

  const hasNoEmbeddingMessage = [...metaMap.values()].some((m) => !m.usedEmbeddings);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full w-72 shrink-0 border-l border-idemora-border bg-idemora-bg-primary">

      {/* ── Header ── */}
      <div className="flex flex-col border-b border-idemora-border shrink-0">

        {/* Row 1 — identity + close */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-5 h-5 rounded-md bg-violet-50 flex items-center justify-center shrink-0">
              <svg width="11" height="11" viewBox="0 0 13 13" fill="none" className="text-violet-500">
                <path d="M6.5 1C3.46 1 1 3.19 1 5.9c0 1.5.7 2.85 1.82 3.78L2.5 12l2.3-1.1c.54.15 1.1.23 1.7.23 3.04 0 5.5-2.19 5.5-4.9S9.54 1 6.5 1z"
                  stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                <path d="M4 5.5h5M4 7.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
              </svg>
            </div>
            {!isFreeTier && <QuickSwitch />}
            {isFreeTier && (
              <span className="text-sm font-semibold text-idemora-text-normal truncate">
                Ask your notes
              </span>
            )}
            {messages.length > 0 && !isFreeTier && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-violet-100 text-violet-600 tabular-nums shrink-0">
                {Math.floor(messages.length / 2)}
              </span>
            )}
            {!isFreeTier && embeddingBudget.used > 0 && embeddingBudget.used < embeddingBudget.ceiling && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse shrink-0"
                title={`Indexing — ${embeddingBudget.ceiling - embeddingBudget.used} requests remaining today`}
              />
            )}
            {!isFreeTier && (
              <button
                onClick={() => !isOffline && setWebSearchEnabled(paneId, !webSearchEnabled)}
                disabled={isOffline}
                title={
                  isOffline
                    ? "Web search unavailable offline"
                    : webSearchEnabled
                      ? "Web search on — click to turn off"
                      : "Web search off — click to turn on"
                }
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border transition-colors duration-100 shrink-0 ${
                  isOffline
                    ? "opacity-40 cursor-not-allowed text-idemora-text-muted border-idemora-border"
                    : webSearchEnabled
                      ? "text-sky-500 border-sky-300 bg-sky-50/30 hover:bg-sky-100/40"
                      : "text-idemora-text-muted border-idemora-border hover:text-sky-500 hover:border-sky-300"
                }`}
              >
                <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="shrink-0">
                  <circle cx="4.5" cy="4.5" r="3.5" stroke="currentColor" strokeWidth="1"/>
                  <path d="M4.5 1C3.5 2.5 3 3.5 3 4.5s.5 2 1.5 3.5M4.5 1C5.5 2.5 6 3.5 6 4.5S5.5 6.5 4.5 8M1 4.5h7"
                    stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
                </svg>
                {webSearchEnabled ? "Web on" : "Web"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {messages.length > 0 && (
              <button
                onClick={handleClear}
                title="Clear conversation"
                className="w-6 h-6 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-100"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1.5 2.5h7M3 2.5V1.5h4v1M3.5 4.5v3M6.5 4.5v3M2 2.5l.5 6h5l.5-6"
                    stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            <button
              onClick={() => closeChat(paneId)}
              className="w-6 h-6 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-100"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Row 2 — save + linked note indicator */}
        {(messages.length > 0 || session?.linkedNoteId || session?.linkedNoteTrashed || session?.linkedNoteDeleted) && (
          <div className="flex items-center gap-1.5 px-3 pb-2.5 flex-wrap">
            {messages.length > 0 && !isFreeTier && (
              <button
                onClick={() => setSaveDialogOpen(true)}
                title="Save to Note"
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-idemora-text-muted border border-idemora-border hover:text-violet-500 hover:border-violet-300 transition-colors duration-100 shrink-0"
              >
                <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                  <path d="M1.5 6.5V8h6V6.5M4.5 1v5M2.5 4l2 2 2-2"
                    stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Save
              </button>
            )}
            {session?.linkedNoteId && !session?.linkedNoteDeleted && (
              <button
                onClick={() => {
                  if (session.linkedNoteId) {
                    if (paneId === 2) openTabInPane2(session.linkedNoteId);
                    else openTab(session.linkedNoteId);
                  }
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-violet-500 border border-violet-200 hover:bg-violet-50/30 transition-colors duration-100 min-w-0"
                title={`Saved to ${session.linkedNoteTitle ?? "note"}`}
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0">
                  <rect x="1" y="1" width="6" height="6" rx="0.8" stroke="currentColor" strokeWidth="1"/>
                  <path d="M2.5 3h3M2.5 5h2" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
                </svg>
                <span className="truncate max-w-[6rem]">{session.linkedNoteTitle ?? "Saved"}</span>
                <svg width="7" height="7" viewBox="0 0 7 7" fill="none" className="shrink-0">
                  <path d="M1.5 5.5L5.5 1.5M5.5 1.5H2.5M5.5 1.5V4.5"
                    stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            {session?.linkedNoteTrashed && (
              <span className="text-[10px] text-amber-500 shrink-0">Linked note in trash</span>
            )}
            {session?.linkedNoteDeleted && (
              <span className="text-[10px] text-idemora-text-muted shrink-0">Note deleted — next save creates new</span>
            )}
          </div>
        )}
      </div>

      {/* ── Indexing paused banner ── */}
      {indexingPaused && (
        <div className="mx-3 mt-2 px-3 py-1.5 rounded-lg bg-amber-50/40 border border-amber-100 flex items-center gap-2 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
          <p className="text-[10px] text-amber-600">Indexing paused — embedding quota reached</p>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto">
        {isFreeTier ? (
          <FreeTierState />
        ) : messages.length === 0 && !callError ? (
          <EmptyState currentNoteTitle={currentNote?.title} />
        ) : (
          <div className="py-3 space-y-1">
            {allExhausted && (
              <QuotaExhaustedCard onRetry={() => { setAllExhausted(false); handleSend(); }} />
            )}
            {hasNoEmbeddingMessage && messages.length > 0 && (
              <div className="mx-3 mb-1 px-3 py-2 rounded-lg bg-amber-50/40 border border-amber-100 flex items-start gap-2">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="text-amber-400 shrink-0 mt-0.5">
                  <path d="M5.5 1L10 9.5H1L5.5 1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                  <path d="M5.5 4.5v2M5.5 8v.1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                </svg>
                <p className="text-[10px] text-amber-600 leading-relaxed">
                  Running keyword search only — enable an embedding provider in{" "}
                  <span className="font-medium">Settings → AI</span> for better results.
                </p>
              </div>
            )}
            {messages.map((msg, idx) => {
              const meta        = metaMap.get(msg.id);
              const isStreaming = msg.id === streamingId;
              const isLatest    = idx === messages.length - 1;
              const prevMsg     = idx > 0 ? messages[idx - 1] : null;
              return (
                <div key={msg.id} className="group/msg relative">
                  <MessageBubble message={msg} isStreaming={isStreaming} />
                  {msg.role === "assistant" && meta && !isStreaming && (
                    <MessageFooter
                      meta={meta}
                      onOpenNote={handleOpenNote}
                      onOneTimeInclusion={handleOneTimeInclusion}
                    />
                  )}
                  {msg.role === "assistant" && meta && !isStreaming && meta.webNudge && !isStreaming &&
                   !dismissedNudges.has(msg.id) && !webResultsMap.has(msg.id) && (
                    <WebNudge
                      messageId={msg.id}
                      nudge={meta.webNudge}
                      query={prevMsg?.role === "user" ? prevMsg.content : ""}
                      onSearchComplete={(id, results) => {
                        setWebResultsMap((prev) => new Map(prev).set(id, results))
                        const userQuery = prevMsg?.role === "user" ? prevMsg.content : ""
                        if (userQuery) handleWebSearch(userQuery, results)
                      }}
                      onDismiss={(id) => {
                        setDismissedNudges((prev) => new Set(prev).add(id));
                      }}
                    />
                  )}
                  {msg.role === "assistant" && !isStreaming && !isFreeTier && (
                    <div className={`px-4 pb-1 ${isLatest ? "flex" : "hidden group-hover/msg:flex"}`}>
                      <button
                        onClick={() => {
                          const userMsg = prevMsg?.role === "user" ? prevMsg : null;
                          setSelectedMessage(userMsg ? {
                            user:      { role: "user",      content: userMsg.content },
                            assistant: { role: "assistant", content: msg.content },
                          } : null);
                          setSaveDialogOpen(true);
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-idemora-text-muted hover:text-violet-500 border border-transparent hover:border-violet-200 transition-colors duration-100"
                      >
                        <svg width="8" height="8" viewBox="0 0 9 9" fill="none">
                          <path d="M1.5 6.5V8h6V6.5M4.5 1v5M2.5 4l2 2 2-2"
                            stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Save to note ↓
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {callError && !allExhausted && (
              <div className="mx-3 mt-1">
                <ErrorCard error={callError} onDismiss={() => setCallError(null)} />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Input area ── */}
      {!isFreeTier && (
        <div className="shrink-0 border-t border-idemora-border">

          {/* Scope toggle — sits just above the textarea */}
          <div className="flex items-center px-3 pt-2.5 pb-1">
            <button
              onClick={handleScopeToggle}
              disabled={false}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-colors duration-100 ${
                ragScope === "note"
                  ? "text-violet-500 border-violet-300 bg-violet-50/30 hover:bg-violet-100/40"
                  : "text-idemora-text-muted border-idemora-border hover:text-violet-500 hover:border-violet-300"
              }`}
              title={
                ragScope === "note"
                  ? `Scoped to "${currentNote?.title ?? "this note"}" and sub-notes — click to search all notes`
                  : `Searching all notes — click to scope to "${currentNote?.title ?? "this note"}" and sub-notes`
              }
            >
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="shrink-0">
                <circle cx="4.5" cy="4.5" r="3.5" stroke="currentColor" strokeWidth="1"/>
                <path d="M4.5 2.5v4M2.5 4.5h4" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
              </svg>
              {ragScope === "note" && currentNote?.title
                ? `Scoped: ${currentNote.title.slice(0, 18)}${currentNote.title.length > 18 ? "…" : ""}`
                : "All notes"}
            </button>
          </div>

          {/* Textarea + send */}
          <div className="flex items-end gap-2 px-3 pb-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your notes…"
              disabled={loading}
              rows={1}
              className="flex-1 resize-none rounded-lg px-3 py-2 text-sm bg-idemora-bg-primary border-idemora-border text-idemora-text-normal placeholder-idemora-text-muted focus:outline-none focus:ring-1 focus:ring-violet-400 transition-colors duration-100 disabled:opacity-50 max-h-32 leading-relaxed"
              style={{ height: "auto", minHeight: "38px" }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 128) + "px";
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors duration-100 shrink-0"
            >
              {loading ? (
                <svg width="12" height="12" viewBox="0 0 12 12" className="animate-spin" fill="none">
                  <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 7" strokeLinecap="round"/>
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          </div>

          {/* Footer hint + RPD budget */}
          <div className="flex items-center justify-between px-3 pb-2.5">
            <p className="text-[10px] text-idemora-text-muted">
              Enter to send · Shift+Enter for new line
            </p>
            {embeddingBudget.used > 0 && (
              <p className="text-[10px] text-idemora-text-muted tabular-nums">
                {embeddingBudget.used}/{embeddingBudget.ceiling} req
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Save dialog ── */}
      {saveDialogOpen && (
        <SaveNoteDialog
          paneId={paneId}
          messages={messages}
          selectedMessage={selectedMessage ?? undefined}
          onClose={() => { setSaveDialogOpen(false); setSelectedMessage(null); }}
          onSaveSuccess={(savedNoteId, savedNoteTitle) => {
            const isFirstSave = !session.linkedNoteId;
            setLinkedNote(paneId, savedNoteId, savedNoteTitle);
            stampSavedAt(paneId);
            if (isFirstSave) {
              setRagScope(paneId, "note");
              addToast("Search scoped to this note and sub-notes — change anytime above");
            }
          }}
        />
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message, isStreaming }: { message: ChatMessage; isStreaming: boolean }) {
  const isUser = message.role === "user";

  function renderWithCitations(text: string) {
    const parts = text.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/^\[(\d+)\]$/);
      if (match) {
        return (
          <sup
            key={i}
            className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-violet-100 text-violet-600 text-[8px] font-bold mx-0.5 cursor-default"
            title={`Source ${match[1]}`}
          >
            {match[1]}
          </sup>
        );
      }
      return <span key={i}>{part}</span>;
    });
  }

  return (
    <div className={`px-4 py-1.5 ${isUser ? "flex justify-end" : ""}`}>
      {isUser ? (
        <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-tr-sm bg-violet-500 text-white text-sm leading-relaxed">
          {message.content}
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M4 1C2.34 1 1 2.19 1 3.65c0 .88.44 1.67 1.12 2.18L2 7l1.35-.65c.21.04.43.05.65.05C5.66 6.4 7 5.21 7 3.65S5.66 1 4 1z"
                  fill="currentColor" className="text-violet-500"/>
              </svg>
            </div>
            <span className="text-[10px] font-semibold text-violet-500 uppercase tracking-wide">
              Assistant
            </span>
          </div>
          {isStreaming && message.content === "" && (
            <div className="pl-5 flex items-center gap-1 py-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce"
                  style={{ animationDelay: `${i * 150}ms`, animationDuration: "800ms" }} />
              ))}
            </div>
          )}
          {message.content !== "" && (
            <div className="text-sm text-idemora-text-normal leading-relaxed whitespace-pre-wrap pl-5">
              {renderWithCitations(message.content)}
              {isStreaming && (
                <span className="inline-block w-0.5 h-3.5 bg-violet-400 ml-0.5 align-middle animate-pulse" />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Message footer ───────────────────────────────────────────────────────────

function MessageFooter({
  meta,
  onOpenNote,
  onOneTimeInclusion,
}: {
  meta:                MessageMeta;
  onOpenNote:          (id: string) => void;
  onOneTimeInclusion:  (noteId: string) => void;
}) {
  if (meta.tier1Results && meta.tier1Results.length > 0) {
    return <Tier1ResultCards cards={meta.tier1Results} onOpenNote={onOpenNote} />;
  }
  return (
    <div className="px-4 pb-2 pl-9 space-y-1.5">
      {meta.confidence === "low" && (
        <div className="flex items-center gap-1.5">
          <svg width="10" height="10" viewBox="0 0 8 8" fill="none" className="text-amber-400 shrink-0">
            <path d="M4 1L7 7H1L4 1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
            <path d="M4 3.5v2M4 6v.1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          </svg>
          <p className="text-[10px] text-amber-500 leading-relaxed">Limited matches — answer may be incomplete</p>
        </div>
      )}
      {meta.confidence === "medium" && (
        <p className="text-[10px] text-idemora-text-muted">Sourced from your notes</p>
      )}
      {meta.sourceTitles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {meta.sourceTitles.map((title, i) => {
            const isTitleMatch = meta.titleMatchedNoteIds?.includes(meta.sourceNoteIds[i]);
            return (
              <button
                key={meta.sourceNoteIds[i]}
                onClick={() => onOpenNote(meta.sourceNoteIds[i])}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors duration-100 max-w-[9rem] ${
                  isTitleMatch
                    ? "bg-violet-50/40 text-violet-500 hover:text-violet-600"
                    : "bg-idemora-bg-primary text-idemora-text-muted hover:text-violet-400"
                }`}
                title={isTitleMatch ? `Direct note lookup: ${title}` : title}
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0">
                  <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1"/>
                  <path d="M2.5 3h3M2.5 5h2" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
                </svg>
                <span className="truncate">[{i + 1}] {title}</span>
              </button>
            );
          })}
        </div>
      )}
      {meta.excludedNoteNotices && meta.excludedNoteNotices.length > 0 && (
        <div className="pt-0.5 space-y-1">
          {meta.excludedNoteNotices.map((n) => (
            <p key={n.note_id} className="text-[10px] text-idemora-text-muted leading-relaxed">
              <span className="font-medium">"{n.note_title}"</span> may be relevant but is excluded from search.{" "}
              <button
                onClick={() => onOneTimeInclusion(n.note_id)}
                className="text-violet-500 hover:underline"
              >
                Include it?
              </button>
            </p>
          ))}
        </div>
      )}
      {meta.relatedNotes.length > 0 && meta.confidence !== "low" && (
        <div className="pt-0.5">
          <p className="text-[10px] text-idemora-text-muted mb-1">Related</p>
          <div className="flex flex-wrap gap-1">
            {meta.relatedNotes.map((note) => (
              <button
                key={note.noteId}
                onClick={() => onOpenNote(note.noteId)}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-50/30 text-blue-500 hover:bg-blue-950/50 transition-colors duration-100 max-w-[9rem]"
                title={note.title}
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0">
                  <path d="M1 4h6M4 1l3 3-3 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="truncate">{note.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-[10px] text-idemora-text-muted">
        {meta.usedEmbeddings ? "✦ semantic search" : "◦ keyword search"}
      </p>
    </div>
  );
}

// ─── Tier 1 result cards ──────────────────────────────────────────────────────

const CONFIDENCE_COLORS: Record<Tier1ResultCard["confidence"], string> = {
  strong:   "text-violet-500 bg-violet-50/40",
  possible: "text-blue-500 bg-blue-50/30",
  weak:     "text-idemora-text-muted bg-idemora-bg-primary",
};

const BLOCK_TYPE_ICONS: Record<string, ReactElement> = {
  codeBlock: (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
      <path d="M2.5 3L1 4.5l1.5 1.5M6.5 3L8 4.5 6.5 6M5 2l-1 5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  heading: (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
      <path d="M1.5 2v5M7.5 2v5M1.5 4.5h6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  ),
  callout: (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
      <rect x="1" y="1" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1"/>
      <path d="M4.5 3v2.5M4.5 6.5v.1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  ),
  paragraph: (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
      <path d="M1.5 3h6M1.5 5h6M1.5 7h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  ),
};

function Tier1ResultCards({ cards, onOpenNote }: { cards: Tier1ResultCard[]; onOpenNote: (id: string) => void }) {
  const shown    = cards.slice(0, 8);
  const lowCount = shown.filter((c) => c.confidence !== "weak").length < 3;
  return (
    <div className="px-3 pb-3 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-idemora-text-muted px-0.5 pt-1">
        Found in your notes
      </p>
      {shown.map((card, i) => (
        <button
          key={`${card.noteId}-${i}`}
          onClick={() => onOpenNote(card.noteId)}
          className="w-full text-left rounded-lg border border-idemora-border bg-idemora-bg-primary p-2.5 space-y-1 hover:border-violet-300 transition-colors duration-100 group"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-idemora-text-normal truncate group-hover:text-violet-500 transition-colors duration-100">
              {card.noteTitle}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium border border-idemora-border text-idemora-text-muted">
                {card.sourceType === "vault_entry" ? "vault" : "note"}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${CONFIDENCE_COLORS[card.confidence]}`}>
                {card.confidence}
              </span>
            </div>
          </div>
          {card.chunkHeading && (
            <p className="text-[10px] text-idemora-text-muted truncate">§ {card.chunkHeading}</p>
          )}
          <p className="text-[11px] text-idemora-text-normal leading-relaxed line-clamp-3">{card.excerpt}</p>
          <div className="flex items-center gap-1 pt-0.5">
            <span className="text-idemora-text-muted">
              {BLOCK_TYPE_ICONS[card.blockType] ?? BLOCK_TYPE_ICONS.paragraph}
            </span>
            <span className="text-[9px] text-idemora-text-muted">{card.blockType}</span>
          </div>
        </button>
      ))}
      {lowCount && (
        <p className="text-[10px] text-idemora-text-muted px-0.5">
          Low match confidence — try rephrasing or narrowing your scope.
        </p>
      )}
    </div>
  );
}

// ─── Error card ───────────────────────────────────────────────────────────────

function ErrorCard({ error, onDismiss }: { error: AICallError; onDismiss: () => void }) {
  const configs: Record<string, { title: string; body: string; showSwitch: boolean; showRetry: boolean }> = {
    NETWORK_ERROR: { title: "No connection",        body: "Couldn't reach the provider. Check your internet and try again.", showSwitch: false, showRetry: false },
    AUTH_FAILED:   { title: "Invalid API key",      body: `Your ${error.provider} key was rejected. Switch to another provider or update the key in Settings → AI.`, showSwitch: true, showRetry: false },
    QUOTA_EXCEEDED:{ title: "Quota exhausted",      body: `You've hit your ${error.provider} limit. Switch providers or upgrade your plan.`, showSwitch: true, showRetry: false },
    RATE_LIMITED:  { title: "Rate limited",         body: `Too many requests to ${error.provider}. Wait a moment, or switch to another provider.`, showSwitch: true, showRetry: true },
    OVERLOADED:    { title: "Provider overloaded",  body: `${error.provider} is under heavy load right now. Try again or switch.`, showSwitch: true, showRetry: true },
    NO_KEY:        { title: "No API key",           body: `No key is configured for ${error.provider}. Add one in Settings → AI, or switch provider.`, showSwitch: true, showRetry: false },
    NO_PROVIDER:   { title: "No provider assigned", body: "The primary slot has no provider set. Configure it in Settings → AI.", showSwitch: false, showRetry: false },
    UNKNOWN:       { title: "Something went wrong", body: error.message || "An unexpected error occurred. Please try again.", showSwitch: false, showRetry: true },
  };
  const cfg = configs[error.code] ?? configs.UNKNOWN;
  return (
    <div className="rounded-lg border border-red-100 bg-red-50/40 p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="text-red-400 shrink-0 mt-px">
            <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M5.5 3.5v2.5M5.5 7.5v.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <p className="text-xs font-semibold text-red-600">{cfg.title}</p>
        </div>
        <button onClick={onDismiss} className="text-red-300 hover:text-red-500 transition-colors duration-75 shrink-0">
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
      <p className="text-[11px] text-red-500 leading-relaxed">{cfg.body}</p>
      {cfg.showSwitch && (
        <div className="pt-0.5">
          <p className="text-[10px] text-red-400 mb-1.5">Switch provider:</p>
          <QuickSwitch defaultOpen={false} />
        </div>
      )}
      {cfg.showRetry && error.retryable && (
        <p className="text-[10px] text-red-400">Dismiss this and try again — it may resolve itself.</p>
      )}
    </div>
  );
}

// ─── Free tier state ──────────────────────────────────────────────────────────

function FreeTierState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <div className="w-12 h-12 rounded-2xl bg-idemora-bg-primary flex items-center justify-center">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="text-idemora-text-muted">
          <circle cx="11" cy="11" r="8.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M8 9.5c0-1.66 1.34-3 3-3s3 1.34 3 3c0 1.5-1 2.5-2.5 3v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          <circle cx="11" cy="16" r=".7" fill="currentColor"/>
        </svg>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-idemora-text-normal">Keyword search only</p>
        <p className="text-xs text-idemora-text-muted leading-relaxed">
          You're on the free tier. Chat and semantic search require an API key.
        </p>
        <p className="text-xs text-idemora-text-muted leading-relaxed">
          Add a key in <span className="font-medium text-violet-500">Settings → AI</span> to unlock everything.
        </p>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ currentNoteTitle }: { currentNoteTitle?: string }) {
  const suggestions = [
    "What do I know about this topic?",
    "Summarize the key themes across my notes",
    currentNoteTitle ? "How does this relate to my other notes?" : "What connections exist between my notes?",
  ];
  return (
    <div className="flex flex-col gap-4 px-4 py-6">
      <div className="flex flex-col items-center gap-3 text-center py-4">
        <div className="w-12 h-12 rounded-2xl bg-violet-50/50 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="text-violet-400">
            <path d="M11 2C6.58 2 3 5.32 3 9.4c0 2.44 1.17 4.62 3 6.03V20l3.5-1.7c.48.1.98.1 1.5.1 4.42 0 8-3.32 8-7.4S15.42 2 11 2z"
              stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
            <path d="M7 9h8M7 12h5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-idemora-text-normal">Ask your notes anything</p>
          <p className="text-xs text-idemora-text-muted mt-0.5 leading-relaxed">
            I'll search your vault and answer using what you've written.
          </p>
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-idemora-text-muted px-0.5">
          Try asking
        </p>
        {suggestions.map((s, i) => <SuggestionChip key={i} text={s} />)}
      </div>
      <div className="p-2.5 rounded-lg bg-idemora-bg-primary border border-idemora-border">
        <p className="text-[10px] text-idemora-text-muted leading-relaxed">
          💡 Use <span className="font-medium text-idemora-text-muted">Summarize</span> on your notes first — it builds context that makes answers much richer.
        </p>
      </div>
    </div>
  );
}

function SuggestionChip({ text }: { text: string }) {
  return (
    <div className="px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-primary text-xs text-idemora-text-muted leading-relaxed cursor-default hover:text-violet-400 transition-colors duration-100">
      {text}
    </div>
  );
}