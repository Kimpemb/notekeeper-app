// src/features/ai/components/ChatPanel.tsx
//
// "Chat with your notes" side panel — Phase 4
// Streaming, citations, confidence, related notes (cross-note connection pass).

import { useEffect, useRef, useState, useCallback } from "react";
import { streamChatWithNotes, type ChatMessage, type RelatedNote } from "@/features/ai/lib/chat";
import { clearAIHistory, clearConversationSummary } from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useAIStore } from "@/features/ai/store/useAIStore";

interface Props {
  noteId: string;
  paneId: 1 | 2;
}

interface MessageMeta {
  sourceTitles:   string[];
  sourceNoteIds:  string[];
  usedEmbeddings: boolean;
  confidence:     "high" | "low";
  relatedNotes:   RelatedNote[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ChatPanel({ noteId, paneId }: Props) {
  const [messages, setMessages]       = useState<ChatMessage[]>([]);
  const [metaMap, setMetaMap]         = useState<Map<string, MessageMeta>>(new Map());
  const [input, setInput]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);

  const notes          = useNoteStore((s) => s.notes);
  const openTab        = useUIStore((s) => s.openTab);
  const openTabInPane2 = useUIStore((s) => s.openTabInPane2);
  const closeChat      = useUIStore((s) => s.closeChat);
  const aiEnabled      = useAIStore((s) => s.enabled);
  const connectionStatus = useAIStore((s) => s.connectionStatus);

  const isAIAvailable = aiEnabled && connectionStatus === "connected";
  const currentNote   = notes.find((n) => n.id === noteId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [noteId]);

  useEffect(() => {
    setMessages([]);
    setMetaMap(new Map());
    setError(null);
  }, [noteId]);

  const handleSend = useCallback(async () => {
    const q = input.trim();
    if (!q || loading || !isAIAvailable) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: q,
      createdAt: Date.now(),
    };

    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setLoading(true);
    setStreamingId(assistantId);
    setError(null);

    let errorHandled = false;

    try {
      const meta = await streamChatWithNotes(
        q,
        notes,
        noteId,
        currentNote,
        {
          onChunk: (token) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + token }
                  : m
              )
            );
          },
          onDone: () => {
            setStreamingId(null);
            setLoading(false);
          },
          onError: (err) => {
            errorHandled = true;
            setMessages((prev) => prev.filter((m) => m.id !== assistantId));
            const msg =
              err.message.toLowerCase().includes("quota") ||
              err.message.toLowerCase().includes("exhausted")
                ? "Daily API quota reached. Chat will work again tomorrow, or upgrade your Gemini plan."
                : err.message;
            setError(msg);
            setStreamingId(null);
            setLoading(false);
          },
        }
      );

      setMetaMap((prev) =>
        new Map(prev).set(assistantId, {
          sourceTitles:   meta.sourceTitles,
          sourceNoteIds:  meta.sourceNoteIds,
          usedEmbeddings: meta.usedEmbeddings,
          confidence:     meta.confidence,
          relatedNotes:   meta.relatedNotes,
        })
      );
    } catch {
      if (!errorHandled) {
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        setError("Something went wrong. Please try again.");
        setStreamingId(null);
        setLoading(false);
      }
    }
  }, [input, loading, isAIAvailable, notes, noteId, currentNote]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleClear() {
    setMessages([]);
    setMetaMap(new Map());
    setError(null);
    await Promise.all([
      clearAIHistory(noteId),
      clearConversationSummary(noteId),
    ]);
  }

  function handleOpenNote(id: string) {
    if (paneId === 2) openTabInPane2(id);
    else openTab(id);
  }

  return (
    <div className="flex flex-col h-full w-72 shrink-0 border-l border-idemora-border bg-idemora-bg-primary ">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b  border-idemora-border shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-violet-50  flex items-center justify-center shrink-0">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-violet-500 ">
              <path d="M6.5 1C3.46 1 1 3.19 1 5.9c0 1.5.7 2.85 1.82 3.78L2.5 12l2.3-1.1c.54.15 1.1.23 1.7.23 3.04 0 5.5-2.19 5.5-4.9S9.54 1 6.5 1z"
                stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M4 5.5h5M4 7.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-sm font-semibold text-idemora-text-normal">Ask your notes</span>
          {messages.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-violet-100  text-violet-600  tabular-nums">
              {Math.floor(messages.length / 2)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              title="Clear conversation"
              className="w-6 h-6 flex items-center justify-center rounded-md text-idemora-text-muted     transition-colors duration-100"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 2.5h7M3 2.5V1.5h4v1M3.5 4.5v3M6.5 4.5v3M2 2.5l.5 6h5l.5-6"
                  stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
          <button
            onClick={() => closeChat(paneId)}
            className="w-6 h-6 flex items-center justify-center rounded-md text-idemora-text-muted     transition-colors duration-100"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto">
        {!isAIAvailable ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-idemora-bg-primary  flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="text-idemora-text-normal ">
                <circle cx="11" cy="11" r="8.5" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M11 7v5M11 15v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-idemora-text-muted">AI not connected</p>
              <p className="text-xs text-idemora-text-muted  leading-relaxed">
                Add your Gemini API key in Settings → AI to use this feature.
              </p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <EmptyState currentNoteTitle={currentNote?.title} />
        ) : (
          <div className="py-3 space-y-1">
            {messages.map((msg) => {
              const meta        = metaMap.get(msg.id);
              const isStreaming = msg.id === streamingId;
              return (
                <div key={msg.id}>
                  <MessageBubble message={msg} isStreaming={isStreaming} />
                  {msg.role === "assistant" && meta && !isStreaming && (
                    <MessageFooter
                      meta={meta}
                      onOpenNote={handleOpenNote}
                    />
                  )}
                </div>
              );
            })}

            {error && (
              <div className="mx-4 px-3 py-2 rounded-lg bg-red-50 /30 border-red-100 /50">
                <p className="text-xs text-red-500 ">{error}</p>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Input ── */}
      {isAIAvailable && (
        <div className="shrink-0 border-t  border-idemora-border p-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your notes…"
              disabled={loading}
              rows={1}
              className="flex-1 resize-none rounded-lg px-3 py-2 text-sm bg-idemora-bg-primary border-idemora-border  text-idemora-text-normal placeholder-idemora-text-muted  focus:outline-none focus:ring-1 focus:ring-violet-400 :ring-violet-600 transition-colors duration-100 disabled:opacity-50 max-h-32 leading-relaxed"
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
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-violet-500  disabled:opacity-40 disabled:cursor-not-allowed text-idemora-text-normal transition-colors duration-100 shrink-0"
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
          <p className="text-[10px] text-idemora-text-muted  mt-1.5 px-0.5">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Message footer ───────────────────────────────────────────────────────────

function MessageFooter({
  meta,
  onOpenNote,
}: {
  meta: MessageMeta;
  onOpenNote: (id: string) => void;
}) {
  return (
    <div className="px-4 pb-2 pl-9 space-y-1.5">

      {/* Weak grounding warning */}
      {meta.confidence === "low" && (
        <div className="flex items-center gap-1.5">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-amber-400 shrink-0">
            <path d="M5 1L9 9H1L5 1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
            <path d="M5 4v2M5 7.5v.1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          </svg>
          <p className="text-[10px] text-amber-500  leading-relaxed">
            Weakly grounded — answer may not reflect your notes accurately
          </p>
        </div>
      )}

      {/* Source note pills */}
      {meta.sourceTitles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {meta.sourceTitles.map((title, i) => (
            <button
              key={meta.sourceNoteIds[i]}
              onClick={() => onOpenNote(meta.sourceNoteIds[i])}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-idemora-bg-primary  text-idemora-text-muted  :bg-violet-950  :text-violet-400 transition-colors duration-100 max-w-[140px]"
              title={title}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0">
                <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1"/>
                <path d="M2.5 3h3M2.5 5h2" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
              </svg>
              <span className="truncate">{title}</span>
            </button>
          ))}
        </div>
      )}

      {/* Related notes — cross-note connection pass */}
      {meta.relatedNotes.length > 0 && (
        <div className="pt-0.5">
          <p className="text-[10px] text-idemora-text-muted  mb-1">You also wrote about this in</p>
          <div className="flex flex-wrap gap-1">
            {meta.relatedNotes.map((note) => (
              <button
                key={note.noteId}
                onClick={() => onOpenNote(note.noteId)}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-50 /30 text-blue-500   :bg-blue-950/50 transition-colors duration-100 max-w-[140px]"
                title={note.title}
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0">
                  <path d="M4 1v6M1 4h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                <span className="truncate">{note.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Retrieval mode badge */}
      <p className="text-[10px] text-idemora-text-normal ">
        {meta.usedEmbeddings ? "✦ semantic search" : "◦ keyword search"}
      </p>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ currentNoteTitle }: { currentNoteTitle?: string }) {
  const suggestions = [
    "What do I know about this topic?",
    "Summarize the key themes across my notes",
    currentNoteTitle
      ? "How does this relate to my other notes?"
      : "What connections exist between my notes?",
  ];

  return (
    <div className="flex flex-col gap-4 px-4 py-6">
      <div className="flex flex-col items-center gap-3 text-center py-4">
        <div className="w-12 h-12 rounded-2xl bg-violet-50 /50 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="text-violet-400 ">
            <path d="M11 2C6.58 2 3 5.32 3 9.4c0 2.44 1.17 4.62 3 6.03V20l3.5-1.7c.48.1.98.1 1.5.1 4.42 0 8-3.32 8-7.4S15.42 2 11 2z"
              stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
            <path d="M7 9h8M7 12h5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-idemora-text-normal">Ask your notes anything</p>
          <p className="text-xs text-idemora-text-muted  mt-0.5 leading-relaxed">
            I'll search your vault and answer using what you've written.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-idemora-text-muted  px-0.5">
          Try asking
        </p>
        {suggestions.map((s, i) => (
          <SuggestionChip key={i} text={s} />
        ))}
      </div>

      <div className="p-2.5 rounded-lg bg-idemora-bg-primary border-idemora-border">
        <p className="text-[10px] text-idemora-text-muted leading-relaxed">
          💡 Use <span className="font-medium text-idemora-text-muted">Summarize</span> on your notes first — it builds context that makes answers much richer.
        </p>
      </div>
    </div>
  );
}

function SuggestionChip({ text }: { text: string }) {
  return (
    <div className="px-3 py-2 rounded-lg border-idemora-border bg-idemora-bg-primary text-xs text-idemora-text-muted leading-relaxed cursor-default    :text-violet-400 transition-colors duration-100">
      {text}
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  message,
  isStreaming,
}: {
  message:     ChatMessage;
  isStreaming: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`px-4 py-1.5 ${isUser ? "flex justify-end" : ""}`}>
      {isUser ? (
        <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-tr-sm bg-violet-500 text-idemora-text-normal text-sm leading-relaxed">
          {message.content}
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-full bg-violet-100  flex items-center justify-center shrink-0">
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M4 1C2.34 1 1 2.19 1 3.65c0 .88.44 1.67 1.12 2.18L2 7l1.35-.65c.21.04.43.05.65.05C5.66 6.4 7 5.21 7 3.65S5.66 1 4 1z"
                  fill="currentColor" className="text-violet-500 "/>
              </svg>
            </div>
            <span className="text-[10px] font-semibold text-violet-500  uppercase tracking-wide">
              Assistant
            </span>
          </div>

          {isStreaming && message.content === "" && (
            <div className="pl-5 flex items-center gap-1 py-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-violet-400  animate-bounce"
                  style={{ animationDelay: `${i * 150}ms`, animationDuration: "800ms" }}
                />
              ))}
            </div>
          )}

          {message.content !== "" && (
            <div className="text-sm text-idemora-text-normal leading-relaxed whitespace-pre-wrap pl-5">
              {message.content}
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