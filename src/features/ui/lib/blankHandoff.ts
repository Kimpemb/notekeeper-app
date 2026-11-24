// src/features/ui/lib/blankHandoff.ts
// Keeps the blank page on screen, as an overlay, while the real editor mounts
// underneath it, then fades it out once the editor has taken the caret.
import { useSyncExternalStore } from "react";

export type HandoffPhase = "idle" | "active" | "fading";

const FADE_MS = 150;
const FAILSAFE_MS = 800;

let phase: HandoffPhase = "idle";
let activePane: 1 | 2 | null = null;
let failsafeTimer: ReturnType<typeof setTimeout> | null = null;
let fadeTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function setState(next: HandoffPhase, pane: 1 | 2 | null) {
  phase = next;
  activePane = pane;
  emit();
}

function clearTimers() {
  if (failsafeTimer) clearTimeout(failsafeTimer);
  if (fadeTimer) clearTimeout(fadeTimer);
  failsafeTimer = null;
  fadeTimer = null;
}

function beginFade(pane: 1 | 2) {
  if (activePane !== pane || phase !== "active") return;
  clearTimers();
  setState("fading", pane);
  fadeTimer = setTimeout(() => {
    fadeTimer = null;
    setState("idle", null);
  }, FADE_MS + 30);
}

// Called by the blank page just before it creates a note.
export function startBlankHandoff(pane: 1 | 2): void {
  clearTimers();
  setState("active", pane);
  failsafeTimer = setTimeout(() => beginFade(pane), FAILSAFE_MS);
}

// Called by the editor once it has the caret. Waits two frames so the editor
// has painted before the overlay starts to fade. No-op when no hand-off is active.
export function finishBlankHandoff(pane: 1 | 2): void {
  if (activePane !== pane || phase !== "active") return;
  requestAnimationFrame(() => requestAnimationFrame(() => beginFade(pane)));
}

// Note creation failed: drop the overlay state immediately.
export function cancelBlankHandoff(): void {
  clearTimers();
  setState("idle", null);
}

export function isBlankHandoffActive(pane: 1 | 2): boolean {
  return activePane === pane && phase === "active";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useBlankHandoff(pane: 1 | 2): HandoffPhase {
  return useSyncExternalStore(
    subscribe,
    () => (activePane === pane ? phase : "idle"),
    () => "idle" as HandoffPhase,
  );
}