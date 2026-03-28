// src/features/ai/lib/client.ts
//
// This is the single Gemini client used by every AI action in the app.
// All AI calls go through callGemini(). The API key is always read fresh
// from useAIStore so it reflects the latest saved value without re-importing.

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL    = "gemini-2.5-flash";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeminiMessage {
  role: "user" | "model";
  parts: { text: string }[];
}

export interface GeminiResponse {
  candidates: {
    content: {
      parts: { text: string }[];
    };
  }[];
}

// ─── Core caller ─────────────────────────────────────────────────────────────

/**
 * Send a prompt to Gemini and return the text response.
 * Throws on network errors or non-200 responses.
 */
export async function callGemini(prompt: string, apiKey?: string): Promise<string> {
  const key = apiKey ?? (await getStoredApiKey());

  if (!key) throw new Error("No Gemini API key configured. Add your key in Settings → AI.");

  const url = `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${key}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2048,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const message = errBody?.error?.message ?? `HTTP ${res.status}`;

    if (res.status === 429) {
      throw new Error("AI quota reached. Try again in a few seconds.");
    }

    throw new Error(`Gemini error: ${message}`);
  }

  const data: GeminiResponse = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  if (!text) throw new Error("Gemini returned an empty response.");

  return text.trim();
}

// ─── Connection test ──────────────────────────────────────────────────────────

/**
 * Ping Gemini with a minimal prompt to verify the key works.
 * Returns true on success, false on auth failure, throws on network errors.
 */
export async function testGeminiConnection(apiKey: string): Promise<boolean> {
  try {
    await callGemini("Reply with only the word: ok", apiKey);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("API_KEY_INVALID") ||
      message.includes("403") ||
      message.includes("401")
    ) {
      return false;
    }
    throw err;
  }
}

// ─── Key helper ───────────────────────────────────────────────────────────────

async function getStoredApiKey(): Promise<string> {
  const { useAIStore } = await import("@/features/ai/store/useAIStore");
  return useAIStore.getState().apiKey;
}