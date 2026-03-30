// src/features/ai/components/ChatPanel.tsx
//
// "Chat with your notes" side panel.
// Follows the exact same layout pattern as SimilarNotesPanel / BacklinksPanel.
// Opens via slash menu /chat or keyboard shortcut.

import { useEffect, useRef, useState, useCallback } from "react";
import { chatWithNotes, type ChatMessage } from "@/features/ai/lib/chat";
import { clearAIHistory } from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useAIStore } from "@/features/ai/store/useAIStore";

interface Props {
  noteId: string;
  paneId: 1 | 2;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ChatPanel({ noteId, paneId }: Props) {
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [sourceTitles, setSourceTitles] = useState<string[]>([]);
  const [error, setError]         = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);

  const notes            = useNoteStore((s) => s.notes);
  const closeChat        = useUIStore((s) => s.closeChat);
  const aiEnabled        = useAIStore((s) => s.enabled);
  const connectionStatus = useAIStore((s) => s.connectionStatus);

  const isAIAvailable = aiEnabled && connectionStatus === "connected";
  const currentNote   = notes.find((n) => n.id === noteId);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [noteId]);

  // Reset messages when note changes
  useEffect(() => {
    setMessages([]);
    setError(null);
    setSourceTitles([]);
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

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setError(null);
    setSourceTitles([]);

    try {
      const result = await chatWithNotes(q, notes, noteId, currentNote);

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.answer,
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setSourceTitles(result.sourceTitles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
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
    setSourceTitles([]);
    setError(null);
    await clearAIHistory(noteId);
  }

  return (
    <div className="flex flex-col h-full w-72 shrink-0 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-violet-50 dark:bg-violet-950 flex items-center justify-center shrink-0">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-violet-500 dark:text-violet-400">
              <path d="M6.5 1C3.46 1 1 3.19 1 5.9c0 1.5.7 2.85 1.82 3.78L2.5 12l2.3-1.1c.54.15 1.1.23 1.7.23 3.04 0 5.5-2.19 5.5-4.9S9.54 1 6.5 1z"
                stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M4 5.5h5M4 7.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Ask your notes</span>
          {messages.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-violet-100 dark:bg-violet-950 text-violet-600 dark:text-violet-400 tabular-nums">
              {Math.floor(messages.length / 2)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              title="Clear conversation"
              className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-100"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 2.5h7M3 2.5V1.5h4v1M3.5 4.5v3M6.5 4.5v3M2 2.5l.5 6h5l.5-6"
                  stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
          <button
            onClick={() => closeChat(paneId)}
            className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-100"
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
            <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="text-zinc-300 dark:text-zinc-600">
                <circle cx="11" cy="11" r="8.5" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M11 7v5M11 15v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">AI not connected</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-600 leading-relaxed">
                Add your Gemini API key in Settings → AI to use this feature.
              </p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <EmptyState currentNoteTitle={currentNote?.title} />
        ) : (
          <div className="py-3 space-y-1">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}

            {loading && <TypingIndicator />}

            {/* Source attribution */}
            {!loading && sourceTitles.length > 0 && (
              <div className="px-4 pt-1 pb-2">
                <p className="text-[10px] text-zinc-400 dark:text-zinc-600 leading-relaxed">
                  <span className="font-medium">Sources: </span>
                  {sourceTitles.join(", ")}
                </p>
              </div>
            )}

            {error && (
              <div className="mx-4 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50">
                <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Input ── */}
      {isAIAvailable && (
        <div className="shrink-0 border-t border-zinc-100 dark:border-zinc-800 p-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your notes…"
              disabled={loading}
              rows={1}
              className="flex-1 resize-none rounded-lg px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:focus:ring-violet-600 transition-colors duration-100 disabled:opacity-50 max-h-32 leading-relaxed"
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
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-violet-500 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors duration-100 shrink-0"
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
          <p className="text-[10px] text-zinc-400 dark:text-zinc-600 mt-1.5 px-0.5">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EmptyState({ currentNoteTitle }: { currentNoteTitle?: string }) {
  const suggestions = [
    "What do I know about this topic?",
    "Summarize the key themes across my notes",
    currentNoteTitle ? `How does this relate to my other notes?` : "What connections exist between my notes?",
  ];

  return (
    <div className="flex flex-col gap-4 px-4 py-6">
      <div className="flex flex-col items-center gap-3 text-center py-4">
        <div className="w-12 h-12 rounded-2xl bg-violet-50 dark:bg-violet-950/50 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="text-violet-400 dark:text-violet-500">
            <path d="M11 2C6.58 2 3 5.32 3 9.4c0 2.44 1.17 4.62 3 6.03V20l3.5-1.7c.48.1.98.1 1.5.1 4.42 0 8-3.32 8-7.4S15.42 2 11 2z"
              stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
            <path d="M7 9h8M7 12h5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Ask your notes anything</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-0.5 leading-relaxed">
            I'll search your vault and answer using what you've written.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600 px-0.5">
          Try asking
        </p>
        {suggestions.map((s, i) => (
          <SuggestionChip key={i} text={s} />
        ))}
      </div>

      <div className="p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800">
        <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-relaxed">
          💡 Use <span className="font-medium text-zinc-500 dark:text-zinc-400">Summarize</span> on your notes first — it builds context that makes answers much richer.
        </p>
      </div>
    </div>
  );
}

function SuggestionChip({ text }: { text: string }) {
  return (
    <div className="px-3 py-2 rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed cursor-default hover:border-violet-200 dark:hover:border-violet-800 hover:text-violet-600 dark:hover:text-violet-400 transition-colors duration-100">
      {text}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`px-4 py-1.5 ${isUser ? "flex justify-end" : ""}`}>
      {isUser ? (
        <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-tr-sm bg-violet-500 text-white text-sm leading-relaxed">
          {message.content}
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-full bg-violet-100 dark:bg-violet-950 flex items-center justify-center shrink-0">
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M4 1C2.34 1 1 2.19 1 3.65c0 .88.44 1.67 1.12 2.18L2 7l1.35-.65c.21.04.43.05.65.05C5.66 6.4 7 5.21 7 3.65S5.66 1 4 1z"
                  fill="currentColor" className="text-violet-500 dark:text-violet-400"/>
              </svg>
            </div>
            <span className="text-[10px] font-semibold text-violet-500 dark:text-violet-400 uppercase tracking-wide">
              Assistant
            </span>
          </div>
          <div className="text-sm text-zinc-700 dark:text-zinc-200 leading-relaxed whitespace-pre-wrap pl-5">
            {message.content}
          </div>
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="px-4 py-2">
      <div className="flex items-center gap-1.5">
        <div className="w-4 h-4 rounded-full bg-violet-100 dark:bg-violet-950 flex items-center justify-center shrink-0">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M4 1C2.34 1 1 2.19 1 3.65c0 .88.44 1.67 1.12 2.18L2 7l1.35-.65c.21.04.43.05.65.05C5.66 6.4 7 5.21 7 3.65S5.66 1 4 1z"
              fill="currentColor" className="text-violet-500 dark:text-violet-400"/>
          </svg>
        </div>
        <div className="flex items-center gap-1 px-2 py-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-violet-400 dark:bg-violet-600 animate-bounce"
              style={{ animationDelay: `${i * 150}ms`, animationDuration: "800ms" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}