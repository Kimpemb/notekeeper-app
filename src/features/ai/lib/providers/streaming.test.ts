// src/features/ai/lib/providers/streaming.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSSE, streamOpenAICompat } from "./sse";
import type { OpenAICompatStreamArgs } from "./sse";
import { geminiChatStream } from "./gemini";
import { claudeChatStream } from "./claude";

function okResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true, status: 200, statusText: "OK",
    body: {
      getReader: () => ({
        read: async () => (i < chunks.length
          ? { done: false, value: enc.encode(chunks[i++]) }
          : { done: true, value: undefined }),
        cancel: async () => {},
      }),
    },
  } as unknown as Response;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("readSSE", () => {
  it("joins events split across chunks, skips comments, handles CRLF and multi-line data", async () => {
    const events: { event: string | null; data: string }[] = [];
    const activity = vi.fn();
    await readSSE(
      okResponse([": keep-alive\n\nevent: a\ndata: {\"x\"", ":1}\r\n\r\ndata: one\ndata: two\n\n"]),
      (ev) => events.push(ev),
      activity,
    );
    expect(events).toEqual([
      { event: "a", data: '{"x":1}' },
      { event: null, data: "one\ntwo" },
    ]);
    expect(activity).toHaveBeenCalledTimes(2);
  });

  it("emits a last event that has no trailing newline", async () => {
    const events: string[] = [];
    await readSSE(okResponse(["data: tail"]), (ev) => events.push(ev.data));
    expect(events).toEqual(["tail"]);
  });
});

describe("streamOpenAICompat", () => {
  const base: OpenAICompatStreamArgs = {
    url: "https://example.test/v1/chat/completions",
    apiKey: "k", model: "m",
    messages: [{ role: "user", content: "hi" }],
    onToken: () => {},
    includeUsage: true,
    makeError: (status, message, code) => Object.assign(new Error(message), { status, code }),
  };

  it("collects text and usage, ignores reasoning-only chunks and [DONE]", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const onToken = vi.fn();
    const out = await streamOpenAICompat({ ...base, onToken, system: "be brief" });
    expect(out).toEqual({ text: "Hello", inputTokens: 5, outputTokens: 2 });
    expect(onToken.mock.calls.map((c) => c[0])).toEqual(["Hel", "lo"]);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.stream).toBe(true);
    expect(sent.stream_options).toEqual({ include_usage: true });
    expect(sent.messages[0]).toEqual({ role: "system", content: "be brief" });
  });

  it("omits stream_options when includeUsage is false", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(["data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);
    await streamOpenAICompat({ ...base, includeUsage: false });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream_options).toBeUndefined();
  });

  it("maps an HTTP error through makeError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 503, statusText: "Service Unavailable",
      json: async () => ({ error: { message: "overloaded", code: "x" } }),
    }));
    await expect(streamOpenAICompat(base)).rejects.toMatchObject({ status: 503, message: "overloaded" });
  });
});

describe("geminiChatStream", () => {
  it("requests :streamGenerateContent with alt=sse and joins the text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([
      'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\r\n\r\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":2}}\r\n\r\n',
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const out = await geminiChatStream(
      "key", "gemini-3.8-flash", [{ role: "user", parts: [{ text: "hi" }] }], undefined, () => {},
    );
    expect(out).toEqual({ text: "Hello", inputTokens: 7, outputTokens: 2 });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(":streamGenerateContent");
    expect(url).toContain("alt=sse");
  });
});

describe("claudeChatStream", () => {
  it("joins text deltas and reads usage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":9,"output_tokens":1}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}\n\nevent: ping\ndata: {"type":"ping"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n',
    ])));
    const out = await claudeChatStream("k", "m", [{ role: "user", content: "hi" }], undefined, () => {});
    expect(out).toEqual({ text: "Hello", inputTokens: 9, outputTokens: 4 });
  });

  it("turns a mid-stream overloaded_error into status 529", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse([
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
    ])));
    await expect(
      claudeChatStream("k", "m", [{ role: "user", content: "hi" }], undefined, () => {}),
    ).rejects.toMatchObject({ status: 529 });
  });
});