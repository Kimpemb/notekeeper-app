  // src/features/ai/lib/chat.ts
  //
  // RAG v3 — Full pipeline rewrite.
  //
  // Pipeline per query:
  //   1. Intent detection (intentDetection.ts)
  //   2. Scope parse (included in intent detection)
  //   3. Query expansion (queryExpansion.ts) — processing model, 1.5s timeout
  //   4. Hybrid retrieval (hybrid.ts) — FTS5 + vector + RRF
  //   5. Rerank (rerank.ts) — metadata boosts, confidence calibration
  //   6. Context expansion (hybrid.ts expandContext)
  //   7. Prompt assembly — source_type on each excerpt, vault context block
  //   8. Primary model response
  //   9. Post-response cross-note connection pass
  //
  // Inventory awareness branch:
  //   - Hybrid search skipped entirely
  //   - Note inventory summary injected via processing model
  //
  // Tier 1 (no AI):
  //   - Same retrieval pipeline runs
  //   - Returns structured result set for UI rendering
  //
  // Token budget: 12,000 char cap, trimmed from bottom of ranked list.
  // Summary generation routed through processing model.

  import {
    hybridSearch,
    expandContext,
    type HybridResult,
    type ExcludedTitleMatch,
  } from "@/features/ai/lib/search/hybrid"
  import { getDb } from "@/features/notes/db/client"
  import { detectIntent }    from "@/features/ai/lib/search/intentDetection"
  import {
    callPrimary,
    promptPrimary,
    promptProcessing,
    ProcessingExhaustedError,
    type ProviderMessage,
    type AICallError,
    isAIReady,
  } from "@/features/ai/lib/client"
  import {
    getAllNotesMeta,
    getAIHistory,
    appendAIHistory,
    getConversationSummary,
    saveConversationSummary,
  } from "@/features/notes/db/queries"
  import type { Note } from "@/types"
import { WEB_SEARCH_SCORE_THRESHOLD, WEB_SEARCH_MIN_CHUNKS, getWebSearchProvider } from "@/features/ai/lib/search/webSearchProvider"
import type { WebSearchResult } from "@/features/ai/lib/search/webSearchProvider"

  // ─── Types ────────────────────────────────────────────────────────────────────

  export interface ChatMessage {
    id:        string
    role:      "user" | "assistant"
    content:   string
    createdAt: number
  }

  export interface RelatedNote {
    title:  string
    noteId: string
  }

  // Tier 1 result card — returned when AI is disabled
  export interface Tier1ResultCard {
    noteId:       string
    noteTitle:    string
    sourceType:   string
    chunkHeading: string | null
    excerpt:      string
    blockType:    string
    confidence:   "strong" | "possible" | "weak"
  }

  export interface ChatResult {
    answer:               string
    sourceTitles:         string[]
    sourceNoteIds:        string[]
    usedEmbeddings:       boolean
    confidence:           "high" | "medium" | "low"
    relatedNotes:         RelatedNote[]
    tier1Results?:        Tier1ResultCard[]
    excludedNoteNotices?: ExcludedTitleMatch[]
    titleMatchedNoteIds?: string[]
    webNudge?:            "limited" | "zero"
    webGrounded?:         boolean
  }

  export interface StreamingChatOptions {
    onChunk:   (token: string) => void
    onDone?:   () => void
    onError?:  (err: AICallError) => void
    onStatus?: (message: string) => void
  }

  // ─── Constants ────────────────────────────────────────────────────────────────

  const MAX_CONTEXT_CHARS = 32_000
  const MEDIUM_CONFIDENCE_THRESHOLD = 0.08


  // hasPersonalSignals removed — isPersonal now comes from detectIntent (intentDetection.ts)
  // ─── Query mode budget allocator ──────────────────────────────────────────────

  interface ContextBudget {
    historyChars: number
    vaultChars:   number
  }

  function allocateBudget(intent: import("@/features/ai/lib/search/intentDetection").QueryIntent): ContextBudget {
    switch (intent) {
      case "edit":
        return { historyChars: 20_000, vaultChars: 0 }
      case "hybrid":
        return { historyChars: 8_000,  vaultChars: 6_000 }
      case "exploration":
        return { historyChars: 4_000,  vaultChars: 8_000 }
      case "inventory":
        return { historyChars: 2_000,  vaultChars: 0 }
      case "scoped":
      case "lookup":
      default:
        return { historyChars: 3_000,  vaultChars: 9_000 }
    }
  }


  // ─── Rolling session memory ───────────────────────────────────────────────────

  const HISTORY_CHAR_THRESHOLD = 24_000
  const HISTORY_SUMMARY_LIMIT  = 40

  async function buildHistoryBlock(
    noteId:          string,
    charBudget:      number = 6_000,
    sessionMessages?: ChatMessage[],
  ): Promise<string> {
    // Prefer in-memory session messages — avoids DB round-trip and gets full fidelity
    // Fall back to DB read if session messages not provided
    const history: { role: string; content: string }[] = sessionMessages
      ? sessionMessages.map((m) => ({ role: m.role, content: m.content }))
      : await getAIHistory(noteId, HISTORY_SUMMARY_LIMIT)

    const summaryRow = await getConversationSummary(noteId)

    // Compute total chars
    const totalChars = history.reduce((sum, h) => sum + h.content.length, 0)

    // Trigger summary if history is large
    if (totalChars > HISTORY_CHAR_THRESHOLD && history.length > 0) {
      const existingRow = await getConversationSummary(noteId)
      if (!existingRow || history.length > (existingRow.message_count ?? 0) + 10) {
        const allContent = history
          .map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`)
          .join("\n")
        updateRollingSummary(noteId, allContent, existingRow?.summary ?? null)
      }
    }

    const parts: string[] = []

    if (summaryRow?.summary) {
      parts.push(`[Earlier conversation summary]\n${summaryRow.summary}`)
    }

    // Assemble newest-first until budget exhausted, then reverse
    let assembled = 0
    const kept: string[] = []

    for (let i = history.length - 1; i >= 0; i--) {
      const h    = history[i]
      const line = `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`
      if (assembled + line.length > charBudget) break
      kept.unshift(line)
      assembled += line.length
    }

    if (kept.length > 0) {
      parts.push(`[Recent conversation]\n${kept.join("\n")}`)
    }

    return parts.length > 0 ? `\n${parts.join("\n\n")}\n` : ""
  }



  async function updateRollingSummary(
    noteId:          string,
    droppedContent:  string,
    existingSummary: string | null,
  ): Promise<void> {
    try {
      const prompt = existingSummary
        ? `You are summarizing a conversation for context compression.
  Existing summary: ${existingSummary}

  New messages to incorporate:
  ${droppedContent}

  Write a concise updated summary (max 3 sentences) capturing the key topics discussed.
  Summary:`
        : `Summarize this conversation in 2-3 sentences, capturing the key topics:
  ${droppedContent}
  Summary:`

      const summary = await promptProcessing(prompt)
      const currentRow = await getConversationSummary(noteId)
      await saveConversationSummary(
        noteId,
        summary.trim(),
        (currentRow?.message_count ?? 0) + droppedContent.split("\n").length
      )
    } catch (err) {
      if (!(err instanceof ProcessingExhaustedError)) {
        console.debug("[updateRollingSummary] non-exhaustion error:", err)
      }
    }
  }

  // ─── Inventory awareness ──────────────────────────────────────────────────────

  async function buildInventoryContext(): Promise<string> {
    const notes  = await getAllNotesMeta()
    const active = notes.filter((n) => !n.deleted_at)

    const recentTitles = active
      .sort((a, b) => b.updated_at - a.updated_at)
      .slice(0, 10)
      .map((n) => `- ${n.title} (${new Date(n.updated_at).toLocaleDateString()})`)
      .join("\n")

    const allTags = new Set<string>()
    for (const note of active) {
      if (!note.tags) continue
      try {
        const tags: string[] = JSON.parse(note.tags)
        tags.forEach((t) => allTags.add(t))
      } catch { /* skip malformed */ }
    }

    const tagList = [...allTags].slice(0, 30).join(", ") || "none"

    const staticBlock = `[VAULT INVENTORY]
  Total notes: ${active.length}
  Recently edited:
  ${recentTitles}
  Tags: ${tagList}`

    try {
      const prompt = `You have access to ${active.length} notes in the user's vault.

  Recently edited notes:
  ${recentTitles}

  Tags in vault: ${tagList}

  Summarize what topics and areas are covered in this vault in 2-3 sentences.`

      const summary = await promptProcessing(prompt)
      return `${staticBlock}\n\n${summary}`
    } catch (err) {
      if (err instanceof ProcessingExhaustedError) {
        console.info("[buildInventoryContext] processing exhausted — returning static inventory")
        return staticBlock
      }
      console.debug("[buildInventoryContext] summary failed:", err)
      return staticBlock
    }
  }

  // ─── Context assembly ─────────────────────────────────────────────────────────

  function buildExcerptBlock(
    results: HybridResult[],
    maxChars: number = MAX_CONTEXT_CHARS,
  ): { block: string; includedCount: number } {
    const chunks: string[] = []
    let total        = 0
    let includedCount = 0

    for (let i = 0; i < results.length; i++) {
      const r    = results[i]
      const text     = r.expanded_context ?? r.plaintext
      const heading  = r.chunk_heading ? ` — Section "${r.chunk_heading}"` : ""
      const location = r.breadcrumb && r.breadcrumb !== r.note_title
        ? ` [${r.breadcrumb}]`
        : ""
      const label = `[${i + 1}] From "${r.note_title}"${location} (${r.source_type})${heading}:\n${text}`

      if (total + label.length > maxChars) break
      chunks.push(label)
      total += label.length
      includedCount++
    }

    return { block: chunks.join("\n\n"), includedCount }
  }



  // ─── Citation filtering ───────────────────────────────────────────────────────
  //
  // After the model responds, parse which [N] markers actually appear in the
  // text and filter sourceTitles/sourceNoteIds to only those indices.
  // If the model cited nothing, fall back to returning all sources.

  // ─── Citation filtering ───────────────────────────────────────────────────────

  function extractCitedIndices(text: string): Set<number> {
    const cited = new Set<number>()
    // Keep 1-based — we'll convert when resolving
    for (const match of text.matchAll(/\[(\d+)\]/g)) {
      cited.add(parseInt(match[1], 10))
    }
    return cited
  }

  function filterSourcesByCitations(
    chunkTitles:  string[],   // parallel to results[], one entry per chunk
    chunkNoteIds: string[],   // parallel to results[], one entry per chunk
    cited:        Set<number>, // 1-based indices from model response
  ): { titles: string[]; noteIds: string[] } {
    // If model cited nothing, return all unique sources as fallback
    if (cited.size === 0) {
      return { titles: [], noteIds: [] }
    }

    const seen = new Set<string>()
    const titles: string[] = []
    const noteIds: string[] = []

    for (const oneBased of cited) {
      const i = oneBased - 1 // convert to 0-based chunk index
      if (i < 0 || i >= chunkNoteIds.length) continue // bounds guard
      const noteId = chunkNoteIds[i]
      if (!seen.has(noteId)) {
        seen.add(noteId)
        noteIds.push(noteId)
        titles.push(chunkTitles[i])
      }
    }

    return { titles, noteIds }
  }

  // ─── Cross-note connection pass ───────────────────────────────────────────────

  async function findRelatedNotes(
    answerText:    string,
    citedNoteIds:  Set<string>,
    currentNoteId: string | undefined,
    confidence:    "high" | "medium" | "low",
  ): Promise<RelatedNote[]> {
    if (confidence === "low") return []

    try {
      // FIX: strip [N] citation markers and truncate before passing to FTS.
      // Raw answer text contains [1], [2] etc. which break FTS5 MATCH syntax.
      const query = answerText
        .replace(/\[\d+\]/g, "")                     // strip citation markers
        .replace(/`[^`]+`/g, " ")                    // strip inline code (file paths live here)
        .replace(/```[\s\S]*?```/g, " ")             // strip code blocks
        .replace(/[*•\-#>`\/\\]/g, " ")             // add / and \ 
        .replace(/\b\w*[\/\\._]\w+\b/g, " ")        // strip path-like tokens
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200)                               // tighter slice — 300 was too generous
      if (!query.trim()) return []

      const { results } = await hybridSearch(query, 5, { currentNoteId })
      const seen    = new Set<string>()
      const related: RelatedNote[] = []

      for (const r of results) {
        if (citedNoteIds.has(r.note_id)) continue
        if (r.note_id === currentNoteId)  continue
        if (seen.has(r.note_id))          continue
        if (r.final_score < 0.05)        continue

        seen.add(r.note_id)
        related.push({ title: r.note_title, noteId: r.note_id })
        if (related.length >= 3) break
      }

      return related
    } catch {
      return []
    }
  }

  // ─── Tier 1 result cards ──────────────────────────────────────────────────────

  function buildTier1Cards(results: HybridResult[]): Tier1ResultCard[] {
    return results.map((r) => {
      let confidence: "strong" | "possible" | "weak" = "weak"
      if (r.final_score >= MEDIUM_CONFIDENCE_THRESHOLD) confidence = "strong"
      else if (r.final_score >= 0.05) confidence = "possible"

      return {
        noteId:       r.note_id,
        noteTitle:    r.note_title,
        sourceType:   r.source_type,
        chunkHeading: r.chunk_heading,
        excerpt:      (r.expanded_context ?? r.plaintext).slice(0, 300),
        blockType:    "paragraph",
        confidence,
      }
    })
  }

  // ─── Title-directed query detection ──────────────────────────────────────────

  const TITLE_QUERY_PATTERNS = [
    /^what(?:'s|\s+is)\s+in\s+(.+?)[\?\.]*$/i,
    /^what(?:'s|\s+is)\s+(?:the\s+)?(?:content|contents)\s+of\s+(.+?)[\?\.]*$/i,
    /^show\s+me\s+(.+?)[\?\.]*$/i,
    /^open\s+(.+?)[\?\.]*$/i,
    /^summari[sz]e\s+(.{3,40})[\?\.]*$/i,
    /^summary\s+of\s+(.{3,40})[\?\.]*$/i,
    /^everything\s+(?:about|in|on)\s+(.+?)[\?\.]*$/i,
    /^(?:tell\s+me\s+about|what(?:'s|\s+is)\s+in)\s+(.+?)[\?\.]*$/i,
  ]

  // DEIXIS_PATTERNS removed — isDeixis now comes from detectIntent (intentDetection.ts)

  interface TitleMatch {
    noteId:    string
    noteTitle: string
  }

  interface TitleDetectResult {
    candidateFound:  boolean
    matches:         TitleMatch[]
    excludedMatches: ExcludedTitleMatch[]
  }

  async function detectTitleQuery(query: string): Promise<TitleDetectResult> {
    let candidate: string | null = null

    for (const pattern of TITLE_QUERY_PATTERNS) {
      const m = query.trim().match(pattern)
      if (m) { candidate = m[1].trim(); break }
    }

    if (!candidate) return { candidateFound: false, matches: [], excludedMatches: [] }

    // Strip instruction suffixes like ", max 5 lines" or ", briefly"
    candidate = candidate.replace(/,.*$/, "").trim()

    console.log('[titleDetect] candidate:', candidate)

    try {
      const db = await getDb()

      // Check excluded notes first — these surface a notice regardless
      const excludedRows = await db.select<{ note_id: string; title: string }[]>(
        `SELECT ntc.note_id, ntc.title
        FROM note_title_chunks ntc
        JOIN notes n ON n.id = ntc.note_id
        WHERE ntc.title LIKE $1
          AND n.deleted_at IS NULL
          AND COALESCE(n.rag_excluded, 0) = 1
        LIMIT 3`,
        [`%${candidate}%`]
      )
      const excludedMatches: ExcludedTitleMatch[] = excludedRows.map((r) => ({
        note_id:    r.note_id,
        note_title: r.title,
      }))

      console.log('[titleDetect] excluded matches:', excludedMatches.length, excludedMatches.map(r => r.note_title))

      const tokens = candidate
        .split(/\s+/)
        .filter((t) => t.length > 1)   // allow 2-char tokens like "Ad", "#1"
        .slice(0, 6)

    if (tokens.length === 0) {
      return { candidateFound: true, matches: [], excludedMatches }
    }
    const whereClauses = tokens.map((_, i) => `ntc.title LIKE $${i + 1}`).join(" AND ")
    const params       = tokens.map((t) => `%${t}%`)

    const rows = await db.select<{ note_id: string; title: string }[]>(
      `SELECT ntc.note_id, ntc.title
      FROM note_title_chunks ntc
      JOIN notes n ON n.id = ntc.note_id
      WHERE (${whereClauses})
        AND n.deleted_at IS NULL
        AND COALESCE(n.rag_excluded, 0) = 0
      LIMIT 10`,
      params
    )

      console.log('[titleDetect] note_title_chunks rows found:', rows.length, rows.map(r => r.title))

      if (rows.length === 0) {
        console.log('[titleDetect] falling back to notes table')
        const fallback = await db.select<{ id: string; title: string }[]>(
          `SELECT id, title FROM notes
          WHERE title LIKE $1
            AND deleted_at IS NULL
            AND COALESCE(rag_excluded, 0) = 0
          LIMIT 10`,
          [`%${candidate}%`]
        )

        console.log('[titleDetect] notes table fallback rows:', fallback.length, fallback.map(r => r.title))

        if (fallback.length === 0) return { candidateFound: true, matches: [], excludedMatches }

        const ranked = fallback
          .map((r) => {
            const t     = r.title.toLowerCase()
            const c     = candidate!.toLowerCase()
            const score = t === c ? 3 : t.startsWith(c) ? 2 : 1
            return { note_id: r.id, title: r.title, score }
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)

        return {
          candidateFound: true,
          matches:        ranked.map((r) => ({ noteId: r.note_id, noteTitle: r.title })),
          excludedMatches,
        }
      }

      const ranked = rows
      .map((r) => {
        const t          = r.title.toLowerCase()
        const c          = candidate!.toLowerCase()
        const tokenHits  = tokens.filter((tok) => t.includes(tok.toLowerCase())).length
        const exactBonus = t === c ? 10 : t.startsWith(c) ? 5 : 0
        return { ...r, score: tokenHits + exactBonus }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

      return {
        candidateFound: true,
        matches:        ranked.map((r) => ({ noteId: r.note_id, noteTitle: r.title })),
        excludedMatches,
      }
    } catch (err) {
      console.warn('[titleDetect] failed:', err)
      return { candidateFound: false, matches: [], excludedMatches: [] }
    }
  }

  async function fetchTitleMatchChunks(
    matches:  TitleMatch[],
    maxChars: number,
  ): Promise<{ chunks: HybridResult[]; noticeText: string }> {
    const db      = await getDb()
    const perNote = Math.floor(maxChars / matches.length)
    const allChunks: HybridResult[] = []

    for (const match of matches) {
      try {
        console.log('[titleChunks] fetching note:', match.noteTitle, match.noteId)

        const rows = await db.select<{
          block_id:      string
          plaintext:     string
          chunk_heading: string | null
          source_type:   string
          breadcrumb:    string | null
        }[]>(
          `SELECT nb.block_id, nb.plaintext, nb.chunk_heading, nb.source_type,
                  COALESCE(e.breadcrumb, ntc.breadcrumb) AS breadcrumb
          FROM note_blocks nb
          LEFT JOIN embeddings e          ON e.block_id  = nb.block_id
          LEFT JOIN note_title_chunks ntc ON ntc.note_id = nb.note_id
          WHERE nb.note_id = $1
          ORDER BY nb.chunk_index ASC, nb.block_created_at ASC`,
          [match.noteId]
        )

        console.log('[titleChunks] rows fetched:', rows.length)

        let charCount = 0
        for (const row of rows) {
          if (charCount + row.plaintext.length > perNote) break
          allChunks.push({
            block_id:      row.block_id,
            note_id:       match.noteId,
            note_title:    match.noteTitle,
            plaintext:     row.plaintext,
            chunk_heading: row.chunk_heading,
            source_type:   row.source_type,
            rrf_score:     1.0,
            final_score:   1.0,
            boost_applied: 0,
            confidence:    "high" as const,
            matched_by:    ["keyword" as const],
            breadcrumb:    row.breadcrumb ?? undefined,
          })
          charCount += row.plaintext.length
        }
      } catch (err) {
        console.warn('[titleChunks] failed for note:', match.noteTitle, err)
      }
    }

    const noticeText = matches.length === 1
      ? `Note: The following excerpts are pulled directly from "${matches[0].noteTitle}" in reading order.`
      : `Note: Found ${matches.length} notes matching your query: ${matches.map((m) => `"${m.noteTitle}"`).join(", ")}. Showing content from each below.`

    return { chunks: allChunks, noticeText }
  }

  // ─── deriveWebNudge helper ───────────────────────────────────────────────

function deriveWebNudge(
    pipeline:    PipelineResult,
    answerText?: string,
    isPersonal?: boolean,
  ): "limited" | "zero" | undefined {
    const intent = pipeline.detectedIntent

    // Exploration and non-personal lookups don't benefit from web search
    if (intent === "exploration") return undefined
    if (intent === "lookup" && !isPersonal) return undefined
    if (pipeline.inventoryMode)   return undefined
    if (pipeline.isTitleDirected) return undefined

    if (pipeline.chunkCount === 0) return "zero"

    // Clean signal: pipeline confidence is low = retrieval was junk
    if (pipeline.confidence === "low") return "limited"

    // Fallback: model explicitly said it found nothing despite ok-looking retrieval
    if (answerText) {
      const lower = answerText.toLowerCase()
      if (
        lower.includes("do not contain") ||
        lower.includes("doesn't contain") ||
        lower.includes("no information") ||
        lower.includes("not found in") ||
        lower.includes("cannot find") ||
        lower.includes("nothing in your notes") ||
        lower.includes("not present in") ||
        lower.includes("not available in") ||
        lower.includes("no mention") ||
        lower.includes("not mentioned") ||
        lower.includes("does not include") ||
        lower.includes("not covered") ||
        lower.includes("not in the provided") ||
        lower.includes("provided notes do not")
      ) return "limited"
    }

    if (
      pipeline.topScore  < WEB_SEARCH_SCORE_THRESHOLD &&
      pipeline.chunkCount < WEB_SEARCH_MIN_CHUNKS
    ) return "limited"

    return undefined
  }

  // ─── Web results builder ──────────────────────────────────────────────────────

  function buildWebResultsBlock(webResults: WebSearchResult[]): string {
    const lines = webResults.map((r, i) =>
      `[web:${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`
    )
    return `[WEB SEARCH RESULTS]\nThe following results were retrieved from a live web search. Cite them as [web:1], [web:2] etc.\n\n${lines.join("\n\n")}\n`
  }

  // ─── Edit prompt builder ──────────────────────────────────────────────────────

  function buildEditPrompt(
    query:        string,
    historyBlock: string,
    _sessionMessages?: ChatMessage[],
  ): string {
    return `You are helping the user edit or update content from the conversation.
  ${historyBlock}
  [QUESTION]
  ${query}

  Answer:`
  }

  // ─── Main pipeline ────────────────────────────────────────────────────────────
  export interface PipelineResult {
    excerptBlock:         string
    sourceTitles:         string[]
    sourceNoteIds:        string[]
    usedEmbeddings:       boolean
    confidence:           "high" | "medium" | "low"
    tier1Cards:           Tier1ResultCard[]
    inventoryMode:        boolean
    excludedNoteNotices:  ExcludedTitleMatch[]
    titleMatchedNoteIds:  string[]
    isTitleDirected:      boolean
    topScore:             number
    chunkCount:           number
    detectedIntent:       import("@/features/ai/lib/search/intentDetection").QueryIntent
  }


  export async function runPipeline(
    query:            string,
    currentNote?:     Note,
    scopeNoteIds?:    string[],
    overrideNoteIds?: string[],
    onStatus?:        (msg: string) => void,
  ): Promise<PipelineResult> {
    console.log('[pipeline] ========== STARTING PIPELINE ==========')
    console.log('[pipeline] Input query:', query)
    console.log('[pipeline] currentNote:', currentNote?.id || 'none')
    console.log('[pipeline] scopeNoteIds:', scopeNoteIds || 'none')
    console.log('[pipeline] overrideNoteIds:', overrideNoteIds || 'none')

    const { intent, scope, cleanQuery, isDeixis } = await detectIntent(query)
    const t0 = performance.now()
    console.log('[pipeline] Intent detection:', { intent, scope, cleanQuery })

    // ── Edit intent — instruction against in-context content ─────────────────
    // Pipeline not needed — conversation history is the context.
    // No vault search, no web nudge, no embeddings.
    if (intent === "edit") {
      console.log('[pipeline] EDIT MODE — skipping retrieval, history is context')
      return {
        excerptBlock:        "",
        sourceTitles:        [],
        sourceNoteIds:       [],
        usedEmbeddings:      false,
        confidence:          "high",
        tier1Cards:          [],
        inventoryMode:       false,
        excludedNoteNotices: [],
        titleMatchedNoteIds: [],
        isTitleDirected:     false,
        topScore:            1,
        chunkCount:          0,
        detectedIntent:      "edit",
      }
    }

    if (intent === "inventory") {
      console.log('[pipeline] INVENTORY MODE - building inventory context')
      const inventoryContext = await buildInventoryContext()
      console.log('[pipeline] Inventory context built, length:', inventoryContext.length)
      return {
        excerptBlock:        inventoryContext,
        sourceTitles:        [],
        sourceNoteIds:       [],
        usedEmbeddings:      false,
        confidence:          "high",
        tier1Cards:          [],
        inventoryMode:       true,
        excludedNoteNotices: [],
        titleMatchedNoteIds: [],
        isTitleDirected:     false,
        topScore:            1,
        chunkCount:          1,
        detectedIntent:      "inventory",
      }
    }

    const isDeicticQuery = isDeixis

    // PATCH: Deixis path moved here — "summarize this note", "what's in the current note" etc.
    // Injects full note plaintext directly, mirrors isEnumerativeScoped pattern.
    if (isDeicticQuery && currentNote) {
      console.log('[pipeline] deixis query detected — injecting current note plaintext')
      const db = await getDb()
      const rows = await db.select<{ title: string; plaintext: string | null }[]>(
        `SELECT title, plaintext FROM notes WHERE id = $1 AND deleted_at IS NULL`,
        [currentNote.id]
      )
      const row = rows[0]
      if (row && row.plaintext) {
        const fullText     = row.plaintext.slice(0, MAX_CONTEXT_CHARS)
        const excerptBlock = `[1] From "${row.title}" (current note):\n${fullText}`
        console.log('[pipeline] deixis: injected plaintext length:', fullText.length)
        return {
          excerptBlock,
          sourceTitles:        [row.title],
          sourceNoteIds:       [currentNote.id],
          usedEmbeddings:      false,
          confidence:          "high",
          tier1Cards:          [],
          inventoryMode:       false,
          excludedNoteNotices: [],
          titleMatchedNoteIds: [currentNote.id],
          isTitleDirected:     true,
          topScore:            1,
          chunkCount:          1,
          detectedIntent:      intent,
        }
      }
      console.log('[pipeline] deixis: no plaintext available — falling through to hybrid search')
    }

    // ── Parallelise title detection and hybrid search ─────────────────────────
    // These are fully independent. Running them simultaneously saves 200-600ms.
    // topK no longer depends on titleDetect result — title chunks fill any gap.

    const queryVariants = [cleanQuery]
    const topK = intent === "exploration" ? 12 : 8

    console.log('[pipeline] Running titleDetect + hybridSearch in parallel')
    onStatus?.("Searching your notes…")

    const [titleDetect, hybridSearchResult] = await Promise.all([
      isDeicticQuery
        ? Promise.resolve({ candidateFound: false, matches: [], excludedMatches: [] })
        : detectTitleQuery(query),
      hybridSearch(cleanQuery, topK, {
        currentNoteId:  currentNote?.id,
        scope,
        queryVariants,
        noteIds:        scopeNoteIds,
        overrideNoteIds,
      }).catch((error) => {
        console.error('[pipeline] ERROR in hybridSearch:', error)
        return { results: [], excludedTitleMatches: [] }
      }),
    ])

    console.log(`[perf] titleDetect + hybridSearch parallel: ${(performance.now() - t0).toFixed(0)}ms`)
    onStatus?.(hybridSearchResult.results.length > 0
      ? `Found ${hybridSearchResult.results.length} matches — expanding context…`
      : "No matches found…"
    )
    console.log('[pipeline] titleDetect results:', {
      matchesCount:         titleDetect.matches.length,
      excludedMatchesCount: titleDetect.excludedMatches.length,
      candidateFound:       titleDetect.candidateFound,
    })
    console.log('[pipeline] Hybrid search completed:', {
      resultsCount:  hybridSearchResult.results.length,
      semanticCount: hybridSearchResult.results.filter(r => r.matched_by.includes("semantic")).length,
      keywordCount:  hybridSearchResult.results.filter(r => r.matched_by.includes("keyword")).length,
    })

    const excludedOverridden = titleDetect.excludedMatches.some(
      (e) => (overrideNoteIds ?? []).includes(e.note_id)
    )

    const effectiveTitleMatches: TitleMatch[] = titleDetect.matches.length > 0
      ? titleDetect.matches
      : excludedOverridden
        ? titleDetect.excludedMatches
            .filter((e) => (overrideNoteIds ?? []).includes(e.note_id))
            .map((e) => ({ noteId: e.note_id, noteTitle: e.note_title }))
        : []

    if (!isDeicticQuery && titleDetect.candidateFound && effectiveTitleMatches.length === 0 && !excludedOverridden) {
      const errorMessage = titleDetect.excludedMatches.length > 0
        ? `No results found — "${titleDetect.excludedMatches[0].note_title}" may be relevant but is excluded from search.`
        : "No note with that title was found in your vault."
      return {
        excerptBlock:        errorMessage,
        sourceTitles:        [],
        sourceNoteIds:       [],
        usedEmbeddings:      false,
        confidence:          "high",
        tier1Cards:          [],
        inventoryMode:       false,
        excludedNoteNotices: titleDetect.excludedMatches,
        titleMatchedNoteIds: [],
        isTitleDirected:     true,
        topScore:            0,
        chunkCount:          0,
        detectedIntent:      intent,
      }
    }

    let titleChunks:         HybridResult[] = []
    let titleNotice:         string         = ""
    let titleMatchedNoteIds: string[]       = []

    if (effectiveTitleMatches.length > 0) {
      console.log('[pipeline] Fetching chunks for title matches')
      const maxChars = Math.floor(MAX_CONTEXT_CHARS * 0.6)
      const { chunks, noticeText } = await fetchTitleMatchChunks(effectiveTitleMatches, maxChars)
      titleChunks         = chunks
      titleNotice         = noticeText
      titleMatchedNoteIds = effectiveTitleMatches.map((m) => m.noteId)

      if (titleChunks.length === 0) {
        return {
          excerptBlock:        `The note "${effectiveTitleMatches[0].noteTitle}" exists but contains no content.`,
          sourceTitles:        effectiveTitleMatches.map((m) => m.noteTitle),
          sourceNoteIds:       effectiveTitleMatches.map((m) => m.noteId),
          usedEmbeddings:      false,
          confidence:          "high",
          tier1Cards:          [],
          inventoryMode:       false,
          excludedNoteNotices: excludedOverridden ? [] : titleDetect.excludedMatches,
          titleMatchedNoteIds,
          isTitleDirected:     true,
          topScore:            1,
          chunkCount:          0,
          detectedIntent:      intent,
        }
      }
    }

    // Unpack hybrid results
    let results: HybridResult[]              = hybridSearchResult.results
    let usedEmbeddings                        = results.some((r) => r.matched_by.includes("semantic"))
    let hybridExcludedNotices: ExcludedTitleMatch[] = hybridSearchResult.excludedTitleMatches

    if (results.length > 0) {
      // When scoped, drop weak matches — prevents hallucination from thin evidence
      if (scopeNoteIds && scopeNoteIds.length > 0) {
        const before = results.length
        results = results.filter((r) => r.final_score >= 0.01)
        console.log('[pipeline] Scoped score cutoff: dropped', before - results.length, 'weak results, kept', results.length)
      }
      console.log('[pipeline] Expanding context for', results.length, 'results')
      results = await expandContext(results)
      console.log(`[perf] expandContext: ${(performance.now() - t0).toFixed(0)}ms`)
      console.log('[pipeline] Context expansion completed, now', results.length, 'results')
    }

    const titleBlockIds = new Set(titleChunks.map((c) => c.block_id))
    const hybridOnly    = results.filter((r) => !titleBlockIds.has(r.block_id))
    const merged        = [...titleChunks, ...hybridOnly]

    console.log('[pipeline] Merging results:', {
      titleChunksCount: titleChunks.length,
      hybridOnlyCount:  hybridOnly.length,
      mergedCount:      merged.length,
    })

    const chunkTitles  = merged.map((r) => r.note_title)
    const chunkNoteIds = merged.map((r) => r.note_id)
    const confidence   = merged[0]?.confidence ?? "low"

    const { block: excerptBlock, includedCount } = buildExcerptBlock(merged)

    // Slice source arrays to only what the model actually saw inside the 12k cap.
    // Prevents filterSourcesByCitations from resolving [N] markers to notes
    // that were retrieved but never included in the prompt.
    const visibleTitles  = chunkTitles.slice(0, includedCount)
    const visibleNoteIds = chunkNoteIds.slice(0, includedCount)

    console.log('[pipeline] Building final response:', {
      totalChunks:      merged.length,
      includedInPrompt: includedCount,
      confidence,
      topScore:         merged[0]?.final_score ?? 0,
      uniqueNoteCount:  new Set(visibleNoteIds).size,
      noteDistribution: visibleTitles.reduce((acc, title) => {
        acc[title] = (acc[title] || 0) + 1
        return acc
      }, {} as Record<string, number>)
    })

    const tier1Cards = buildTier1Cards(merged)

    const excludedNoteNotices: ExcludedTitleMatch[] = excludedOverridden
      ? []
      : [
          ...titleDetect.excludedMatches,
          ...hybridExcludedNotices.filter(
            (n) => !titleDetect.excludedMatches.some((e) => e.note_id === n.note_id)
          ),
        ]

    console.log('[pipeline] Excluded notices count:', excludedNoteNotices.length)

    const finalResult = {
      excerptBlock:        titleNotice ? `${titleNotice}\n\n${excerptBlock}` : excerptBlock,
      sourceTitles:        visibleTitles,
      sourceNoteIds:       visibleNoteIds,
      usedEmbeddings,
      confidence,
      tier1Cards,
      inventoryMode:       false,
      excludedNoteNotices,
      titleMatchedNoteIds,
      isTitleDirected:     effectiveTitleMatches.length > 0,
      topScore:            merged[0]?.final_score ?? 0,
      chunkCount:          merged.length,
      detectedIntent:      intent,
    }

    console.log(`[perf] pipeline total: ${(performance.now() - t0).toFixed(0)}ms`)
    console.log('[pipeline] ========== PIPELINE COMPLETE ==========')
    console.log('[pipeline] Final result summary:', {
      excerptBlockLength: finalResult.excerptBlock.length,
      sourceCount:        finalResult.sourceTitles.length,
      includedInPrompt:   includedCount,
      confidence:         finalResult.confidence,
      isTitleDirected:    finalResult.isTitleDirected,
      chunkCount:         finalResult.chunkCount,
      topScore:           finalResult.topScore,
      detectedIntent:     finalResult.detectedIntent,
    })

    return finalResult
  }


  
  // ─── Prompt builder ───────────────────────────────────────────────────────────

  function buildPrompt(
    query:        string,
    pipeline:     PipelineResult,
    historyBlock: string,
    currentNote?: Note,
    webResults?:  WebSearchResult[],
    injectVault?: boolean,
  ): string {
    const intent = pipeline.detectedIntent
    const historyBeforeQuestion = intent === "edit" || intent === "hybrid"

    const currentNoteBlock = currentNote
      ? `\nCurrently open note: "${currentNote.title}"`
      : ""

    const hasVault = injectVault && pipeline.excerptBlock && pipeline.chunkCount > 0
    const hasWeb   = webResults && webResults.length > 0

    const excerptSection = pipeline.inventoryMode
      ? pipeline.excerptBlock
      : hasVault
        ? `[NOTE AND VAULT EXCERPTS]\n${pipeline.excerptBlock}`
        : hasWeb
            ? "(No matching content found in your notes — answering from web search only.)"
            : ""

    const titleDirectedInstruction = pipeline.isTitleDirected
      ? `The user is asking about a specific note by title. Prioritise excerpts from the directly matched note(s) and answer from their content. Do not speculate beyond what those excerpts contain.\n`
      : ""

    const combinedSourceInstruction = hasVault && hasWeb
      ? `You have access to both the user's personal notes and live web search results.
  Cite vault excerpts as [N] and web results as [web:N].
  When vault excerpts and web results cover the same topic, compare them explicitly.
  If they contradict each other, flag the discrepancy — do not silently favour one source.
  Prefer vault content for personal context and decisions; prefer web content for current facts and external information.\n`
      : hasWeb
        ? `You have access to live web search results. Cite them as [web:N].\n`
        : ""

    return `You are an assistant with access to the user's personal notes vault.
  ${titleDirectedInstruction}${combinedSourceInstruction}You will be given numbered excerpts [1], [2], [3]... from different notes.
  Read ALL excerpts carefully before forming your answer — the relevant information may appear in any excerpt, not just the first ones.
  Cite every note excerpt you draw from using its number: [1], [2] etc.
  When using web search results, cite them as [web:1], [web:2] etc.
  Excerpts include a location path (e.g. "Projects / Vitobu / Day 1") — use this to give context about where information lives when it adds clarity.
  Synthesise across excerpts when the answer is spread across multiple notes.
  When multiple retrieved notes point to the same underlying theme or project, synthesise across them rather than listing them separately.
  When the current question connects to topics already in the conversation history, draw that connection explicitly.
  You may make inferences well-supported by the retrieved content — state them explicitly as inferences using language like "this suggests" or "taken together, these notes indicate". Never cite a source for an inference not directly stated in that source.
  If after reading ALL excerpts the information is genuinely absent, say so in one sentence. Do not say information is unavailable if it appears anywhere in the excerpts, even partially.
  When the question appears to be a follow-up, clarification, or reference to something already discussed (e.g. "are you sure", "cross check that", "verify those figures", "was that correct"), resolve it primarily from the conversation history above before searching the vault. Do not treat it as a new independent query.
  Never mention the vault or note system unless the user's question is specifically about their notes.
  Format your response using markdown:
  - Use **bold** for key terms and important concepts
  - Use headers (## or ###) only when the response covers multiple distinct topics; never use h1
  - Always use fenced code blocks with the correct language tag for any code
  - Use bullet points for lists of 3 or more items; use prose for shorter enumerations
  - Match response length to the question — a simple question gets a short answer, a complex one gets a thorough one; never pad
  - Place citations inline immediately after the claim they support
  - Never restate the question, summarise what you just said, or add filler closing sentences
  ${!historyBeforeQuestion && historyBlock ? `[CONVERSATION HISTORY]\n${historyBlock}\n` : ""}
  ${hasVault ? `[EXCERPTS FROM YOUR NOTES]\n${excerptSection}\n` : excerptSection ? `${excerptSection}\n` : ""}
  ${currentNoteBlock ? `[CURRENTLY OPEN NOTE]\nUse this as additional context. Do not cite it with a number — refer to it as "current note" if relevant.\n${currentNoteBlock}\n` : ""}
  ${hasWeb ? buildWebResultsBlock(webResults!) : ""}
  ${historyBeforeQuestion && historyBlock ? `[CONVERSATION HISTORY]\n${historyBlock}\n` : ""}
  [QUESTION]
  ${query}

  Answer:`
  }


  // ─── Streaming chat (primary path) ───────────────────────────────────────────

  export async function streamChatWithNotes(
    query:             string,
    _allNotes:         Note[],
    noteId:            string,
    currentNote:       Note | undefined,
    scopeNoteIds:      string[] | undefined,
    streaming:         StreamingChatOptions,
    overrideNoteIds?:  string[],
    webResults?:       WebSearchResult[],
    prebuiltPipeline?: PipelineResult,
    sessionMessages?:  ChatMessage[],   // NEW — pass store messages directly
  ): Promise<Omit<ChatResult, "answer">> {

    // Declare assembled early to avoid TDZ errors
    let assembled = ""

    // Tier 1 — no AI key configured
    if (!isAIReady()) {
      const pipeline   = await runPipeline(query, currentNote, scopeNoteIds, overrideNoteIds)
      const tier1Cards = pipeline.tier1Cards

      const summary = tier1Cards.length > 0
        ? `Found ${tier1Cards.length} relevant section${tier1Cards.length > 1 ? "s" : ""} in your notes.`
        : "No matching content found in your notes."

      streaming.onChunk(summary)
      streaming.onDone?.()

      return {
        sourceTitles:        pipeline.sourceTitles,
        sourceNoteIds:       pipeline.sourceNoteIds,
        usedEmbeddings:      pipeline.usedEmbeddings,
        confidence:          pipeline.confidence,
        relatedNotes:        [],
        tier1Results:        tier1Cards,
        excludedNoteNotices: pipeline.excludedNoteNotices,
        titleMatchedNoteIds: pipeline.titleMatchedNoteIds,
        webNudge:            deriveWebNudge(pipeline, undefined, false),
      }
    }

    // Tier 2 — full AI pipeline
    // Run history and pipeline in parallel regardless of web results
    streaming.onStatus?.("Searching your notes…")

    // Detect intent for budget allocation
    const { intent, isPersonal, isFollowUp } = await detectIntent(query)
    const budget     = allocateBudget(intent)

// after
    const [historyBlock, pipeline] = await Promise.all([
      buildHistoryBlock(noteId, budget.historyChars, sessionMessages),
      prebuiltPipeline
        ? Promise.resolve(prebuiltPipeline)
        : runPipeline(query, currentNote, scopeNoteIds, overrideNoteIds, streaming.onStatus),
    ])

    // If sessionMessages were passed but historyBlock came back empty,
    // build it directly from sessionMessages without the DB round-trip.
    // This handles the case where Q1's response hasn't been persisted yet.
    const effectiveHistoryBlock = (historyBlock.length === 0 && sessionMessages && sessionMessages.length > 0)
      ? `\n[Recent conversation]\n${sessionMessages
          .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
          .join("\n")}\n`
      : historyBlock

    // Status after pipeline resolves
    if (webResults && webResults.length > 0) {
      streaming.onStatus?.("Searching the web…")
    } else if (pipeline.chunkCount === 0) {
      streaming.onStatus?.("No matches found…")
    } else if (pipeline.chunkCount === 1) {
      streaming.onStatus?.("Found 1 relevant note…")
    } else {
      streaming.onStatus?.(`Found ${pipeline.chunkCount} relevant chunks…`)
    }

    // AFTER pipeline resolves, before building the prompt:
    // PATCH START — Scoped empty routing
    const isScopedSearch = scopeNoteIds && scopeNoteIds.length > 0
    const scopedButEmpty = isScopedSearch && pipeline.chunkCount === 0

    if (scopedButEmpty && !pipeline.inventoryMode && (!webResults || webResults.length === 0)) {
      console.log('[streamChat] scoped search returned 0 chunks — routing to history/general knowledge')

      const generalPrompt = `You are a helpful assistant engaged in an ongoing conversation.
  ${historyBlock ? `[CONVERSATION HISTORY]\n${historyBlock}\n` : ""}
  The user's notes scoped to the current context contain no matching content for this query.
  Answer from your general knowledge and the conversation history above.
  Do not mention notes, vaults, or any note-taking system unless the user specifically asks about them.

  [QUESTION]
  ${query}

  Answer:`

      const messages: ProviderMessage[] = [{ role: "user", content: generalPrompt }]
      streaming.onStatus?.("Generating answer…")

      try {
        const result = await callPrimary(messages)
        assembled    = result.text
        streaming.onChunk(assembled)
        await appendAIHistory(noteId, "user",      query)
        await appendAIHistory(noteId, "assistant", assembled)
        streaming.onDone?.()
      } catch (err: unknown) {
        streaming.onError?.(err as AICallError)
      }

      return {
        sourceTitles:        [],
        sourceNoteIds:       [],
        usedEmbeddings:      false,
        confidence:          "low",
        relatedNotes:        [],
        excludedNoteNotices: pipeline.excludedNoteNotices,
        titleMatchedNoteIds: pipeline.titleMatchedNoteIds,
        webNudge:            undefined,   // don't nudge web search on scoped misses
      }
    }
    // PATCH END — Scoped empty routing

    // Special handling for edit intent — use history directly, no vault injection
    if (intent === "edit") {
      console.log('[streamChat] EDIT INTENT — using conversation history only')
      
      // Build prompt for edit (no vault content)
      const editPrompt = buildEditPrompt(query, historyBlock, sessionMessages)
      const messages: ProviderMessage[] = [{ role: "user", content: editPrompt }]
      
      streaming.onStatus?.("Applying changes…")
      
      try {
        const result = await callPrimary(messages)
        assembled = result.text
        
        streaming.onChunk(assembled)
        
        await appendAIHistory(noteId, "user", query)
        await appendAIHistory(noteId, "assistant", assembled)
        
        const history = await getAIHistory(noteId)
        if (history.length >= 6) {
          const existingRow = await getConversationSummary(noteId)
          const droppedLines = [
            `User: ${query}`,
            `Assistant: ${assembled.slice(0, 300)}`,
          ].join("\n")
          updateRollingSummary(noteId, droppedLines, existingRow?.summary ?? null)
        }
        
        streaming.onDone?.()
      } catch (err: unknown) {
        streaming.onError?.(err as AICallError)
      }
      
      return {
        sourceTitles:        [],
        sourceNoteIds:       [],
        usedEmbeddings:      false,
        confidence:          "high",
        relatedNotes:        [],
        excludedNoteNotices: [],
        titleMatchedNoteIds: [],
        webNudge:            undefined,  
        webGrounded:         false,
      }
    }



    // Gate vault injection — only inject when retrieval was meaningful
    // Follow-up gate — suppress vault entirely, answer from history only
    if (isFollowUp) {
      console.log('[streamChat] FOLLOWUP INTENT — using conversation history only, suppressing vault')
// after
 // after
      console.log('[followUp] historyBlock length:', effectiveHistoryBlock.length)
      console.log('[followUp] historyBlock preview:', effectiveHistoryBlock.slice(0, 200))

      // ── Step 1: Extract verifiable claims as targeted search queries ──────
      let followUpWebResults: WebSearchResult[] = []
      let followUpWebGrounded = false

      try {
        streaming.onStatus?.("Identifying claims to verify…")

        const claimExtractionPrompt = `You are a research assistant. Given the conversation below, extract up to 3 specific, verifiable factual claims that could be checked against current real-world data (e.g. pricing, specs, limits, costs).

Return ONLY a valid JSON array of short search query strings — no markdown, no explanation, no backticks.
Each query should be specific and searchable (e.g. "Railway starter plan pricing 2026", "Supabase Pro plan cost 2026").
If there are no verifiable external facts (e.g. purely opinion or personal content), return an empty array [].

Conversation:
${effectiveHistoryBlock}

JSON array of search queries:`

        let searchQueries: string[] = []

        try {
          const raw     = await promptProcessing(claimExtractionPrompt)
          const clean   = raw.replace(/```json|```/g, "").trim()
          const parsed  = JSON.parse(clean)
          if (Array.isArray(parsed) && parsed.every((q) => typeof q === "string")) {
            searchQueries = parsed.slice(0, 3)
          }
          console.log('[followUp] extracted search queries:', searchQueries)
        } catch (extractErr) {
          // Fallback — extract noun phrases from last assistant message
          console.warn('[followUp] claim extraction failed — using noun phrase fallback:', extractErr)
          const lastAssistant = effectiveHistoryBlock
            .split("\n")
            .filter((l) => l.startsWith("Assistant:"))
            .pop() ?? ""
          const nounPhrases = lastAssistant
            .replace(/Assistant:\s*/, "")
            .replace(/\*\*|__|~~|\[.*?\]/g, "")
            .match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b|\$[\d,]+(?:\/month)?|\d+(?:,\d+)*\s*(?:students|users)/g)
            ?? []
          const dedupedPhrases = [...new Set(nounPhrases)].slice(0, 3)
          searchQueries = dedupedPhrases.length > 0
            ? dedupedPhrases.map((p) => `${p} pricing 2026`)
            : []
          console.log('[followUp] fallback search queries:', searchQueries)
        }

        // ── Step 2: Fire searches in parallel ────────────────────────────────
        if (searchQueries.length > 0) {
          streaming.onStatus?.("Checking against live data…")
          const provider = getWebSearchProvider()
          const allResults = await Promise.all(
            searchQueries.map((q) => provider.search(q).catch(() => [] as WebSearchResult[]))
          )

          // Merge + deduplicate by URL
          const seen = new Set<string>()
          for (const resultSet of allResults) {
            for (const r of resultSet) {
              if (!seen.has(r.url)) {
                seen.add(r.url)
                followUpWebResults.push(r)
              }
            }
          }
          followUpWebResults = followUpWebResults.slice(0, 8)
          followUpWebGrounded = followUpWebResults.length > 0
          console.log('[followUp] web results count:', followUpWebResults.length)
        }
      } catch (webErr) {
        console.warn('[followUp] web search step failed — proceeding without web results:', webErr)
      }

      // ── Step 3: Build prompt with history + web results ───────────────────
      const webBlock = followUpWebResults.length > 0
        ? buildWebResultsBlock(followUpWebResults)
        : ""

      const followUpPrompt = `You are a knowledgeable assistant engaged in an ongoing conversation.
${effectiveHistoryBlock ? `[CONVERSATION HISTORY]\n${effectiveHistoryBlock}\n` : ""}
The user is asking you to verify, cross-check, or confirm something from the conversation above.
${webBlock ? `You have access to live web search results to verify factual claims.\nCompare the claims in the conversation history against the web results explicitly.\nIf they match, confirm it. If they conflict, flag the discrepancy clearly and state which source is more likely correct and why.\nCite web results as [web:1], [web:2] etc.\n` : "If the claims involve real-world facts (pricing, specs, external data) that you can reason about from general knowledge, do so and flag any uncertainty explicitly.\n"}Do not mention notes, vaults, or any note-taking system unless the user specifically asks.
${webBlock}
[QUESTION]
${query}

Answer:`

      const messages: ProviderMessage[] = [{ role: "user", content: followUpPrompt }]
      streaming.onStatus?.("Generating answer…")

      try {
        const result = await callPrimary(messages)
        assembled    = result.text
        streaming.onChunk(assembled)
        await appendAIHistory(noteId, "user",      query)
        await appendAIHistory(noteId, "assistant", assembled)
        streaming.onDone?.()
      } catch (err: unknown) {
        streaming.onError?.(err as AICallError)
      }

      return {
        sourceTitles:        [],
        sourceNoteIds:       [],
        usedEmbeddings:      false,
        confidence:          "high",
        relatedNotes:        [],
        excludedNoteNotices: [],
        titleMatchedNoteIds: [],
        webNudge:            undefined,
        webGrounded:         followUpWebGrounded,
      }
    }

    // Gate vault injection — only inject when retrieval was meaningful
const injectVault = (webResults && webResults.length > 0)
  ? pipeline.chunkCount > 0 && pipeline.confidence !== "low"
  : pipeline.chunkCount > 0 && pipeline.confidence !== "low"

// Low confidence + no personal signals — skip vault, answer from general knowledge
if (!injectVault && !pipeline.inventoryMode && (!webResults || webResults.length === 0) && !isPersonal) {
  console.log('[streamChat] low confidence + no personal signals — routing to general knowledge')
  streaming.onStatus?.("Nothing in your notes about this — answering from general knowledge…")

  const generalKnowledgePrompt = `You are a knowledgeable assistant. Answer the following question from your general knowledge. Do not mention notes, vaults, or any note-taking system.

[QUESTION]
${query}

Answer:`

  const messages: ProviderMessage[] = [{ role: "user", content: generalKnowledgePrompt }]

  try {
    const result = await callPrimary(messages)
    assembled    = result.text
    streaming.onChunk(assembled)
    await appendAIHistory(noteId, "user",      query)
    await appendAIHistory(noteId, "assistant", assembled)
    streaming.onDone?.()
  } catch (err: unknown) {
    streaming.onError?.(err as AICallError)
  }

  return {
    sourceTitles:        [],
    sourceNoteIds:       [],
    usedEmbeddings:      false,
    confidence:          "low",
    relatedNotes:        [],
    excludedNoteNotices: pipeline.excludedNoteNotices,
    titleMatchedNoteIds: pipeline.titleMatchedNoteIds,
    webNudge:            deriveWebNudge(pipeline, undefined, isPersonal),
  }
}

// Short-circuit — no chunks and no web results

    // Short-circuit — no chunks and no web results
    // If query has no personal signals, answer from general knowledge instead of
    // returning a vault-miss message (fixes Jay-Z / tree traversal / Ghana cases).
    if (pipeline.chunkCount === 0 && !pipeline.inventoryMode && (!webResults || webResults.length === 0)) {
      if (!isPersonal) {
        console.log('[streamChat] chunkCount=0, no personal signals — routing to general knowledge')
        // Fall through to model call with a general knowledge instruction injected
        const generalKnowledgePrompt = `You are a knowledgeable assistant. Answer the following question from your general knowledge. Do not mention notes, vaults, or any note-taking system.

  [QUESTION]
  ${query}

  Answer:`
        const messages: ProviderMessage[] = [{ role: "user", content: generalKnowledgePrompt }]
        streaming.onStatus?.("Generating answer…")
        try {
          const result = await callPrimary(messages)
          assembled    = result.text
          streaming.onChunk(assembled)
          await appendAIHistory(noteId, "user",      query)
          await appendAIHistory(noteId, "assistant", assembled)
          streaming.onDone?.()
        } catch (err: unknown) {
          streaming.onError?.(err as AICallError)
        }
        return {
          sourceTitles:        [],
          sourceNoteIds:       [],
          usedEmbeddings:      false,
          confidence:          "low",
          relatedNotes:        [],
          excludedNoteNotices: pipeline.excludedNoteNotices,
          titleMatchedNoteIds: pipeline.titleMatchedNoteIds,
          webNudge:            deriveWebNudge(pipeline, undefined, isPersonal),
        }
      }

      // Has personal signals — vault miss is meaningful, report it
      console.log('[streamChat] chunkCount=0 with isPersonal — short-circuiting')
      assembled = "I couldn't find anything relevant in your notes for that."
      streaming.onChunk(assembled)
      streaming.onDone?.()
      return {
        sourceTitles:        [],
        sourceNoteIds:       [],
        usedEmbeddings:      false,
        confidence:          "low",
        relatedNotes:        [],
        excludedNoteNotices: pipeline.excludedNoteNotices,
        titleMatchedNoteIds: pipeline.titleMatchedNoteIds,
        webNudge:            deriveWebNudge(pipeline, assembled, isPersonal),
      }
    }

    const prompt   = buildPrompt(query, pipeline, historyBlock, currentNote, webResults, injectVault)
    const messages: ProviderMessage[] = [{ role: "user", content: prompt }]

    streaming.onStatus?.("Generating answer…")

    try {
      const result = await callPrimary(messages)
      assembled    = result.text

      streaming.onChunk(assembled)

      await appendAIHistory(noteId, "user",      query)
      await appendAIHistory(noteId, "assistant", assembled)

      const history = await getAIHistory(noteId)
      if (history.length >= 6) {
        const existingRow  = await getConversationSummary(noteId)
        const droppedLines = [
          `User: ${query}`,
          `Assistant: ${assembled.slice(0, 300)}`,
        ].join("\n")
        updateRollingSummary(noteId, droppedLines, existingRow?.summary ?? null)
      }

      streaming.onDone?.()
    } catch (err: unknown) {
      streaming.onError?.(err as AICallError)
    }

    // Cross-note connection pass — skip on web-grounded responses
    const citedNoteIds = new Set(pipeline.sourceNoteIds)
    const relatedNotes = (pipeline.chunkCount === 0 || pipeline.confidence === "low" || (webResults && webResults.length > 0))
      ? []
      : await findRelatedNotes(
          assembled,
          citedNoteIds,
          currentNote?.id,
          pipeline.confidence,
        )

    // Filter sources to only notes the model actually cited with [N] markers
    const cited = extractCitedIndices(assembled)
    const { titles, noteIds } = filterSourcesByCitations(
      pipeline.sourceTitles,
      pipeline.sourceNoteIds,
      cited,
    )

    return {
      sourceTitles:        injectVault ? titles  : [],
      sourceNoteIds:       injectVault ? noteIds : [],
      usedEmbeddings:      pipeline.usedEmbeddings,
      confidence:          pipeline.confidence,
      relatedNotes,
      excludedNoteNotices: pipeline.excludedNoteNotices,
      titleMatchedNoteIds: pipeline.titleMatchedNoteIds,
      webNudge:            deriveWebNudge(pipeline, assembled, isPersonal),
      webGrounded:         webResults && webResults.length > 0 ? true : undefined,
    }
  }

  // ─── Non-streaming fallback ───────────────────────────────────────────────────

  export async function chatWithNotes(
    query:        string,
    _allNotes:    Note[],
    noteId:       string,
    currentNote?: Note,
    scopeNoteIds?: string[]
  ): Promise<ChatResult> {
    const [historyBlock, pipeline] = await Promise.all([
      buildHistoryBlock(noteId),
      runPipeline(query, currentNote, scopeNoteIds),
    ])

    const prompt = buildPrompt(query, pipeline, historyBlock, currentNote, undefined, true)
    const answer = await promptPrimary(prompt)

    await appendAIHistory(noteId, "user",      query)
    await appendAIHistory(noteId, "assistant", answer)

    const citedNoteIds = new Set(pipeline.sourceNoteIds)
    const relatedNotes = (pipeline.chunkCount === 0 || pipeline.confidence === "low")
    ? []
    : await findRelatedNotes(
        answer,
        citedNoteIds,
        currentNote?.id,
        pipeline.confidence,
      )

    // FIX: filter sources to only notes the model actually cited with [N] markers.
    const cited = extractCitedIndices(answer)
    const { titles, noteIds } = filterSourcesByCitations(
      pipeline.sourceTitles,
      pipeline.sourceNoteIds,
      cited,
    )

    return {
      answer,
      sourceTitles:        titles,
      sourceNoteIds:       noteIds,
      usedEmbeddings:      pipeline.usedEmbeddings,
      confidence:          pipeline.confidence,
      relatedNotes,
      tier1Results:        pipeline.tier1Cards,
      excludedNoteNotices: pipeline.excludedNoteNotices,
    }
  }