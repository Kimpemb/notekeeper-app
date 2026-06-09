// src/features/ai/components/ChatPanel.tsx
//
// RAG v3 — Milestone 8 + Phase 3 (M14 scope, save flow)

import { useEffect, useRef, useState, useCallback, useMemo, type ReactElement } from "react";
import { subscribeToIndexerStatus } from "@/features/ai/lib/indexer";
import { onRecovery } from "@/features/ai/lib/client";
import {
  streamChatWithNotes,
  runPipeline,
  type PipelineResult,
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
import { useChatSessionStore, emptySession } from "@/features/ai/store/useChatSessionStore"
import type { PersistedMeta } from "@/features/ai/store/useChatSessionStore"
import type { ExcludedTitleMatch } from "@/features/ai/lib/search/hybrid"
import { useAppSettings } from "@/features/ui/store/useAppSettings"
import { marked } from "marked"
import hljs from "highlight.js"
import "highlight.js/styles/github-dark-dimmed.css"
import {
  WEB_SEARCH_PROVIDERS,
  getWebSearchProvider,
  type WebSearchResult,
} from "@/features/ai/lib/search/webSearchProvider"
import { detectIntent } from "@/features/ai/lib/search/intentDetection"  // ← ADD THIS

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
  webGrounded?:         boolean;
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
  // messages and persistedMeta live in the store — not local state
  const [runtimeMetaMap, setRuntimeMetaMap] = useState<Map<string, Partial<MessageMeta>>>(new Map());
  const [input, setInput]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [callError, setCallError]   = useState<AICallError | null>(null);
  const [streamStatus, setStreamStatus] = useState<string | null>(null)
  const [indexingPaused, setIndexingPaused] = useState(false);
  const [allExhausted, setAllExhausted]     = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [embeddingWarningDismissed, setEmbeddingWarningDismissed] = useState(false);
  const [oneTimeInclusions, setOneTimeInclusions] = useState<Set<string>>(new Set());
  const [selectedMessage, setSelectedMessage] = useState<{
    user:      { role: "user" | "assistant"; content: string };
    assistant: { role: "user" | "assistant"; content: string };
  } | null>(null);
  const [dismissedNudges, setDismissedNudges] = useState<Set<string>>(new Set());
const [webResultsMap, setWebResultsMap] = useState<Map<string, WebSearchResult[]>>(new Map());
const [suppressedNudges, setSuppressedNudges] = useState<Set<string>>(new Set());
  const { toasts, addToast } = useToasts();

  

  const messagesEndRef    = useRef<HTMLDivElement>(null);
  const inputRef          = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const prevProviderRef = useRef<string | null>(null);
  const prevModelRef    = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null)


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
  
  const aiReady    = isAIReady();
  const isFreeTier = !aiReady;
  const currentNote = notes.find((n) => n.id === noteId);

  const setPaneNote       = useChatSessionStore((s) => s.setPaneNote);
  const addMessage        = useChatSessionStore((s) => s.addMessage);
  const setMessageContent = useChatSessionStore((s) => s.setMessageContent);
  const setPersistedMeta  = useChatSessionStore((s) => s.setPersistedMeta);
  const saveSession       = useChatSessionStore((s) => s.saveSession);
  const setLinkedNote     = useChatSessionStore((s) => s.setLinkedNote);
  const stampSavedAt      = useChatSessionStore((s) => s.stampSavedAt);
  const clearSession      = useChatSessionStore((s) => s.clearSession);
  const setRagScope       = useChatSessionStore((s) => s.setRagScope);
const paneNoteId      = useChatSessionStore((s) => s.paneNoteId[paneId])
const _sessions       = useChatSessionStore((s) => s.sessions)
const _session        = (paneNoteId ? _sessions[paneNoteId] : null) ?? emptySession()
const messages        = _session.messages
const ragScope        = _session.ragScope
const persistedMeta   = _session.persistedMeta
const linkedNoteId    = _session.linkedNoteId
const linkedNoteTitle = _session.linkedNoteTitle
const linkedNoteTrashed = _session.linkedNoteTrashed
const linkedNoteDeleted = _session.linkedNoteDeleted
const isLoading       = _session.isLoading

  // Merge persisted + runtime meta for rendering
  const metaMap = useMemo(() => {
  const map = new Map<string, MessageMeta>(
    persistedMeta.map((pm) => {
      const runtime = runtimeMetaMap.get(pm.messageId) ?? {}
      return [pm.messageId, {
        sourceTitles:        runtime.sourceTitles        ?? pm.citations?.map(c => c.title) ?? [],
        sourceNoteIds:       runtime.sourceNoteIds       ?? pm.citations?.map(c => c.noteId) ?? [],
        usedEmbeddings:      pm.usedEmbeddings           ?? false,
        confidence:          pm.confidence               ?? "medium",
        relatedNotes:        runtime.relatedNotes        ?? [],
        tier1Results:        runtime.tier1Results,
        excludedNoteNotices: runtime.excludedNoteNotices ?? [],
        titleMatchedNoteIds: pm.citations?.filter(c => c.isTitleMatch).map(c => c.noteId) ?? [],
        webNudge:            runtime.webNudge,
        webGrounded:         pm.usedWeb                  ?? false,
      }]
    })
  )
  for (const [id, runtime] of runtimeMetaMap) {
    if (!map.has(id)) {
      map.set(id, {
        sourceTitles:        runtime.sourceTitles        ?? [],
        sourceNoteIds:       runtime.sourceNoteIds       ?? [],
        usedEmbeddings:      runtime.usedEmbeddings      ?? false,
        confidence:          runtime.confidence          ?? "medium",
        relatedNotes:        runtime.relatedNotes        ?? [],
        tier1Results:        runtime.tier1Results,
        excludedNoteNotices: runtime.excludedNoteNotices ?? [],
        titleMatchedNoteIds: runtime.titleMatchedNoteIds ?? [],
        webNudge:            runtime.webNudge,
        webGrounded:         runtime.webGrounded         ?? false,
      })
    }
  }
  return map
}, [persistedMeta, runtimeMetaMap])

const appWebSearch        = useAppSettings((s) => s.settings.web_search_enabled === 1)
  const { settings }        = useAppSettings()
  const autoSearch          = settings.web_search_auto_search === 1

useEffect(() => {
  if (!autoSearch || !appWebSearch) return

  const lastMsg = messages[messages.length - 1]
  if (!lastMsg || lastMsg.role !== "assistant") return
  const meta = metaMap.get(lastMsg.id)
  if (!meta || !meta.webNudge) return
  if (dismissedNudges.has(lastMsg.id)) return
  if (webResultsMap.has(lastMsg.id)) return

  const prevMsg = messages[messages.length - 2]
  const userQuery = prevMsg?.role === "user" ? prevMsg.content : ""
  if (!userQuery) return

  // Suppress auto-search for edit/intent and short declarative statements
const { intent } = detectIntent(userQuery)
if (intent === "edit" || intent === "inventory" || intent === "exploration") return
  const words = userQuery.trim().split(/\s+/)
  const QUESTION_WORDS = /\b(what|who|how|why|when|where|does|is|can|which)\b/i
  if (words.length <= 8 && !QUESTION_WORDS.test(userQuery)) return

  console.log('[autoSearch] firing auto web search for:', userQuery)
  const provider = getWebSearchProvider()
  provider.search(userQuery).then((results) => {
    console.log('[autoSearch] search results:', results.length, results[0])
    setSuppressedNudges((prev) => new Set(prev).add(lastMsg.id))
    handleWebSearch(userQuery, results)
  }).catch(console.error)
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [messages, metaMap, autoSearch, dismissedNudges, webResultsMap])

  // Keep refs in sync so handleSend always reads current values
  useEffect(() => {
    console.log('[ragScope sync] ragScope changed to:', ragScope)
    ragScopeRef.current = ragScope;
  }, [ragScope]);
  useEffect(() => { linkedNoteRef.current = linkedNoteId; }, [linkedNoteId]);

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
    if (!streamingId) return
    const t = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }, 80)
    return () => clearTimeout(t)
  }, [streamingId]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [noteId]);

  useEffect(() => {
    setPaneNote(paneId, noteId)
    setCallError(null)
    setDismissedNudges(new Set())
    setWebResultsMap(new Map())
    setSuppressedNudges(new Set())
    setRuntimeMetaMap(new Map())
  }, [noteId]);

   

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    function onScroll() {
      const distFromBottom = el!.scrollHeight - el!.scrollTop - el!.clientHeight
      setShowScrollBtn(distFromBottom > 100)
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, []);

  // M5: Reactive subscription — watch note store for linked note lifecycle events
  useEffect(() => {
    if (!linkedNoteId) return;
    return useNoteStore.subscribe((state) => {
      const linkedId = useChatSessionStore.getState().getSession(paneId).linkedNoteId;
      if (!linkedId) return;
      const { markLinkedNoteTrashed, markLinkedNoteDeleted, markLinkedNoteRestored, setLinkedNoteTitle } =
        useChatSessionStore.getState();
      const activeNote = state.notes.find((n) => n.id === linkedId);
      if (activeNote) {
        if (linkedNoteTrashed) markLinkedNoteRestored(noteId, activeNote.title);
        if (activeNote.title !== linkedNoteTitle) setLinkedNoteTitle(noteId, activeNote.title);
        return;
      }
      const trashedNote = state.trashedNotes?.find((n) => n.id === linkedId);
      if (trashedNote) { markLinkedNoteTrashed(noteId); return; }
      if (!linkedNoteDeleted) markLinkedNoteDeleted(noteId);
    });
  }, [paneId, linkedNoteId, linkedNoteTrashed, linkedNoteDeleted, linkedNoteTitle]);

  // ── Scope resolution ───────────────────────────────────────────────────────

  const resolveScopeNoteIds = useCallback(async (extraNoteIds?: string[]): Promise<string[] | undefined> => {
  console.log('[scope] ragScope:', ragScopeRef.current, 'noteId:', noteId, 'currentNote:', currentNote?.title)
  if (ragScopeRef.current === "all" && (!extraNoteIds || extraNoteIds.length === 0)) return undefined
  let base: string[] = []
  if (ragScopeRef.current === "note") {
    const descendants = await getAllDescendants(noteId)
    base = [noteId, ...descendants.map((d: { id: string }) => d.id)]
    console.log('[scope] resolved noteIds:', base)
  }
  const merged = [...new Set([...base, ...(extraNoteIds ?? [])])]
  return merged.length > 0 ? merged : undefined
}, [noteId])

  // ── M19: handleWebSearch function ─────────────────────────────────────────
async function handleDirectWebSearch() {
  const q = input.trim()
  if (!q || loading) return

  const userMsg: ChatMessage = {
    id: crypto.randomUUID(), role: "user", content: q, createdAt: Date.now(),
  }
  addMessage(noteId, userMsg)
  setInput("")
  if (inputRef.current) inputRef.current.style.height = "auto"
  setLoading(true)
  setStreamStatus("Searching…")

  try {
    const scopeNoteIds = await resolveScopeNoteIds()

    // Fire web search and note pipeline simultaneously
    const [webResults, pipeline] = await Promise.all([
      getWebSearchProvider().search(q).catch(() => [] as WebSearchResult[]),
      runPipeline(q, currentNote, scopeNoteIds, undefined, setStreamStatus),
    ])

    await handleWebSearch(q, webResults, scopeNoteIds, pipeline)
  } catch {
    setLoading(false)
    setStreamStatus(null)
  }
}

  
  async function handleWebSearch(
    userQuery:             string,
    webResults:            WebSearchResult[],
    resolvedScopeNoteIds?: string[],
    prebuiltPipeline?:     PipelineResult,
  ) {
    const assistantId = crypto.randomUUID()
    setWebResultsMap((prev) => new Map(prev).set(assistantId, webResults))
    const assistantMsg: ChatMessage = {
      id: assistantId, role: "assistant", content: "", createdAt: Date.now(),
    }

    addMessage(noteId, assistantMsg)
    await saveSession(noteId)
    setLoading(true)
    setStreamingId(assistantId)
    setCallError(null)
    setStreamStatus(prebuiltPipeline ? "Generating answer…" : "Searching the web…")

    const scopeNoteIds = resolvedScopeNoteIds ?? await resolveScopeNoteIds()

    try {
      const meta = await streamChatWithNotes(
        userQuery,
        notes,
        noteId,
        currentNote,
        scopeNoteIds,
        {
          onChunk: (token) => {
            const current  = useChatSessionStore.getState().getSessionByNoteId(noteId)
            const existing = current.messages.find(m => m.id === assistantId)
            setMessageContent(noteId, assistantId, (existing?.content ?? "") + token)
            setStreamStatus(null)
          },
          onDone:  () => { setStreamStatus(null); setStreamingId(null); setLoading(false) },
          onError: (err) => { setStreamStatus(null); setStreamingId(null); setLoading(false); setCallError(err) },
          onStatus: (msg) => setStreamStatus(msg),
        },
        undefined,
        webResults,
        prebuiltPipeline,
        messages.slice(0, -2),
      )

      // Persist the durable subset
      const pm: PersistedMeta = {
        messageId:      assistantId,
        confidence:     meta.confidence,
        citations:      meta.sourceTitles.map((title, i) => ({
          noteId:       meta.sourceNoteIds[i],
          title,
          isTitleMatch: meta.titleMatchedNoteIds?.includes(meta.sourceNoteIds[i]),
        })),
        usedWeb:        meta.webNudge !== undefined,
        usedEmbeddings: meta.usedEmbeddings,
      }
      setPersistedMeta(noteId, assistantId, pm)
      await saveSession(noteId)

      // Keep runtime-only fields in local state
      setRuntimeMetaMap((prev) => new Map(prev).set(assistantId, {
        sourceTitles:        meta.sourceTitles,
        sourceNoteIds:       meta.sourceNoteIds,
        relatedNotes:        meta.relatedNotes,
        tier1Results:        meta.tier1Results,
        excludedNoteNotices: meta.excludedNoteNotices,
        titleMatchedNoteIds: meta.titleMatchedNoteIds,
        webNudge:            meta.webNudge,
      }))
    } catch { /* errors handled by onError above */ }
  }

  // ── Send ───────────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    console.log('[handleSend] ragScopeRef:', ragScopeRef.current, 'ragScope:', ragScope)
    const q = input.trim();
    if (!q || loading || isFreeTier) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(), role: "user", content: q, createdAt: Date.now(),
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId, role: "assistant", content: "", createdAt: Date.now(),
    };

    addMessage(noteId, userMsg);
    addMessage(noteId, assistantMsg);
    await saveSession(noteId);
    setInput("");
    setInput("")
    if (inputRef.current) {
      inputRef.current.style.height = "auto"
    }
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
            const current = useChatSessionStore.getState().getSessionByNoteId(noteId)
            const existing = current.messages.find(m => m.id === assistantId)
            setMessageContent(noteId, assistantId, (existing?.content ?? "") + token)
            setStreamStatus(null)
          },
          onDone: () => {
            setStreamStatus(null)
            setStreamingId(null)
            setLoading(false)
          },
          onError: (err: AICallError) => {
            errorHandled = true
            setStreamStatus(null)
            useChatSessionStore.setState((s) => {
              const sess = s.sessions[noteId]
              if (!sess) return s
              return { sessions: { ...s.sessions, [noteId]: { ...sess, messages: sess.messages.filter(m => m.id !== assistantId) } } }
            })
            if (err.code === "AUTH_FAILED" || err.code === "QUOTA_EXCEEDED") {
              setProviderStatus(primarySlot.provider, "error", err.message)
            }
            setCallError(err)
            setStreamingId(null)
            setLoading(false)
          },
          onStatus: (msg) => setStreamStatus(msg),
        },
        undefined,   // overrideNoteIds
        undefined,   // webResults
        undefined,   // prebuiltPipeline
        messages.slice(0, -2),    // sessionMessages
      )

      // Persist the durable subset
      const pm: PersistedMeta = {
        messageId:      assistantId,
        confidence:     meta.confidence,
        citations:      meta.sourceTitles.map((title, i) => ({
          noteId:       meta.sourceNoteIds[i],
          title,
          isTitleMatch: meta.titleMatchedNoteIds?.includes(meta.sourceNoteIds[i]),
        })),
        usedWeb:        meta.webNudge !== undefined,
        usedEmbeddings: meta.usedEmbeddings,
      }
      setPersistedMeta(noteId, assistantId, pm)
      await saveSession(noteId)

      // Keep runtime-only fields in local state
      setRuntimeMetaMap((prev) => new Map(prev).set(assistantId, {
        sourceTitles:        meta.sourceTitles,
        sourceNoteIds:       meta.sourceNoteIds,
        relatedNotes:        meta.relatedNotes,
        tier1Results:        meta.tier1Results,
        excludedNoteNotices: meta.excludedNoteNotices,
        titleMatchedNoteIds: meta.titleMatchedNoteIds,
        webNudge:            meta.webNudge,
      }))
    } catch (rawErr) {
      if (!errorHandled) {
        // roll back the assistant placeholder
            useChatSessionStore.setState((s) => {
              const sess = s.sessions[noteId]
              if (!sess) return s
              return { sessions: { ...s.sessions, [noteId]: { ...sess, messages: sess.messages.filter(m => m.id !== assistantId) } } }
            })
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
  }, [input, loading, isFreeTier, notes, noteId, currentNote, primarySlot, setProviderStatus, resolveScopeNoteIds]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  async function handleClear() {
    setCallError(null)
    setOneTimeInclusions(new Set())
    setDismissedNudges(new Set())
    setWebResultsMap(new Map())
    setSuppressedNudges(new Set())
    setRuntimeMetaMap(new Map())
    await clearSession(noteId)
    await Promise.all([clearAIHistory(noteId), clearConversationSummary(noteId)])
  }

  function handleStop() {
  abortRef.current?.abort()
  abortRef.current = null
  setStreamingId(null)
  setLoading(false)
}

  const handleRetry = useCallback(async () => {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")
  const lastUser      = [...messages].reverse().find((m) => m.role === "user")
  if (!lastAssistant || !lastUser) return

  setCallError(null)
  setLoading(true)
  setStreamingId(lastAssistant.id)
  setMessageContent(noteId, lastAssistant.id, "")

  const scopeNoteIds = await resolveScopeNoteIds()

  try {
    const meta = await streamChatWithNotes(
      lastUser.content,
      notes,
      noteId,
      currentNote,
      scopeNoteIds,
      {
        onChunk: (token) => {
          const current  = useChatSessionStore.getState().getSessionByNoteId(noteId)
          const existing = current.messages.find((m) => m.id === lastAssistant.id)
          setMessageContent(noteId, lastAssistant.id, (existing?.content ?? "") + token)
          setStreamStatus(null)
        },
        onDone:  () => { setStreamStatus(null); setStreamingId(null); setLoading(false) },
        onError: (err) => { setStreamStatus(null); setStreamingId(null); setLoading(false); setCallError(err) },
        onStatus: (msg) => setStreamStatus(msg),
      },
      undefined,   // overrideNoteIds
      undefined,   // webResults
      undefined,   // prebuiltPipeline
      messages.slice(0, -2),    // sessionMessages
    )

    const pm: PersistedMeta = {
      messageId:      lastAssistant.id,
      confidence:     meta.confidence,
      citations:      meta.sourceTitles.map((title, i) => ({
        noteId:       meta.sourceNoteIds[i],
        title,
        isTitleMatch: meta.titleMatchedNoteIds?.includes(meta.sourceNoteIds[i]),
      })),
      usedWeb:        meta.webNudge !== undefined,
      usedEmbeddings: meta.usedEmbeddings,
    }
    setPersistedMeta(noteId, lastAssistant.id, pm)
    await saveSession(noteId)

    setRuntimeMetaMap((prev) => new Map(prev).set(lastAssistant.id, {
      sourceTitles:        meta.sourceTitles,
      sourceNoteIds:       meta.sourceNoteIds,
      relatedNotes:        meta.relatedNotes,
      tier1Results:        meta.tier1Results,
      excludedNoteNotices: meta.excludedNoteNotices,
      titleMatchedNoteIds: meta.titleMatchedNoteIds,
      webNudge:            meta.webNudge,
    }))
  } catch { /* handled by onError */ }
}, [messages, notes, noteId, currentNote, resolveScopeNoteIds, setMessageContent, setPersistedMeta, saveSession])

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
  addMessage(noteId, assistantMsg);
  await saveSession(noteId);
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
          const current = useChatSessionStore.getState().getSessionByNoteId(noteId)
          const existing = current.messages.find(m => m.id === assistantId)
          setMessageContent(noteId, assistantId, (existing?.content ?? "") + token)
          setStreamStatus(null)
        },
        onDone:  () => { setStreamStatus(null); setStreamingId(null); setLoading(false) },
        onError: (err) => { setStreamStatus(null); setStreamingId(null); setLoading(false); setCallError(err) },
        onStatus: (msg) => setStreamStatus(msg),
      },
      allInclusions,  // overrideNoteIds
      undefined,      // webResults
      undefined,      // prebuiltPipeline
      messages.slice(0, -1),  // sessionMessages
    )
    // Persist the durable subset
    const pm: PersistedMeta = {
      messageId:      assistantId,
      confidence:     meta.confidence,
      citations:      meta.sourceTitles.map((title, i) => ({
        noteId:       meta.sourceNoteIds[i],
        title,
        isTitleMatch: meta.titleMatchedNoteIds?.includes(meta.sourceNoteIds[i]),
      })),
      usedWeb:        meta.webNudge !== undefined,
      usedEmbeddings: meta.usedEmbeddings,
    }
    setPersistedMeta(noteId, assistantId, pm)
    await saveSession(noteId)

    // Keep runtime-only fields in local state
    setRuntimeMetaMap((prev) => new Map(prev).set(assistantId, {
      sourceTitles:        meta.sourceTitles,
      sourceNoteIds:       meta.sourceNoteIds,
      relatedNotes:        meta.relatedNotes,
      tier1Results:        meta.tier1Results,
      excludedNoteNotices: meta.excludedNoteNotices,
      titleMatchedNoteIds: meta.titleMatchedNoteIds,
      webNudge:            meta.webNudge,
    }))
  } catch { /* errors handled by onError above */ }
}, [messages, notes, noteId, currentNote, oneTimeInclusions]);

  function handleScopeToggle() {
  if (ragScope === "note") {
    setRagScope(noteId, "all");
  } else {
    setRagScope(noteId, "note");
  }
}

  const hasNoEmbeddingMessage = [...metaMap.values()].some((m) => !m.usedEmbeddings);

  useEffect(() => {
  setEmbeddingWarningDismissed(false);
}, [messages.length]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
<div className="flex flex-col h-full w-[480px] shrink-0 border-l border-idemora-border bg-idemora-bg-primary">
      {/* ── Header ── */}
<div className="flex items-center justify-between px-3 py-1.5 shrink-0 border-b border-idemora-border/60">
        <div className="flex items-center min-w-0">
          {isFreeTier && (
            <span className="text-sm font-medium text-idemora-text-muted truncate">
              Ask your notes
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {messages.length > 0 && (
            <>
              <button
                onClick={() => {
                  setSelectedMessage(null)
                  setSaveDialogOpen(true)
                }}
                title="Save conversation to note"
                className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100"
              >
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <rect x="2" y="2" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.3"/>
                  <rect x="4.5" y="2" width="6" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.1"/>
                  <rect x="4" y="8.5" width="7" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                </svg>
              </button>
              <button
                onClick={handleClear}
                title="Clear conversation"
                className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100"
              >
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <path d="M2.5 4.5h10M6 4.5V3.5h3v1M6.5 7v4M8.5 7v4M3.5 4.5l.7 8h6.6l.7-8"
                    stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </>
          )}
          <button
            onClick={() => closeChat(paneId)}
            title="Close chat"
            className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M2.5 2.5l10 10M12.5 2.5l-10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Indexing paused banner ── */}
      {indexingPaused && (
        <div className="mx-3 mt-2 px-3 py-1.5 rounded-lg bg-amber-50/40 border border-amber-100 flex items-center gap-2 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
          <p className="text-[10px] text-amber-600">Indexing paused — embedding quota reached</p>
        </div>
      )}

      {/* ── Body ── */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto relative">
        {isFreeTier ? (
          <FreeTierState />
        ) : isLoading ? (
          <div className="py-6 px-4 space-y-3 animate-pulse">
            {[1,2,3].map(i => (
              <div key={i} className="h-3 rounded bg-idemora-border" style={{ width: `${60 + i * 10}%` }} />
            ))}
          </div>
        ) : messages.length === 0 && !callError ? (
          <EmptyState currentNoteTitle={currentNote?.title} onSuggest={(text) => { setInput(text); inputRef.current?.focus(); }} />
        ) : (
          <div className="py-3 space-y-1">
            {allExhausted && (
              <QuotaExhaustedCard onRetry={() => { setAllExhausted(false); handleSend(); }} />
            )}
            {hasNoEmbeddingMessage && messages.length > 0 && !embeddingWarningDismissed && (
              <div className="mx-3 mb-1 px-3 py-2 rounded-lg bg-amber-50/40 border border-amber-100 flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="text-amber-400 shrink-0 mt-0.5">
                    <path d="M5.5 1L10 9.5H1L5.5 1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                    <path d="M5.5 4.5v2M5.5 8v.1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                  <p className="text-[10px] text-amber-600 leading-relaxed">
                    Running keyword search only — enable an embedding provider in{" "}
                    <span className="font-medium">Settings → AI</span> for better results.
                  </p>
                </div>
                <button
                  onClick={() => setEmbeddingWarningDismissed(true)}
                  className="text-amber-300 hover:text-amber-500 transition-colors duration-75 shrink-0 mt-0.5"
                >
                  <svg width="8" height="8" viewBox="0 0 9 9" fill="none">
                    <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            )}
            {messages.map((msg, idx) => {
  const meta        = metaMap.get(msg.id)
  const isStreaming = msg.id === streamingId
  const isLatest    = idx === messages.length - 1
  const prevMsg     = idx > 0 ? messages[idx - 1] : null
 
  return (
    <div key={msg.id} className="group/msg relative">
      <MessageBubble
        message={msg}
        isStreaming={isStreaming}
        isLatest={isLatest}
        streamStatus={isStreaming ? streamStatus : null}
        onCopy={(content) => {
          const plain = content.replace(/\[web:[^\]]+\]/g, "").replace(/\[\d+\]/g, "").trim()
          navigator.clipboard.writeText(plain).catch(console.error)
          addToast("Copied")
        }}
        onEdit={msg.role === "user" ? (content) => setInput(content) : undefined}
      />
 
      {/* Source footer — unchanged */}
      {msg.role === "assistant" && meta && !isStreaming && (
        <MessageFooter
          meta={meta}
          onOpenNote={handleOpenNote}
          onOneTimeInclusion={handleOneTimeInclusion}
          webSources={webResultsMap.get(msg.id)}
          onCopy={() => {
            const plain = msg.content.replace(/\[web:[^\]]+\]/g, "").replace(/\[\d+\]/g, "").trim()
            navigator.clipboard.writeText(plain).catch(console.error)
            addToast("Copied")
          }}
          onSave={!isFreeTier ? (() => {
            const prevMsg = idx > 0 ? messages[idx - 1] : null
            const userMsg = prevMsg?.role === "user" ? prevMsg : null
            setSelectedMessage(userMsg ? {
              user:      { role: "user",      content: userMsg.content },
              assistant: { role: "assistant", content: msg.content },
            } : null)
            setSaveDialogOpen(true)
          }) : undefined}
          onRetry={isLatest && (!!callError || msg.content === "") ? handleRetry : undefined}
          isLatest={isLatest}
          createdAt={msg.createdAt}

        />
      )}
 
      {/* Web nudge — unchanged */}
      {msg.role === "assistant" && meta && !isStreaming && meta.webNudge &&
       !dismissedNudges.has(msg.id) && !suppressedNudges.has(msg.id) && (
        <WebNudge
          messageId={msg.id}
          nudge={meta.webNudge}
          query={prevMsg?.role === "user" ? prevMsg.content : ""}
          onSearchComplete={(id, results) => {
            setSuppressedNudges((prev) => new Set(prev).add(id))
            const userQuery = prevMsg?.role === "user" ? prevMsg.content : ""
            if (userQuery) handleWebSearch(userQuery, results)
          }}
          onDismiss={(id) => {
            setDismissedNudges((prev) => new Set(prev).add(id))
          }}
        />
      )}
 
      {/* ── OLD standalone save row removed — now inside MessageBubble ── */}
    </div>
  )
})}
            {callError && !allExhausted && (
              <div className="mx-3 mt-1">
                <ErrorCard error={callError} onDismiss={() => setCallError(null)} />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      {showScrollBtn && (
<div className="sticky bottom-3 flex justify-center pointer-events-none">
          <button
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
            className="pointer-events-auto w-8 h-8 flex items-center justify-center rounded-full bg-idemora-bg-secondary border border-idemora-border/60 text-idemora-text-muted hover:text-idemora-text-normal hover:border-idemora-border shadow-sm transition-all duration-150 cursor-pointer"
            title="Scroll to bottom"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 2v9M3 8l3.5 3.5L10 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      )}
      </div>

      {/* ── Input area ── */}
{!isFreeTier && (
  <div className="shrink-0 px-3 pt-2 pb-3">
    <div className="rounded-2xl border border-idemora-border/60 bg-idemora-bg-secondary transition-all duration-150 focus-within:border-violet-500/30 focus-within:shadow-[0_0_0_1px_rgba(139,92,246,0.15)]">

      {/* Textarea */}
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything about your notes…"
        rows={1}
        className="w-full resize-none px-3 pt-3 pb-1 text-sm bg-transparent text-idemora-text-normal placeholder-idemora-text-muted/50 focus:outline-none leading-relaxed"
        style={{ height: "auto", minHeight: "38px", maxHeight: "128px" }}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = Math.min(el.scrollHeight, 128) + "px";
        }}
      />

      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-2.5 pb-2 pt-1">

        {/* Left — context controls */}
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
          <button
            onClick={handleScopeToggle}
            title={
              ragScope === "note"
                ? `Scoped to "${currentNote?.title ?? "this note"}" — click to search all notes`
                : `Searching all notes — click to scope to "${currentNote?.title ?? "this note"}"`
            }
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-all duration-150 shrink-0 ${
              ragScope === "note"
                ? "text-violet-400 border-violet-400/40 bg-violet-500/10 hover:bg-violet-500/20"
                : "text-idemora-text-muted border-idemora-border/60 hover:text-violet-400 hover:border-violet-400/40"
            }`}
          >
            <svg width="10" height="10" viewBox="0 0 9 9" fill="none" className="shrink-0" aria-hidden="true">
              {ragScope === "note" ? (
                <><circle cx="4.5" cy="4.5" r="3.5" stroke="currentColor" strokeWidth="1"/><path d="M4.5 2.5v4M2.5 4.5h4" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/></>
              ) : (
                <><rect x="1" y="1" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1"/><path d="M2.5 3h4M2.5 4.5h4M2.5 6h2.5" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/></>
              )}
            </svg>
            {ragScope === "note" && currentNote?.title
              ? `${currentNote.title.slice(0, 16)}${currentNote.title.length > 16 ? "…" : ""}`
              : "All notes"}
          </button>

          {linkedNoteId && !linkedNoteDeleted && (
            <button
              onClick={() => {
                if (linkedNoteId) {
                  if (paneId === 2) openTabInPane2(linkedNoteId);
                  else openTab(linkedNoteId);
                }
              }}
              title={`Saves going to "${linkedNoteTitle ?? "note"}"`}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-violet-400 border border-violet-400/40 bg-violet-500/10 hover:bg-violet-500/20 transition-all duration-150 min-w-0 max-w-[120px]"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0" aria-hidden="true">
                <rect x="1" y="1" width="6" height="6" rx="0.8" stroke="currentColor" strokeWidth="1"/>
                <path d="M2.5 3h3M2.5 5h2" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
              </svg>
              <span className="truncate">{linkedNoteTitle ?? "Saved"}</span>
              <svg width="7" height="7" viewBox="0 0 7 7" fill="none" className="shrink-0 opacity-60" aria-hidden="true">
                <path d="M1.5 5.5L5.5 1.5M5.5 1.5H2.5M5.5 1.5V4.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}

          {linkedNoteTrashed && (
            <span className="text-[10px] text-amber-500 shrink-0">Linked note in trash</span>
          )}
          {linkedNoteDeleted && (
            <span className="text-[10px] text-idemora-text-muted shrink-0">Note deleted</span>
          )}
        </div>

        {/* Right — execution controls */}
        <div className="flex items-center gap-1 shrink-0">

          {/* Web search */}
          <button
            onClick={handleDirectWebSearch}
            disabled={!input.trim() || loading}
            title="Search the web directly"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-idemora-text-muted hover:text-sky-400 hover:bg-white/[0.04] border border-idemora-border/60 hover:border-sky-400/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M6 1.5C5 3 4.5 4.5 4.5 6s.5 3 1.5 4.5M6 1.5C7 3 7.5 4.5 7.5 6S7 9 6 10.5M1.5 6h9" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            </svg>
          </button>

          {/* Model picker */}
          <QuickSwitch />

          {/* Send / Stop */}
          <button
            onClick={loading ? handleStop : handleSend}
            disabled={!loading && !input.trim()}
            title={loading ? "Stop" : "Send (Enter)"}
            className={`w-7 h-7 flex items-center justify-center rounded-lg text-white transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed ${
              loading ? "bg-violet-600 hover:bg-violet-700" : "bg-violet-500 hover:bg-violet-400"
            }`}
          >
            {loading ? (
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <circle cx="6" cy="6" r="5.5" stroke="currentColor" strokeWidth="1"/>
                <rect x="3.5" y="3.5" width="5" height="5" rx="0.8" fill="currentColor"/>
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
      </div>
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
            const isFirstSave = !linkedNoteId;
            setLinkedNote(noteId, savedNoteId, savedNoteTitle);
            stampSavedAt(noteId);
            if (isFirstSave) {
              setRagScope(noteId, "note");
              addToast("Search scoped to this note and sub-notes — change anytime above");
            }
          }}
        />
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}



function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)

  const highlighted = useMemo(() => {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language }).value
    }
    return hljs.highlightAuto(code).value
  }, [code, language])

  function handleCopy() {
    navigator.clipboard.writeText(code).catch(console.error)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-1.5 rounded-lg overflow-hidden border border-idemora-border/60">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-idemora-bg-secondary border-b border-idemora-border/40 sticky top-0 z-10">
        <span className="text-[10px] font-medium text-idemora-text-muted uppercase tracking-wider">
          {language ?? "code"}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-100"
        >
          {copied ? (
            <>
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                <rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                <path d="M2 7H1.5A.5.5 0 011 6.5v-5A.5.5 0 011.5 1h5a.5.5 0 01.5.5V2" stroke="currentColor" strokeWidth="1.1"/>
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
      {/* Code body */}
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed bg-[#22272e] dark:bg-[#22272e] bg-[#f6f8fa] dark:text-white m-0">
        <code
          dangerouslySetInnerHTML={{ __html: highlighted }}
          className="font-mono"
        />
      </pre>
    </div>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  message, isStreaming, isLatest, onCopy, onEdit, streamStatus,
}: {
  message:       ChatMessage
  isStreaming:   boolean
  isLatest:      boolean
  onCopy:        (content: string) => void
  onEdit?:       (content: string) => void
  streamStatus?: string | null
}) {
  const isUser = message.role === "user"

  function renderWithCitations(text: string) {
const cleaned = text
  .replace(/\[web:[^\]]+\]/g, "")
  .replace(/ \./g, ".")

  // Custom marked renderer for code blocks and tables
  const renderer = new marked.Renderer()

  // Code blocks → collect for React rendering
  const codeBlocks: Array<{ id: string; code: string; language?: string }> = []
  renderer.code = ({ text: code, lang }) => {
    const id = `cb-${crypto.randomUUID()}`
    codeBlocks.push({ id, code, language: lang || undefined })
    return `<code-block id="${id}"></code-block>`
  }

  // Tables → wrap in scroll container
  renderer.table = ({ header, rows }) => {
    const headerHtml = `<thead><tr>${header.map(h =>
      `<th>${marked.parseInline(h.text, { async: false }) as string}</th>`
    ).join("")}</tr></thead>`
    const bodyHtml = `<tbody>${rows.map(row =>
      `<tr>${row.map(cell =>
        `<td>${marked.parseInline(cell.text, { async: false }) as string}</td>`
      ).join("")}</tr>`
    ).join("")}</tbody>`
    return `<div class="table-wrap"><table>${headerHtml}${bodyHtml}</table></div>`
  }

  const html = marked.parse(cleaned, { async: false, renderer }) as string

  // Split on citations AND code-block placeholders
  const stripped = html.replace(/\[\d+(?:,\s*\d+)*\]/g, "")
  const parts = stripped.split(/(<code-block id="[^"]+"><\/code-block>)/g)

  return (
    <div className="text-sm text-idemora-text-normal
  [&_strong]:font-semibold [&_strong]:text-idemora-text-normal
  [&_em]:italic
  [&_p]:my-2 [&_p]:leading-relaxed [&_p]:first:mt-0 [&_p]:last:mb-0
  [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:ml-4 [&_ul]:mt-1.5 [&_ul]:mb-1.5
  [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:ml-4 [&_ol]:mt-1.5 [&_ol]:mb-1.5
  [&_li]:my-1 [&_li]:leading-relaxed
  [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-1 [&_h1]:text-idemora-text-normal [&_h1]:leading-snug
  [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-0.5 [&_h2]:text-idemora-text-normal [&_h2]:border-b [&_h2]:border-idemora-border/40 [&_h2]:pb-0.5
  [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-0.5 [&_h3]:text-idemora-text-normal
  [&_blockquote]:text-idemora-text-muted [&_blockquote]:border-l-2 
  [&_blockquote]:border-violet-400/50 [&_blockquote]:pl-3 [&_blockquote]:py-1.5 [&_blockquote]:my-2 [&_blockquote]:bg-idemora-bg-secondary 
  [&_blockquote]:rounded-r-md [&_blockquote]:pr-3
  [&_hr]:border-none [&_hr]:border-t [&_hr]:border-idemora-border/40 [&_hr]:my-3
  [&_code]:text-violet-400 [&_code]:bg-idemora-bg-secondary [&_code]:rounded [&_code]:px-1 [&_code]:text-xs
  [&_.table-wrap]:overflow-x-auto [&_.table-wrap]:my-2
  [&_table]:w-full [&_table]:text-xs [&_table]:border-collapse [&_table]:border [&_table]:border-idemora-border/60
  [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-idemora-text-normal [&_th]:bg-idemora-bg-secondary [&_th]:border [&_th]:border-idemora-border/60
  [&_td]:px-3 [&_td]:py-2 [&_td]:text-idemora-text-muted [&_td]:border [&_td]:border-idemora-border/60">
      {parts.map((part, i) => {
       
        // Code block placeholder
        const cbMatch = part.match(/^<code-block id="([^"]+)"><\/code-block>$/)
        if (cbMatch) {
          const block = codeBlocks.find((b) => b.id === cbMatch[1])
          if (block) return <CodeBlock key={i} code={block.code} language={block.language} />
        }
        // Regular HTML
        return <span key={i} dangerouslySetInnerHTML={{ __html: part }} />
      })}
    </div>
  )
}

const [copied, setCopied] = useState(false)

   


  // ── User bubble ────────────────────────────────────────────────────────────
  if (isUser) {
    return (
      <div className="px-4 py-1.5 flex justify-end">
        <div className="flex flex-col items-end gap-0.5 max-w-[85%]">
  <div className="w-full px-3 py-2 rounded-2xl bg-violet-500 text-white text-sm leading-relaxed">
    {message.content}
  </div>
  <div className={`flex items-center gap-0.5 transition-opacity duration-150 ${
    isLatest ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100"
  }`}>
<span className="text-[10px] text-idemora-text-faint mr-1 select-none">
  {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
</span>
{/* Copy */}
<button
  onClick={() => { onCopy(message.content); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
  title={copied ? "Copied!" : "Copy"}
  className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors duration-100"
>
              {copied ? (
                <svg width="15" height="15" viewBox="0 0 10 10" fill="none">
                  <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 10 10" fill="none">
                  <rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                  <path d="M2 7H1.5A.5.5 0 011 6.5v-5A.5.5 0 011.5 1h5a.5.5 0 01.5.5V2" stroke="currentColor" strokeWidth="1.1"/>
                </svg>
              )}
            </button>
            {/* Edit */}
            {onEdit && (
              <button
                onClick={() => onEdit(message.content)}
                title="Edit and resend"
                className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors duration-100"
              >
                <svg width="15" height="15" viewBox="0 0 10 10" fill="none">
                  <path d="M6.5 1.5l2 2L3 9H1V7L6.5 1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M5.5 2.5l2 2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Assistant bubble ───────────────────────────────────────────────────────
  return (
    <div className="px-4 py-1.5">
      <div className="space-y-1">

        {/* Typing indicator */}
        {isStreaming && message.content === "" && (
          <div className="flex items-center gap-2.5 py-2">
            <div className="flex items-center gap-1 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:300ms]" />
            </div>
            <span className="text-sm text-idemora-text-normal/70">
              {streamStatus ?? "Thinking…"}
            </span>
          </div>
        )}

        {/* Content */}
        {message.content !== "" && (
          <div className="text-sm text-idemora-text-normal leading-relaxed">
            {renderWithCitations(message.content)}
            {isStreaming && (
              <span className="inline-block w-0.5 h-3.5 bg-violet-400 ml-0.5 align-middle animate-pulse" />
            )}
          </div>
        )}

        
      </div>
    </div>
  )
}

// ─── Message footer ───────────────────────────────────────────────────────────

function formatWebUrl(url: string, title: string): string {
  try {
    const u = new URL(url)
    const domain = u.hostname.replace(/^www\./, "")
    const shortTitle = title.length > 35 ? title.slice(0, 35) + "…" : title
    return `${domain} · ${shortTitle}`
  } catch {
    return title
  }
}

function WebSourceChips({ sources }: { sources: WebSearchResult[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? sources : sources.slice(0, 1)

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((source, i) => (
        <button
          key={i}
          onClick={() => window.open(source.url, "_blank", "noreferrer")}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] bg-sky-500/8 text-sky-400 border border-sky-400/20 hover:bg-sky-500/15 hover:border-sky-400/40 transition-all duration-100 max-w-[16rem]"
          title={source.url}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0">
            <circle cx="4" cy="4" r="3" stroke="currentColor" strokeWidth="0.9"/>
            <path d="M4 1.5C3.5 2.5 3.2 3.2 3.2 4s.3 1.5.8 2.5M4 1.5C4.5 2.5 4.8 3.2 4.8 4s-.3 1.5-.8 2.5M1.5 4h5"
              stroke="currentColor" strokeWidth="0.7" strokeLinecap="round"/>
          </svg>
          <span className="truncate">{formatWebUrl(source.url, source.title)}</span>
          <svg width="6" height="6" viewBox="0 0 7 7" fill="none" className="shrink-0 opacity-50">
            <path d="M1.5 5.5L5.5 1.5M5.5 1.5H2.5M5.5 1.5V4.5"
              stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      ))}
      {sources.length > 1 && (
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] text-idemora-text-muted border border-idemora-border/60 hover:text-sky-400 hover:border-sky-400/30 transition-all duration-100"
        >
          {expanded ? "show less" : `+${sources.length - 1} more`}
        </button>
      )}
    </div>
  )
}

function NoteSourceChips({
  titles, noteIds, titleMatchedNoteIds, onOpenNote,
}: {
  titles:               string[];
  noteIds:              string[];
  titleMatchedNoteIds?: string[];
  onOpenNote:           (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? titles : titles.slice(0, 2)

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((title, i) => {
        const isTitleMatch = titleMatchedNoteIds?.includes(noteIds[i])
        return (
          <button
            key={noteIds[i]}
            onClick={() => onOpenNote(noteIds[i])}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] transition-all duration-100 max-w-[11rem] border ${
              isTitleMatch
                ? "bg-violet-500/10 text-violet-400 border-violet-400/30 hover:bg-violet-500/20"
                : "text-idemora-text-muted border-idemora-border/50 hover:text-violet-400 hover:border-violet-400/30 hover:bg-violet-500/5"
            }`}
            title={`Open note: ${title}`}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0">
              <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1"/>
              <path d="M2.5 3h3M2.5 5h2" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
            </svg>
            <span className="truncate">[{i + 1}] {title}</span>
          </button>
        )
      })}
      {titles.length > 2 && (
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] text-idemora-text-muted border border-idemora-border/60 hover:text-violet-400 hover:border-violet-400/30 transition-all duration-100"
        >
          {expanded ? "show less" : `+${titles.length - 2} more`}
        </button>
      )}
    </div>
  )
}

function MessageFooter({
  meta, onOpenNote, onOneTimeInclusion, webSources, onCopy, onSave, onRetry, isLatest, createdAt,
}: {
  meta:                MessageMeta;
  onOpenNote:          (id: string) => void;
  onOneTimeInclusion:  (noteId: string) => void;
  webSources?:         WebSearchResult[];
  onCopy:              () => void;
  onSave?:             () => void;
  onRetry?:            () => void;
  isLatest:            boolean;
  createdAt:           number;
}) {
  const [relatedExpanded, setRelatedExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  if (meta.tier1Results && meta.tier1Results.length > 0) {
    return <Tier1ResultCards cards={meta.tier1Results} onOpenNote={onOpenNote} />;
  }

  const hasNoteSources = meta.sourceTitles.length > 0 && !(meta.webNudge && meta.confidence === "low")
  const hasWebSources  = webSources && webSources.length > 0
  const hasRelated     = meta.relatedNotes.length > 0 && meta.confidence !== "low"
  const hasExcluded    = meta.excludedNoteNotices && meta.excludedNoteNotices.length > 0

  return (
    <div className="px-4 pb-3 space-y-2">

      {/* Low confidence warning */}
      {meta.confidence === "low" && !meta.webGrounded && (
        <div className="flex items-center gap-1.5">
          <svg width="9" height="9" viewBox="0 0 8 8" fill="none" className="text-amber-400 shrink-0">
            <path d="M4 1L7 7H1L4 1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
            <path d="M4 3.5v2M4 6v.1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          </svg>
          <p className="text-[10px] text-amber-500">Limited matches — answer may be incomplete</p>
        </div>
      )}

      {/* Web sources */}
      {hasWebSources && (
        <WebSourceChips sources={webSources!.slice(0, 6)} />
      )}

      {/* Divider between web and note sources when both present */}
      {hasWebSources && hasNoteSources && (
        <div className="border-t border-idemora-border/30" />
      )}

      {/* Note source chips — 2 visible, rest folded */}
      {hasNoteSources && (
        <NoteSourceChips
          titles={meta.sourceTitles}
          noteIds={meta.sourceNoteIds}
          titleMatchedNoteIds={meta.titleMatchedNoteIds}
          onOpenNote={onOpenNote}
        />
      )}

      {/* Excluded note notices */}
      {hasExcluded && (
        <div className="pl-2 border-l border-idemora-border/40 space-y-1">
          {meta.excludedNoteNotices!.map((n) => (
            <p key={n.note_id} className="text-[10px] text-idemora-text-muted/70 leading-relaxed">
              <span className="font-medium">"{n.note_title}"</span> may be relevant but excluded.{" "}
              <button onClick={() => onOneTimeInclusion(n.note_id)} className="text-violet-400 hover:underline">
                Include it?
              </button>
            </p>
          ))}
        </div>
      )}

      {/* Related notes — collapsed by default */}
      {hasRelated && (
        <div>
          <button
            onClick={() => setRelatedExpanded((prev) => !prev)}
            className="flex items-center gap-1 text-[10px] text-idemora-text-muted/60 hover:text-idemora-text-muted transition-colors duration-100 mb-1"
          >
            <svg
              width="8" height="8" viewBox="0 0 8 8" fill="none"
              className={`shrink-0 transition-transform duration-150 ${relatedExpanded ? "rotate-90" : ""}`}
            >
              <path d="M2.5 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {relatedExpanded ? "hide related" : `${meta.relatedNotes.length} related`}
          </button>
          {relatedExpanded && (
            <div className="flex flex-wrap gap-1">
              {meta.relatedNotes.map((note) => (
                <button
                  key={note.noteId}
                  onClick={() => onOpenNote(note.noteId)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-idemora-text-muted border border-idemora-border/50 hover:text-violet-400 hover:border-violet-400/30 hover:bg-violet-500/5 transition-all duration-100 max-w-[11rem]"
                  title={note.title}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0">
                    <path d="M1 4h6M4 1l3 3-3 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="truncate">{note.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action row — icon only */}
<div className={`flex items-center gap-0.5 pt-1 border-t border-idemora-border/20 transition-opacity duration-150 ${
  isLatest ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100"
}`}>
  <span className="text-[10px] text-idemora-text-faint mr-1 select-none">
    {new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
  </span>
  <button
    onClick={() => { onCopy(); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
          title={copied ? "Copied!" : "Copy"}
          className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors duration-100"
        >
          {copied ? (
            <svg width="15" height="15" viewBox="0 0 10 10" fill="none">
              <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 10 10" fill="none">
              <rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.1"/>
              <path d="M2 7H1.5A.5.5 0 011 6.5v-5A.5.5 0 011.5 1h5a.5.5 0 01.5.5V2" stroke="currentColor" strokeWidth="1.1"/>
            </svg>
          )}
        </button>
        {onSave && (
          <button
            onClick={onSave}
            title="Save to note"
            className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-violet-400 hover:bg-violet-500/5 transition-colors duration-100"
          >
            <svg width="15" height="15" viewBox="0 0 9 9" fill="none">
              <path d="M1.5 6.5V8h6V6.5M4.5 1v5M2.5 4l2 2 2-2"
                stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        {onRetry && (
          <button
            onClick={onRetry}
            title="Retry"
            className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors duration-100"
          >
            <svg width="15" height="15" viewBox="0 0 10 10" fill="none">
              <path d="M1.5 5a3.5 3.5 0 103.5-3.5c-1 0-1.9.4-2.5 1L1 1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M1 1v2.5h2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>

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

function EmptyState({ currentNoteTitle, onSuggest }: { currentNoteTitle?: string; onSuggest: (text: string) => void }) {
  const suggestions = [
    "What do I know about this topic?",
    "Summarize the key themes across my notes",
    currentNoteTitle ? "How does this relate to my other notes?" : "What connections exist between my notes?",
    "What gaps exist in my understanding?",
  ];

  return (
    <div className="flex flex-col px-5 py-6 gap-5">

      {/* Heading block */}
      <div className="space-y-2">
        <p className="text-lg font-bold text-idemora-text-normal leading-snug">
          Ask your notes anything
        </p>
        <p className="text-sm text-idemora-text-muted leading-relaxed">
          Search your vault, or the web — your choice.
        </p>
      </div>

      <div className="border-t border-idemora-border/30" />

      {/* Suggestions */}
      <div className="space-y-1">
        <p className="text-sm font-bold text-idemora-text-normal mb-2">Try asking</p>
        {suggestions.map((s, i) => (
          <SuggestionChip key={i} text={s} onClick={() => onSuggest(s)} />
        ))}
      </div>

      <div className="border-t border-idemora-border/30" />

      {/* Tip */}
      <div className="space-y-1.5">
        <p className="text-sm font-bold text-idemora-text-normal">Tip</p>
        <p className="text-sm text-idemora-text-muted leading-relaxed">
          Run <span className="font-semibold text-idemora-text-normal">Summarize</span> on a note first — it builds context that makes answers much richer.
        </p>
      </div>

    </div>
  );
}

function SuggestionChip({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-1 py-1.5 rounded-md text-sm text-idemora-text-muted hover:text-idemora-text-normal hover:bg-white/[0.03] transition-all duration-150 text-left group"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-idemora-text-muted/40 shrink-0 mt-px group-hover:bg-violet-400 transition-colors duration-150" />
      <span className="leading-snug">{text}</span>
    </button>
  );
}