// src/features/ai/lib/client.ts
//
// Slot-aware AI client. Every AI call in the app routes through one of:
//   callPrimary()    — foreground user-facing chat
//   callProcessing() — background ops (query expansion, synthesis, summarisation)
//   callEmbedding()  — embedding requests, routed through the embedding provider
//
// Responsibilities:
//   - Resolve provider / model / key from the live store for the correct slot
//   - Dispatch to provider.ts (which calls the concrete provider implementation)
//   - Normalise all provider-specific errors into AICallError
//   - 429 classification via retry-after header — RPM vs RPD
//   - Rotation waterfall on RPD: model → key → provider → exhausted
//   - Embedding key rotation on RPD
//   - Background checker every 6 hours for exhausted keys/models
//   - Write every call outcome to debugLog.ts
//   - Never silently fall back — every failure surfaces a typed error
//
// This file does not import from chat.ts, indexer.ts, or semantic.ts.
// Those call sites import from here.

import { useAIStore }           from "@/features/ai/store/useAIStore";
import type { ProviderName, EmbeddingProvider, RotationSlot } from "@/features/ai/store/useAIStore";
import {
  callProviderChat,
  callProviderEmbed,
  providerSupports,
  type ProviderMessage,
  type ProviderChatResult,
} from "@/features/ai/lib/provider";
import { logCallOk, logCallError } from "@/features/ai/lib/debugLog";
import type { LogSlot }            from "@/features/ai/lib/debugLog";
import {
  atomicQuotaIncrement,
  logExhaustion,
  markRecovered,
} from "@/features/notes/db/queries";

// ─── Public types ─────────────────────────────────────────────────────────────

export type { ProviderMessage };

export type AIErrorCode =
  | "NETWORK_ERROR"       // fetch failed entirely — DNS, timeout, offline
  | "AUTH_FAILED"         // 401 / 403 — key invalid or lacks permission
  | "QUOTA_EXCEEDED"      // 429 RPD exhausted, or DeepSeek 402
  | "RATE_LIMITED"        // 429 transient RPM — retried internally
  | "OVERLOADED"          // 529 (Claude) — provider overloaded
  | "NO_KEY"              // no key configured for this provider
  | "NO_PROVIDER"         // slot has no provider assigned
  | "EMBED_UNSUPPORTED"   // provider does not support embeddings
  | "ALL_EXHAUSTED"       // all providers/keys exhausted
  | "UNKNOWN";

export class AICallError extends Error {
  constructor(
    public readonly code:     AIErrorCode,
    public readonly provider: string,
    public readonly model:    string,
    message:                  string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "AICallError";
  }

  get retryable(): boolean {
    return this.code === "RATE_LIMITED" || this.code === "OVERLOADED";
  }
}

// ─── RPM/RPD classification ───────────────────────────────────────────────────
//
// 429 is authoritative over internal quota counter per spec.
// retry-after ≤ 60s → RPM (transient)
// retry-after > 60s or absent → RPD (exhausted)
// On any ambiguity → treat as RPD (safer)

interface RateLimitInfo {
  type:         "rpm" | "rpd";
  retryAfterMs: number;
}

function classifyRateLimit(err: unknown): RateLimitInfo {
  const headers = (err as { headers?: Record<string, string> }).headers ?? {};
  const retryAfterRaw = headers["retry-after"] ?? headers["Retry-After"] ?? "";
  const retryAfterSec = retryAfterRaw ? parseFloat(retryAfterRaw) : NaN;

  if (!isNaN(retryAfterSec) && retryAfterSec <= 60) {
    return { type: "rpm", retryAfterMs: retryAfterSec * 1000 };
  }

  // Also check error body message for confirmation
  const message = (err as { message?: string }).message ?? "";
  const isRPM = message.toLowerCase().includes("rate limit") &&
                !message.toLowerCase().includes("quota") &&
                !isNaN(retryAfterSec) && retryAfterSec <= 60;

  if (isRPM) {
    return { type: "rpm", retryAfterMs: retryAfterSec * 1000 };
  }

  // Absent, ambiguous, or long retry-after → treat as RPD
  const retryMs = !isNaN(retryAfterSec) ? retryAfterSec * 1000 : 60_000;
  return { type: "rpd", retryAfterMs: retryMs };
}

// ─── Dev mode simulation ──────────────────────────────────────────────────────
//
// Set DEV_SIMULATE_429 = true to simulate a 429 RPD response without hitting
// the API. Makes the rotation waterfall testable without burning quota.

export let DEV_SIMULATE_429 = false;
export function setDev429Simulation(enabled: boolean): void {
  DEV_SIMULATE_429 = enabled;
}

// ─── Exhaustion tracking (runtime, per session) ───────────────────────────────
//
// Tracks which provider/model/key combinations are exhausted this session.
// Written to exhaustion_log in DB by logExhaustion(). Used by rotation
// waterfall to skip exhausted combinations without re-querying the DB on
// every call.

interface ExhaustedEntry {
  provider: ProviderName;
  model:    string;
  keyId:    string;
  slot:     string;
}

const exhaustedEntries: ExhaustedEntry[] = [];

function isExhausted(provider: ProviderName, model: string, keyId: string, slot: string): boolean {
  return exhaustedEntries.some(
    (e) => e.provider === provider && e.model === model &&
           e.keyId === keyId && e.slot === slot
  );
}

function markExhausted(provider: ProviderName, model: string, keyId: string, slot: string): void {
  if (!isExhausted(provider, model, keyId, slot)) {
    exhaustedEntries.push({ provider, model, keyId, slot });
  }
}

function clearExhausted(provider: ProviderName, model: string, keyId: string, slot: string): void {
  const idx = exhaustedEntries.findIndex(
    (e) => e.provider === provider && e.model === model &&
           e.keyId === keyId && e.slot === slot
  );
  if (idx !== -1) exhaustedEntries.splice(idx, 1);
}

// ─── Background checker ───────────────────────────────────────────────────────
//
// Runs every 6 hours while any key/model is exhausted.
// Fires a test request (max_tokens: 1, prompt: "Hi") per exhausted entry.
// On success → marks recovered in DB, clears from runtime exhaustion list.
// On failure → updates last_checked_at, stays exhausted.
// Test requests are quota-logged through atomicQuotaIncrement.

const CHECKER_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
let   checkerTimer: ReturnType<typeof setTimeout> | null = null;
let   checkerRunning = false;

// Subscribers notified when any recovery happens while QuotaExhausted card showing
type RecoveryCallback = (slot: RotationSlot) => void;
const recoveryCallbacks: RecoveryCallback[] = [];

export function onRecovery(cb: RecoveryCallback): () => void {
  recoveryCallbacks.push(cb);
  return () => {
    const idx = recoveryCallbacks.indexOf(cb);
    if (idx !== -1) recoveryCallbacks.splice(idx, 1);
  };
}

function notifyRecovery(slot: RotationSlot): void {
  recoveryCallbacks.forEach((cb) => cb(slot));
}

export function startBackgroundChecker(): void {
  if (checkerRunning) return;
  checkerRunning = true;
  scheduleNextCheck();
}

export function stopBackgroundChecker(): void {
  checkerRunning = false;
  if (checkerTimer) {
    clearTimeout(checkerTimer);
    checkerTimer = null;
  }
}

function scheduleNextCheck(): void {
  if (!checkerRunning) return;
  checkerTimer = setTimeout(async () => {
    await runCheckerPass();
    scheduleNextCheck();
  }, CHECKER_INTERVAL_MS);
}

async function runCheckerPass(): Promise<void> {
  if (exhaustedEntries.length === 0) {
    stopBackgroundChecker();
    return;
  }

  const store = useAIStore.getState();

  for (const entry of [...exhaustedEntries]) {
    const { provider, model, keyId, slot } = entry;
    const apiKey = store.getKeyById(provider as ProviderName, keyId);
    if (!apiKey) continue;

    // Quota-log the test request before firing
    const quotaResult = await atomicQuotaIncrement(
      provider, model, keyId, getRPDCeiling()
    );
    if (quotaResult === 'exhausted') continue; // skip test if ceiling still hit

    try {
      if (slot === "embedding") {
        await callProviderEmbed(provider as EmbeddingProvider, apiKey, "test", "RETRIEVAL_DOCUMENT");
      } else {
        await callProviderChat(
          provider as ProviderName, apiKey, model,
          [{ role: "user", content: "Hi" }],
          undefined,
          // @ts-ignore — max_tokens passed through options
          { max_tokens: 1 }
        );
      }

      // Success — mark recovered
      await markRecovered(provider, model, keyId, slot);
      clearExhausted(provider as ProviderName, model, keyId, slot);
      notifyRecovery(slot as RotationSlot);

    } catch {
      // Still exhausted — just update last_checked_at
      // logExhaustion already has the entry — no duplicate write needed
    }
  }
}

// ─── RPD ceiling helper ───────────────────────────────────────────────────────

function getRPDCeiling(): number {
  const throughput = useAIStore.getState().embeddingThroughput;
  return throughput === "unlocked" ? 5000 : 1000;
}

// ─── Retry config ─────────────────────────────────────────────────────────────

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS  = 1_000;

function backoffMs(attempt: number): number {
  return RETRY_BASE_MS * Math.pow(2, attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Error normalisation ──────────────────────────────────────────────────────

function normaliseError(err: unknown, provider: string, model: string): AICallError {
  if (err instanceof TypeError && err.message.toLowerCase().includes("fetch")) {
    return new AICallError("NETWORK_ERROR", provider, model,
      `Could not reach ${provider}. Check your connection.`);
  }

  const status: number = (err as { status?: number }).status ?? -1;

  if (status === 0) {
    return new AICallError("NETWORK_ERROR", provider, model,
      `Could not reach ${provider}. Check your connection.`);
  }

  if (status === 401 || status === 403) {
    return new AICallError("AUTH_FAILED", provider, model,
      `Your ${provider} API key was rejected. Update it in Settings.`);
  }

  if (status === 402) {
    return new AICallError("QUOTA_EXCEEDED", provider, model,
      `Your DeepSeek account balance is zero. Top up at platform.deepseek.com.`);
  }

  if (status === 429) {
    const code: string = (err as { code?: string }).code ?? "";
    if (code === "insufficient_quota") {
      return new AICallError("QUOTA_EXCEEDED", provider, model,
        `Your ${provider} quota is exhausted. Check your billing or switch providers.`);
    }
    const { type, retryAfterMs } = classifyRateLimit(err);
    if (type === "rpm") {
      return new AICallError("RATE_LIMITED", provider, model,
        `Too many requests to ${provider}. Retrying...`, retryAfterMs);
    }
    return new AICallError("QUOTA_EXCEEDED", provider, model,
      `${provider} daily quota reached.`, retryAfterMs);
  }

  if (status === 529) {
    return new AICallError("OVERLOADED", provider, model,
      `${provider} is overloaded. Retrying...`);
  }

  const message = err instanceof Error ? err.message : String(err);
  return new AICallError("UNKNOWN", provider, model, message);
}

// ─── Slot resolution ──────────────────────────────────────────────────────────

interface ResolvedSlot {
  provider: ProviderName;
  model:    string;
  apiKey:   string;
  keyId:    string;
}

function resolveSlot(slot: "primary" | "processing"): ResolvedSlot {
  const state    = useAIStore.getState();
  const rotation = state.getRotationState(slot);

  const provider = rotation.provider;
  const model    = rotation.model;
  const keyId    = rotation.keyId ?? state.getActiveKeyId(provider);

  if (!keyId) {
    throw new AICallError("NO_KEY", provider, model,
      `No API key configured for ${provider}. Add one in Settings → AI.`);
  }

  const apiKey = state.getKeyById(provider, keyId);
  if (!apiKey) {
    throw new AICallError("NO_KEY", provider, model,
      `No API key configured for ${provider}. Add one in Settings → AI.`);
  }

  return { provider, model, apiKey, keyId };
}

function resolveEmbeddingSlot(): {
  provider: EmbeddingProvider;
  apiKey:   string;
  keyId:    string;
} {
  const state    = useAIStore.getState();
  const provider = state.embeddingProvider;

  if (!providerSupports(provider, "embedding")) {
    throw new AICallError("EMBED_UNSUPPORTED", provider, "embedding",
      `${provider} does not support embeddings.`);
  }

  const keyId  = state.embeddingActiveKeyId ?? state.getActiveKeyId(provider as ProviderName);
  if (!keyId) {
    throw new AICallError("NO_KEY", provider, "embedding",
      `No API key configured for ${provider}. Add one in Settings → AI.`);
  }

  const apiKey = state.getKeyById(provider as ProviderName, keyId);
  if (!apiKey) {
    throw new AICallError("NO_KEY", provider, "embedding",
      `No API key configured for ${provider}. Add one in Settings → AI.`);
  }

  return { provider, apiKey, keyId };
}

// ─── Slot persist helper ──────────────────────────────────────────────────────
//
// Called after every rotation step to keep primarySlot / processingSlot in
// sync with primaryRotation / processingRotation. Without this the slot keyId
// survives in persisted settings pointing at the old key, so a restart reverts
// to the exhausted key even though rotation already moved past it.

async function persistSlotKeyId(
  slot:     "primary" | "processing",
  provider: ProviderName,
  model:    string,
  keyId:    string,
): Promise<void> {
  const store = useAIStore.getState();
  if (slot === "primary") {
    await store.setPrimarySlot({ provider, model, keyId });
  } else {
    await store.setProcessingSlot({ provider, model, keyId });
  }
}

// ─── Rotation waterfall — chat/processing slots ───────────────────────────────
//
// Called when RPD is hit on a chat or processing slot.
// Step 1 — next model, same provider, same key
// Step 2 — same provider, next key
// Step 3 — next provider in rotation order
// Step 4 — all exhausted → throw ALL_EXHAUSTED
//
// After each step, persistSlotKeyId() is called so the persisted slot stays in
// sync with the live rotation state. This prevents a restart from reverting to
// the exhausted key/provider.

async function rotateSlot(
  slot:     "primary" | "processing",
  provider: ProviderName,
  model:    string,
  keyId:    string,
): Promise<{ provider: ProviderName; model: string; keyId: string; apiKey: string } | null> {
  const store   = useAIStore.getState();
  const logSlot = slot;

  // Write exhaustion for current model/key
  await logExhaustion(provider, model, keyId, logSlot, "rpd");
  markExhausted(provider, model, keyId, logSlot);

  // Step 1 — next model, same provider, same key
  const nextModel = store.getNextModelForProvider(provider, model,
    exhaustedEntries
      .filter((e) => e.provider === provider && e.keyId === keyId && e.slot === logSlot)
      .map((e) => e.model)
  );

  if (nextModel) {
    store.setRotationState(slot, { provider, model: nextModel, keyId });
    await persistSlotKeyId(slot, provider, nextModel, keyId);
    console.info(`[rotate:${slot}] step1 — model ${model} → ${nextModel} (key ${keyId})`);
    return {
      provider,
      model:   nextModel,
      keyId,
      apiKey:  store.getKeyById(provider, keyId)!,
    };
  }

  // Step 2 — same provider, next key
  const exhaustedKeyIds = exhaustedEntries
    .filter((e) => e.provider === provider && e.slot === logSlot)
    .map((e) => e.keyId);

  const nextKeyId = store.getNextKeyForProvider(provider, exhaustedKeyIds);

  if (nextKeyId) {
    // Reset model rotation for the new key
    const firstModel  = store.getNextModelForProvider(provider, "", []);
    const targetModel = firstModel ?? model;
    store.setRotationState(slot, { provider, model: targetModel, keyId: nextKeyId });
    await persistSlotKeyId(slot, provider, targetModel, nextKeyId);
    console.info(`[rotate:${slot}] step2 — key ${keyId} → ${nextKeyId} (${provider})`);
    return {
      provider,
      model:   targetModel,
      keyId:   nextKeyId,
      apiKey:  store.getKeyById(provider, nextKeyId)!,
    };
  }

  // Step 3 — next provider
  const nextProvider = store.getNextProvider(provider, slot);

  if (nextProvider) {
    const nextProviderKeyId = store.getNextKeyForProvider(nextProvider, []);
    if (nextProviderKeyId) {
      const firstModel  = store.getNextModelForProvider(nextProvider, "", []);
      const targetModel = firstModel ?? model;
      store.setRotationState(slot, {
        provider: nextProvider,
        model:    targetModel,
        keyId:    nextProviderKeyId,
      });
      await persistSlotKeyId(slot, nextProvider, targetModel, nextProviderKeyId);
      console.info(`[rotate:${slot}] step3 — provider ${provider} → ${nextProvider}`);
      return {
        provider: nextProvider,
        model:    targetModel,
        keyId:    nextProviderKeyId,
        apiKey:   store.getKeyById(nextProvider, nextProviderKeyId)!,
      };
    }
  }

  // Step 4 — all exhausted
  console.warn(`[rotate:${slot}] step4 — all providers exhausted`);
  return null;
}

// ─── Rotation waterfall — embedding slot ──────────────────────────────────────
//
// Embedding model never changes — only key rotates.
// On RPD: write exhaustion, find next Gemini key, switch or pause indexer.
// setEmbeddingActiveKey now also updates providers[embeddingProvider].activeKeyId
// and persists, so the new key survives a restart.

async function rotateEmbeddingKey(
  provider: EmbeddingProvider,
  keyId:    string,
): Promise<{ apiKey: string; keyId: string } | null> {
  const store = useAIStore.getState();

  await logExhaustion(provider, "gemini-embedding-001", keyId, "embedding", "rpd");
  markExhausted(provider as ProviderName, "gemini-embedding-001", keyId, "embedding");

  const exhaustedKeyIds = exhaustedEntries
    .filter((e) => e.provider === provider && e.slot === "embedding")
    .map((e) => e.keyId);

  const nextKeyId = store.getNextKeyForProvider(provider as ProviderName, exhaustedKeyIds);

  if (nextKeyId) {
    // setEmbeddingActiveKey now persists via providers[provider].activeKeyId
    store.setEmbeddingActiveKey(nextKeyId);
    console.info(`[rotate:embedding] key ${keyId} → ${nextKeyId}`);
    return {
      keyId:   nextKeyId,
      apiKey:  store.getKeyById(provider as ProviderName, nextKeyId)!,
    };
  }

  // No keys available — indexer will be paused by callEmbedding caller
  console.warn(`[rotate:embedding] all embedding keys exhausted`);
  return null;
}

// ─── Core dispatcher — chat slots ────────────────────────────────────────────

async function dispatchChat(
  slot:     "primary" | "processing",
  logSlot:  LogSlot,
  messages: ProviderMessage[],
  system?:  string,
): Promise<ProviderChatResult> {
  let { provider, model, apiKey, keyId } = resolveSlot(slot);

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    const t0 = Date.now();

    // Dev simulation
    if (DEV_SIMULATE_429) {
      const rotated = await rotateSlot(slot, provider, model, keyId);
      if (!rotated) {
        throw new AICallError("ALL_EXHAUSTED", provider, model,
          "All providers exhausted. Add a new key or wait for quota reset.");
      }
      ({ provider, model, keyId, apiKey } = rotated);
      DEV_SIMULATE_429 = false;
      continue;
    }

    try {
      const result = await callProviderChat(provider, apiKey, model, messages, system);

      logCallOk({
        slot:         logSlot,
        provider,
        model,
        inputTokens:  result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs:    Date.now() - t0,
      });

      return result;

    } catch (err) {
      const latencyMs  = Date.now() - t0;
      const normalised = normaliseError(err, provider, model);

      // RPM — wait retry-after and retry same model/key
      if (normalised.code === "RATE_LIMITED") {
        const waitMs = normalised.retryAfterMs ?? backoffMs(attempt);
        logCallError({
          slot: logSlot, provider, model, latencyMs,
          errorCode:    normalised.code,
          errorMessage: `${normalised.message} — waiting ${waitMs}ms`,
        });
        await sleep(waitMs);
        continue; // retry same model/key — if RPM again next iteration escalates via non-retryable
      }

      // RPD / QUOTA_EXCEEDED — rotate
      if (normalised.code === "QUOTA_EXCEEDED") {
        logCallError({
          slot: logSlot, provider, model, latencyMs,
          errorCode:    normalised.code,
          errorMessage: normalised.message,
        });

        const rotated = await rotateSlot(slot, provider, model, keyId);

        if (!rotated) {
          startBackgroundChecker();
          throw new AICallError("ALL_EXHAUSTED", provider, model,
            "All providers exhausted. Add a new key or wait for quota reset.");
        }

        ({ provider, model, keyId, apiKey } = rotated);
        attempt = -1; // reset attempt counter for new model/key/provider
        continue;
      }

      // Non-retryable (AUTH_FAILED, NETWORK_ERROR, etc.)
      logCallError({
        slot: logSlot, provider, model, latencyMs,
        errorCode:    normalised.code,
        errorMessage: normalised.message,
      });
      throw normalised;
    }
  }

  throw new AICallError("UNKNOWN", provider, model, "All retry attempts failed.");
}

// ─── Public call surface ──────────────────────────────────────────────────────

export async function callPrimary(
  messages: ProviderMessage[],
  system?:  string,
): Promise<ProviderChatResult> {
  return dispatchChat("primary", "primary", messages, system);
}

export async function callProcessing(
  messages: ProviderMessage[],
  system?:  string,
): Promise<ProviderChatResult> {
  return dispatchChat("processing", "processing", messages, system);
}

// ─── Embedding call with rotation ────────────────────────────────────────────

// Subscribers for indexer pause/resume
type IndexerPauseCallback = (paused: boolean, newKeyLabel?: string) => void;
const indexerPauseCallbacks: IndexerPauseCallback[] = [];

export function onIndexerPause(cb: IndexerPauseCallback): () => void {
  indexerPauseCallbacks.push(cb);
  return () => {
    const idx = indexerPauseCallbacks.indexOf(cb);
    if (idx !== -1) indexerPauseCallbacks.splice(idx, 1);
  };
}

function notifyIndexerPause(paused: boolean, newKeyLabel?: string): void {
  indexerPauseCallbacks.forEach((cb) => cb(paused, newKeyLabel));
}

export async function callEmbedding(
  text:     string,
  taskType: string = "RETRIEVAL_DOCUMENT",
): Promise<Float32Array> {
  let { provider, apiKey, keyId } = resolveEmbeddingSlot();
  const model = "gemini-embedding-001";
  const t0    = Date.now();

  // Atomic quota pre-check
  const quotaResult = await atomicQuotaIncrement(provider, model, keyId, getRPDCeiling());

  if (quotaResult === 'exhausted') {
    // Pre-check failed — treat as RPD, rotate key
    const rotated = await rotateEmbeddingKey(provider, keyId);
    if (!rotated) {
      notifyIndexerPause(true);
      startBackgroundChecker();
      throw new AICallError("ALL_EXHAUSTED", provider, model,
        "All embedding keys exhausted — indexing paused.");
    }

    const store     = useAIStore.getState();
    const newLabel  = store.providers[provider as ProviderName]
      .keys.find((k) => k.id === rotated.keyId)?.label ?? rotated.keyId;
    notifyIndexerPause(false, newLabel);
    ({ apiKey, keyId } = rotated);

    // Re-check quota for new key
    const recheck = await atomicQuotaIncrement(provider, model, keyId, getRPDCeiling());
    if (recheck === 'exhausted') {
      notifyIndexerPause(true);
      startBackgroundChecker();
      throw new AICallError("ALL_EXHAUSTED", provider, model,
        "All embedding keys exhausted — indexing paused.");
    }
  }

  // Dev simulation
  if (DEV_SIMULATE_429) {
    DEV_SIMULATE_429 = false;
    const rotated = await rotateEmbeddingKey(provider, keyId);
    if (!rotated) {
      notifyIndexerPause(true);
      startBackgroundChecker();
      throw new AICallError("ALL_EXHAUSTED", provider, model,
        "All embedding keys exhausted — indexing paused.");
    }
    ({ apiKey, keyId } = rotated);
  }

  try {
    const vector = await callProviderEmbed(provider, apiKey, text, taskType);

    logCallOk({
      slot: "embedding", provider, model,
      inputTokens: 0, outputTokens: 0,
      latencyMs: Date.now() - t0,
    });

    useAIStore.getState().incrementRPD(provider as ProviderName);
    return vector;

  } catch (err) {
    const latencyMs  = Date.now() - t0;
    const normalised = normaliseError(err, provider, model);

    logCallError({
      slot: "embedding", provider, model, latencyMs,
      errorCode:    normalised.code,
      errorMessage: normalised.message,
    });

    // 429 is authoritative — rotate regardless of internal counter
    if (normalised.code === "QUOTA_EXCEEDED" || normalised.code === "RATE_LIMITED") {
      const { type } = classifyRateLimit(err);

      if (type === "rpm") {
        const waitMs = normalised.retryAfterMs ?? 60_000;
        await sleep(waitMs);
        // Retry once — if RPM again, escalate to RPD
        try {
          return await callProviderEmbed(provider, apiKey, text, taskType);
        } catch (err2) {
          const n2 = normaliseError(err2, provider, model);
          if (n2.code === "RATE_LIMITED" || n2.code === "QUOTA_EXCEEDED") {
            // Escalate to RPD rotation
          } else {
            throw n2;
          }
        }
      }

      // RPD rotation
      const rotated = await rotateEmbeddingKey(provider, keyId);
      if (!rotated) {
        notifyIndexerPause(true);
        startBackgroundChecker();
        throw new AICallError("ALL_EXHAUSTED", provider, model,
          "All embedding keys exhausted — indexing paused.");
      }

      const store    = useAIStore.getState();
      const newLabel = store.providers[provider as ProviderName]
        .keys.find((k) => k.id === rotated.keyId)?.label ?? rotated.keyId;
      notifyIndexerPause(false, newLabel);
      return callEmbedding(text, taskType); // retry with new key
    }

    throw normalised;
  }
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

export async function promptPrimary(
  prompt: string,
  system?: string,
): Promise<string> {
  const result = await callPrimary([{ role: "user", content: prompt }], system);
  return result.text;
}

export async function promptProcessing(
  prompt: string,
  system?: string,
): Promise<string> {
  const result = await callProcessing([{ role: "user", content: prompt }], system);
  return result.text;
}

// ─── Store readiness guard ────────────────────────────────────────────────────

export function isAIReady(): boolean {
  const state = useAIStore.getState();
  if (!state.enabled) return false;
  return state.hasAnyValidKey();
}

// ─── Manual switch helpers ────────────────────────────────────────────────────
//
// Called when user manually picks a provider/model in settings.
// Checks exhaustion state, warns if exhausted, allows override.
// On success clears exhaustion entry.

export async function manualSwitchSlot(
  slot:     "primary" | "processing",
  provider: ProviderName,
  model:    string,
  keyId:    string,
): Promise<{ wasExhausted: boolean }> {
  const store      = useAIStore.getState();
  const wasExhausted = isExhausted(provider, model, keyId, slot);

  store.setRotationState(slot, { provider, model, keyId });

  if (wasExhausted) {
    // Test request — if succeeds, clear exhaustion
    const apiKey = store.getKeyById(provider, keyId);
    if (apiKey) {
      try {
        await callProviderChat(provider, apiKey, model,
          [{ role: "user", content: "Hi" }]);
        await markRecovered(provider, model, keyId, slot);
        clearExhausted(provider, model, keyId, slot);
      } catch {
        // Still exhausted — rotation will handle it on next real call
      }
    }
  }

  return { wasExhausted };
}

export async function manualSwitchEmbeddingKey(
  keyId: string,
): Promise<{ wasExhausted: boolean }> {
  const store      = useAIStore.getState();
  const provider   = store.embeddingProvider;
  const model      = "gemini-embedding-001";
  const wasExhausted = isExhausted(provider as ProviderName, model, keyId, "embedding");

  store.setEmbeddingActiveKey(keyId);

  if (wasExhausted) {
    const apiKey = store.getKeyById(provider as ProviderName, keyId);
    if (apiKey) {
      try {
        await callProviderEmbed(provider, apiKey, "test", "RETRIEVAL_DOCUMENT");
        await markRecovered(provider, model, keyId, "embedding");
        clearExhausted(provider as ProviderName, model, keyId, "embedding");
      } catch {
        // Still exhausted
      }
    }
  }

  return { wasExhausted };
}