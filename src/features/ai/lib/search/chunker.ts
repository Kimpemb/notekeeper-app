// src/features/ai/lib/search/chunker.ts
//
// RAG v3 — heading-aware semantic chunker.
//
// Replaces walkIndexableBlocks in queries.ts. Accepts a TipTap JSON document
// and produces a flat list of chunks ready to be upserted into note_blocks.
//
// Key differences from v2 walkIndexableBlocks:
//   - chunk_heading: nearest ancestor heading text propagates to every block
//     in that section until the next heading of equal or higher level.
//   - chunk_index: position within the heading section (0-based).
//   - source_type: passed in by the caller ('note' | 'vault_entry').
//   - content_hash: SHA-256 of plaintext, used for hash-based skip in syncNoteBlocks.
//   - block_created_at / block_updated_at: read from the node's TipTap attrs
//     (set by BlockIdExtension). Fallback to Date.now() if missing (pre-v3 docs).
//   - Size guardrails: 200–400 token target per chunk, split at paragraph
//     boundaries only. Minimum 50 tokens for body chunks.
//   - Special block handling: code blocks whole, lists whole then split at
//     items if over limit, images/attachments by caption, etc.
//
// Token estimation: 1 token ≈ 4 chars (conservative for English prose).
// We use character counts throughout — no tokeniser dependency.

export type SourceType = "note" | "vault_entry";

export interface Chunk {
  blockId: string;
  blockType: string;
  plaintext: string;
  chunkHeading: string | null;
  chunkIndex: number;
  sourceType: SourceType;
  blockCreatedAt: number;
  blockUpdatedAt: number;
  contentHash: string;
}

// ── Token estimation ─────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4;
const TARGET_MAX = 400 * CHARS_PER_TOKEN; // 1600 chars
const BODY_MIN   =  50 * CHARS_PER_TOKEN; // 200 chars — skip smaller body chunks

// ── SHA-256 content hash ─────────────────────────────────────────────────────

export async function sha256(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Node types ───────────────────────────────────────────────────────────────

const HEADING_TYPES = new Set(["heading"]);

const SKIP_TYPES = new Set([
  "doc",
  "bulletList",
  "orderedList",
  "taskList",
]);

// Block types that should never be split even if over TARGET_MAX
const ATOMIC_TYPES = new Set([
  "codeBlock",
  "image",
  "attachment",
  "subPage",
  "noteLink",
]);

// ── Text extraction ───────────────────────────────────────────────────────────

type TipTapNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

function extractText(node: TipTapNode): string {
  if (node.text) return node.text;
  if (!node.content) {
    // Images and attachments: use alt or caption attrs
    if (node.type === "image" || node.type === "attachment") {
      const alt = node.attrs?.alt ?? node.attrs?.caption ?? node.attrs?.title ?? "";
      return String(alt);
    }
    // subPage and noteLink: use label attr
    if (node.type === "subPage" || node.type === "noteLink") {
      return String(node.attrs?.label ?? node.attrs?.title ?? "");
    }
    return "";
  }
  return node.content.map(extractText).join(" ").replace(/\s+/g, " ").trim();
}

// Extract heading level (1–6) from a heading node
function headingLevel(node: TipTapNode): number {
  return typeof node.attrs?.level === "number" ? node.attrs.level : 1;
}

// ── Heading stack ────────────────────────────────────────────────────────────
//
// Maintains a stack of { level, text } entries.
// When a heading is encountered, pop all entries at >= its level, then push.
// The current heading text is always the top of the stack.

interface HeadingEntry {
  level: number;
  text: string;
}

class HeadingStack {
  private stack: HeadingEntry[] = [];

  push(level: number, text: string): void {
    // Pop headings at equal or lower priority (higher or equal level number)
    while (this.stack.length > 0 && this.stack[this.stack.length - 1].level >= level) {
      this.stack.pop();
    }
    this.stack.push({ level, text });
  }

  current(): string | null {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1].text : null;
  }
}

// ── Section accumulator ──────────────────────────────────────────────────────
//
// Within a heading section, we accumulate candidate chunks. If a section
// grows past TARGET_MAX, we split at paragraph boundaries.

interface RawChunk {
  blockId: string;
  blockType: string;
  plaintext: string;
  blockCreatedAt: number;
  blockUpdatedAt: number;
}

// ── Main chunker ─────────────────────────────────────────────────────────────

export async function chunkDocument(
  contentJson: string,
  sourceType: SourceType
): Promise<Chunk[]> {
  let doc: TipTapNode;
  try {
    doc = JSON.parse(contentJson);
  } catch {
    return [];
  }

  if (!doc.content) return [];

  const now = Date.now();
  const headingStack = new HeadingStack();
  const chunks: Chunk[] = [];

  // Current heading section accumulator
  let sectionRaws: RawChunk[] = [];
  let sectionHeading: string | null = null;

  async function flushSection(): Promise<void> {
    if (sectionRaws.length === 0) return;

    // Merge raws into size-bounded chunks
    const merged = mergeRaws(sectionRaws);

    let index = 0;
    for (const raw of merged) {
      if (raw.plaintext.length < BODY_MIN) continue; // skip tiny chunks
      chunks.push({
        blockId: raw.blockId,
        blockType: raw.blockType,
        plaintext: raw.plaintext,
        chunkHeading: sectionHeading,
        chunkIndex: index++,
        sourceType,
        blockCreatedAt: raw.blockCreatedAt,
        blockUpdatedAt: raw.blockUpdatedAt,
        contentHash: await sha256(raw.plaintext),
      });
    }

    sectionRaws = [];
  }

  // Walk top-level nodes
  for (const node of doc.content) {
    await processNode(node, headingStack, sectionRaws, chunks, sourceType, now, flushSection, () => {
      sectionHeading = headingStack.current();
    });
  }

  // Flush any remaining section
  sectionHeading = headingStack.current();
  await flushSection();

  return chunks;
}

// ── Node processor ────────────────────────────────────────────────────────────

async function processNode(
  node: TipTapNode,
  headingStack: HeadingStack,
  sectionRaws: RawChunk[],
  chunks: Chunk[],
  sourceType: SourceType,
  now: number,
  flushSection: () => Promise<void>,
  onHeadingChange: () => void,
): Promise<void> {
  const { type } = node;

  // ── Headings: flush current section, update stack, emit heading as chunk ──
  if (HEADING_TYPES.has(type)) {
    await flushSection();
    const text = extractText(node);
    if (!text.trim()) return;

    headingStack.push(headingLevel(node), text);
    onHeadingChange();

    // Headings always get their own chunk regardless of size
    const blockId = String(node.attrs?.blockId ?? crypto.randomUUID());
    const blockCreatedAt = Number(node.attrs?.blockCreatedAt ?? now);
    const blockUpdatedAt = Number(node.attrs?.blockUpdatedAt ?? now);

    chunks.push({
      blockId,
      blockType: type,
      plaintext: text,
      chunkHeading: headingStack.current(),
      chunkIndex: 0,
      sourceType,
      blockCreatedAt,
      blockUpdatedAt,
      contentHash: await sha256(text),
    });
    return;
  }

  // ── Skip structural containers (recurse into children) ────────────────────
  if (SKIP_TYPES.has(type)) {
    if (node.content) {
      for (const child of node.content) {
        await processNode(child, headingStack, sectionRaws, chunks, sourceType, now, flushSection, onHeadingChange);
      }
    }
    return;
  }

  // ── Atomic types: always whole, never split ───────────────────────────────
  if (ATOMIC_TYPES.has(type)) {
    const text = extractText(node);
    if (!text.trim()) return;

    const blockId = String(node.attrs?.blockId ?? crypto.randomUUID());
    const blockCreatedAt = Number(node.attrs?.blockCreatedAt ?? now);
    const blockUpdatedAt = Number(node.attrs?.blockUpdatedAt ?? now);

    sectionRaws.push({ blockId, blockType: type, plaintext: text, blockCreatedAt, blockUpdatedAt });
    return;
  }

  // ── Toggle: treat toggleSummary as sub-heading, body as child chunks ──────
  if (type === "toggle") {
    if (!node.content) return;
    for (const child of node.content) {
      if (child.type === "toggleSummary") {
        // Flush current section and treat summary as a new sub-heading
        await flushSection();
        const text = extractText(child);
        if (!text.trim()) return;
        headingStack.push(6, text); // level 6 — always innermost
        onHeadingChange();
        const blockId = String(child.attrs?.blockId ?? crypto.randomUUID());
        const blockCreatedAt = Number(child.attrs?.blockCreatedAt ?? now);
        const blockUpdatedAt = Number(child.attrs?.blockUpdatedAt ?? now);
        chunks.push({
          blockId,
          blockType: "toggleSummary",
          plaintext: text,
          chunkHeading: headingStack.current(),
          chunkIndex: 0,
          sourceType,
          blockCreatedAt,
          blockUpdatedAt,
          contentHash: await sha256(text),
        });
      } else {
        await processNode(child, headingStack, sectionRaws, chunks, sourceType, now, flushSection, onHeadingChange);
      }
    }
    return;
  }

  // ── Callout: index as single chunk ────────────────────────────────────────
  if (type === "callout") {
    const text = extractText(node);
    if (!text.trim()) return;
    const blockId = String(node.attrs?.blockId ?? crypto.randomUUID());
    const blockCreatedAt = Number(node.attrs?.blockCreatedAt ?? now);
    const blockUpdatedAt = Number(node.attrs?.blockUpdatedAt ?? now);
    sectionRaws.push({ blockId, blockType: type, plaintext: text, blockCreatedAt, blockUpdatedAt });
    return;
  }

  // ── List items: add individually to section ───────────────────────────────
  if (type === "listItem" || type === "taskItem") {
    const text = extractText(node);
    if (!text.trim()) return;
    const blockId = String(node.attrs?.blockId ?? crypto.randomUUID());
    const blockCreatedAt = Number(node.attrs?.blockCreatedAt ?? now);
    const blockUpdatedAt = Number(node.attrs?.blockUpdatedAt ?? now);
    sectionRaws.push({ blockId, blockType: type, plaintext: text, blockCreatedAt, blockUpdatedAt });
    return;
  }

  // ── Default: paragraph, blockquote, etc. — add to section accumulator ─────
  const text = extractText(node);
  if (!text.trim()) return;

  const blockId = String(node.attrs?.blockId ?? crypto.randomUUID());
  const blockCreatedAt = Number(node.attrs?.blockCreatedAt ?? now);
  const blockUpdatedAt = Number(node.attrs?.blockUpdatedAt ?? now);

  sectionRaws.push({ blockId, blockType: type, plaintext: text, blockCreatedAt, blockUpdatedAt });
}

// ── Merge raws into size-bounded chunks ───────────────────────────────────────
//
// Strategy:
//   - Walk raws in order.
//   - Accumulate into a running chunk until it hits TARGET_MAX.
//   - When it would exceed TARGET_MAX, emit the current accumulation and start
//     a new one with the current raw.
//   - A single raw that is already over TARGET_MAX is emitted as-is (atomic).
//   - The blockId and timestamps of the FIRST raw in the group are used for
//     the merged chunk (stable identity for hash-based skipping).

function mergeRaws(raws: RawChunk[]): RawChunk[] {
  if (raws.length === 0) return [];

  const result: RawChunk[] = [];
  let acc: RawChunk | null = null;

  for (const raw of raws) {
    if (!acc) {
      acc = { ...raw };
      continue;
    }

    const combined: string = acc.plaintext + " " + raw.plaintext;


    if (combined.length <= TARGET_MAX) {
      // Fits — merge in, keep acc's blockId and timestamps
      acc = {
        ...acc,
        blockType: acc.blockType, // keep first block's type
        plaintext: combined,
        // blockUpdatedAt = latest of the two
        blockUpdatedAt: Math.max(acc.blockUpdatedAt, raw.blockUpdatedAt),
      };
    } else {
      // Doesn't fit — emit acc if it meets minimum, start new
      if (acc.plaintext.length >= BODY_MIN) {
        result.push(acc);
      }
      acc = { ...raw };
    }
  }

  if (acc && acc.plaintext.length >= BODY_MIN) {
    result.push(acc);
  }

  return result;
}