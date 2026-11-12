// src/features/sync/lib/classifyError.test.ts
import { describe, expect, it } from "vitest";
import { classifyError, classifyKind, rawMessage } from "./classifyError";

describe("classifyKind", () => {
  it("treats the app's own 15 s abort as a timeout", () => {
    expect(classifyKind("review fetch failed (): AbortError: signal is aborted without reason")).toBe("timeout");
    expect(classifyKind("The operation timed out")).toBe("timeout");
    expect(classifyKind("request timeout")).toBe("timeout");
  });

  it("treats an immediate fetch failure as offline", () => {
    expect(classifyKind("TypeError: Failed to fetch")).toBe("offline");
    expect(classifyKind("review fetch failed (): TypeError: Failed to fetch")).toBe("offline");
    expect(classifyKind("Load failed")).toBe("offline");
    expect(classifyKind("NetworkError when attempting to fetch resource.")).toBe("offline");
    expect(classifyKind("net::ERR_INTERNET_DISCONNECTED")).toBe("offline");
    expect(classifyKind("getaddrinfo ENOTFOUND example.invalid")).toBe("offline");
  });

  it("treats 5xx and rate limits as a server problem", () => {
    expect(classifyKind("HTTP 503 Service Unavailable")).toBe("server");
    expect(classifyKind("review fetch failed (500): Internal Server Error")).toBe("server");
    expect(classifyKind("502 Bad Gateway")).toBe("server");
    expect(classifyKind("status 429")).toBe("server");
    expect(classifyKind("Too many requests")).toBe("server");
  });

  it("calls a gateway time-out a server problem, not a timeout", () => {
    expect(classifyKind("504 Gateway Time-out")).toBe("server");
  });

  it("treats sign-in and permission problems as auth", () => {
    expect(classifyKind("JWT expired")).toBe("auth");
    expect(classifyKind("status 401")).toBe("auth");
    expect(classifyKind("review fetch failed (403): forbidden")).toBe("auth");
    expect(classifyKind('new row violates row-level security policy for table "notes"')).toBe("auth");
    expect(classifyKind("Not authenticated")).toBe("auth");
  });

  it("does not mistake a revision number for a status code", () => {
    expect(classifyKind("revision 503 does not match")).toBe("unknown");
    expect(classifyKind("note 401 of 500")).toBe("unknown");
    expect(classifyKind("review fetch failed (42883): operator does not exist")).toBe("unknown");
  });

  it("falls back to unknown", () => {
    expect(classifyKind("something odd")).toBe("unknown");
    expect(classifyKind("")).toBe("unknown");
  });
});

describe("classifyError", () => {
  it("gives a plain sentence and hint for each kind", () => {
    expect(classifyError(new Error("TypeError: Failed to fetch")).text).toBe(
      "No internet connection. Check your connection and try again."
    );
    expect(classifyError(new Error("AbortError: signal is aborted")).text).toBe(
      "The server did not answer in time. Check your connection and try again."
    );
    expect(classifyError(new Error("HTTP 503")).text).toBe("The server had a problem. Try again in a moment.");
    expect(classifyError(new Error("JWT expired")).text).toBe(
      "You are signed out, or your session expired. Sign in again, then try again."
    );
    expect(classifyError(new Error("boom")).text).toBe("Something unexpected went wrong. Try again.");
  });

  it("tells the user to check the note when an apply threw", () => {
    expect(classifyError(new Error("AbortError"), "apply").text).toBe(
      "The server did not answer in time. Check the note before trying again."
    );
    expect(classifyError(new Error("JWT expired"), "apply").text).toBe(
      "You are signed out, or your session expired. Sign in again, then check the note before trying again."
    );
    expect(classifyError(new Error("boom"), "apply").text).toBe(
      "Something unexpected went wrong. Check the note before trying again."
    );
  });

  it("does not add the apply hint for loads", () => {
    expect(classifyError(new Error("boom"), "load").text).not.toContain("Check the note");
  });

  it("marks only auth as not retryable", () => {
    expect(classifyError(new Error("Failed to fetch")).retryable).toBe(true);
    expect(classifyError(new Error("AbortError")).retryable).toBe(true);
    expect(classifyError(new Error("HTTP 500")).retryable).toBe(true);
    expect(classifyError(new Error("boom")).retryable).toBe(true);
    expect(classifyError(new Error("JWT expired")).retryable).toBe(false);
  });

  it("keeps the raw text as a cleaned, capped details line", () => {
    const d = classifyError(new Error("a   b\n\nc")).details;
    expect(d).toBe("a b c");
    expect(classifyError(new Error("x".repeat(500))).details.length).toBe(200);
  });

  it("never puts the raw text in the plain sentence", () => {
    const r = classifyError(new Error("review fetch failed (): AbortError: signal is aborted without reason"));
    expect(r.text).not.toContain("AbortError");
    expect(r.text).not.toContain("review fetch failed");
  });

  it("accepts non-Error values", () => {
    expect(classifyError("Failed to fetch").kind).toBe("offline");
    expect(classifyError({ message: "HTTP 502" }).kind).toBe("server");
    expect(classifyError(null).kind).toBe("unknown");
    expect(classifyError(undefined).kind).toBe("unknown");
    expect(classifyError(42).kind).toBe("unknown");
  });
});

describe("rawMessage", () => {
  it("reads Error, string and message objects", () => {
    expect(rawMessage(new Error("a"))).toBe("a");
    expect(rawMessage("b")).toBe("b");
    expect(rawMessage({ message: "c" })).toBe("c");
  });
});
