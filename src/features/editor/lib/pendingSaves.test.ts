// src/features/editor/lib/pendingSaves.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  registerEditor,
  beginSave,
  trackSave,
  openEditorCount,
  pendingSaveCount,
  waitForEditorsClosed,
  waitForSaves,
  resetPendingSaves,
} from "./pendingSaves";

beforeEach(() => {
  resetPendingSaves();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("waitForSaves", () => {
  it("resolves true at once when nothing is pending", async () => {
    await expect(waitForSaves("a")).resolves.toBe(true);
  });

  it("waits for a tracked save to finish", async () => {
    let finish!: () => void;
    const p = trackSave("a", new Promise<void>((r) => (finish = r)));
    expect(pendingSaveCount("a")).toBe(1);

    let resolved = false;
    const waiting = waitForSaves("a").then((v) => {
      resolved = true;
      return v;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    finish();
    await p;
    await expect(waiting).resolves.toBe(true);
    expect(pendingSaveCount("a")).toBe(0);
  });

  it("counts a rejected save as finished and passes the error through", async () => {
    const p = trackSave("a", Promise.reject(new Error("boom")));
    await expect(p).rejects.toThrow("boom");
    expect(pendingSaveCount("a")).toBe(0);
    await expect(waitForSaves("a")).resolves.toBe(true);
  });

  it("passes the saved value through", async () => {
    await expect(trackSave("a", Promise.resolve(42))).resolves.toBe(42);
  });

  it("resolves only when every save of the note has finished", async () => {
    const end1 = beginSave("a");
    const end2 = beginSave("a");
    let resolved = false;
    const waiting = waitForSaves("a").then((v) => {
      resolved = true;
      return v;
    });
    end1();
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(pendingSaveCount("a")).toBe(1);
    end2();
    await expect(waiting).resolves.toBe(true);
  });

  it("releasing twice releases once", () => {
    const end1 = beginSave("a");
    beginSave("a");
    end1();
    end1();
    expect(pendingSaveCount("a")).toBe(1);
  });

  it("is per note", async () => {
    beginSave("a");
    expect(pendingSaveCount("b")).toBe(0);
    await expect(waitForSaves("b")).resolves.toBe(true);
  });

  it("resolves false on timeout and a later release does not throw", async () => {
    vi.useFakeTimers();
    const end = beginSave("a");
    const waiting = waitForSaves("a", 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(waiting).resolves.toBe(false);
    expect(() => end()).not.toThrow();
    expect(pendingSaveCount("a")).toBe(0);
  });

  it("a wait that finished in time does not fire its timeout later", async () => {
    vi.useFakeTimers();
    const end = beginSave("a");
    const waiting = waitForSaves("a", 1000);
    end();
    await expect(waiting).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("two waiters on the same note both resolve", async () => {
    const end = beginSave("a");
    const w1 = waitForSaves("a");
    const w2 = waitForSaves("a");
    end();
    await expect(Promise.all([w1, w2])).resolves.toEqual([true, true]);
  });
});

describe("waitForEditorsClosed", () => {
  it("resolves true at once when no editor is mounted", async () => {
    await expect(waitForEditorsClosed("a")).resolves.toBe(true);
  });

  it("waits until every mounted editor of the note is gone (two panes)", async () => {
    const unmount1 = registerEditor("a");
    const unmount2 = registerEditor("a");
    expect(openEditorCount("a")).toBe(2);

    let resolved = false;
    const waiting = waitForEditorsClosed("a").then((v) => {
      resolved = true;
      return v;
    });
    unmount1();
    await Promise.resolve();
    expect(resolved).toBe(false);
    unmount2();
    await expect(waiting).resolves.toBe(true);
    expect(openEditorCount("a")).toBe(0);
  });

  it("resolves false on timeout", async () => {
    vi.useFakeTimers();
    registerEditor("a");
    const waiting = waitForEditorsClosed("a", 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(waiting).resolves.toBe(false);
  });

  it("editors and saves are counted separately", async () => {
    registerEditor("a");
    expect(pendingSaveCount("a")).toBe(0);
    await expect(waitForSaves("a")).resolves.toBe(true);
  });

  it("covers the unmount order: the editor goes, its flush is already counted", async () => {
    // useAutoSave starts the flush (beginSave) in the unmount cleanup and releases the
    // editor registration after it, so a waiter that wakes on the editor going away
    // always finds the save already counted.
    const unmount = registerEditor("a");
    let finishSave!: () => void;
    const waitingEditor = waitForEditorsClosed("a");
    const flush = trackSave("a", new Promise<void>((r) => (finishSave = r)));
    unmount();
    await waitingEditor;
    expect(pendingSaveCount("a")).toBe(1);
    const waitingSave = waitForSaves("a");
    finishSave();
    await flush;
    await expect(waitingSave).resolves.toBe(true);
  });
});
