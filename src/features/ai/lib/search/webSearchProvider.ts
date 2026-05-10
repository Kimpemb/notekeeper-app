// src/features/ai/lib/search/webSearchProvider.ts
//
// Phase 5 — M16 · Universal web search adapter
//
// Architecture:
//   All providers normalise to WebSearchResult[].
//   Factory reads web_search_provider from app_settings and returns the right instance.
//   Everything above this file is provider-agnostic.
//
// Tunable constants — flagged for easy adjustment without search-and-replace:
//   WEB_SEARCH_SCORE_THRESHOLD  lower = more nudges
//   WEB_SEARCH_MIN_CHUNKS       lower = more nudges

// ─── Tunable constants ────────────────────────────────────────────────────────

export const WEB_SEARCH_SCORE_THRESHOLD = 0.6  // tunable — lower = more nudges
export const WEB_SEARCH_MIN_CHUNKS      = 3    // tunable — lower = more nudges

// ─── Shared interface ─────────────────────────────────────────────────────────

export interface WebSearchResult {
  title:   string
  url:     string
  snippet: string
}

export interface WebSearchProvider {
  search(query: string): Promise<WebSearchResult[]>
}

// ─── TinyFish provider ────────────────────────────────────────────────────────
//
// Default provider. No API key required.
// Rate limits: 5 searches/min, 25 fetches/min.
// https://tinyfish.io

// ─── TinyFish provider ────────────────────────────────────────────────────────
//
// Default provider. Free tier requires an API key (no credit card).
// Sign up: agent.tinyfish.ai/api-keys
// Rate limits: 5 searches/min, 25 fetches/min.
// https://docs.tinyfish.ai/search-api

interface TinyFishSearchItem {
  title:     string
  url:       string
  snippet:   string
  position:  number
  site_name: string
}

interface TinyFishResponse {
  results?: TinyFishSearchItem[]
}

class TinyFishProvider implements WebSearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string): Promise<WebSearchResult[]> {
    const url = `https://api.search.tinyfish.ai?query=${encodeURIComponent(query)}&limit=8`
    const res = await fetch(url, {
      headers: {
        "Accept":    "application/json",
        "X-API-Key": this.apiKey,
      },
    })
    if (!res.ok) throw new Error(`TinyFish error ${res.status}`)
    const data: TinyFishResponse = await res.json()
    return (data.results ?? []).map((item) => ({
      title:   item.title   ?? "",
      url:     item.url     ?? "",
      snippet: item.snippet ?? "",
    }))
  }
}

// ─── Serper provider ──────────────────────────────────────────────────────────
//
// Requires API key (web_search_api_key).
// Free tier: 2,500 queries (no CC). $0.30–$1/1k after.
// https://serper.dev

interface SerperSearchItem {
  title:   string
  link:    string
  snippet: string
}

interface SerperResponse {
  organic?: SerperSearchItem[]
}

class SerperProvider implements WebSearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string): Promise<WebSearchResult[]> {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY":    this.apiKey,
      },
      body: JSON.stringify({ q: query, num: 8 }),
    })
    if (!res.ok) throw new Error(`Serper error ${res.status}`)
    const data: SerperResponse = await res.json()
    return (data.organic ?? []).map((item) => ({
      title:   item.title   ?? "",
      url:     item.link    ?? "",
      snippet: item.snippet ?? "",
    }))
  }
}

// ─── Tavily provider ──────────────────────────────────────────────────────────
//
// Requires API key (web_search_api_key).
// Free tier: 1,000 credits/month. AI-optimised summaries.
// https://tavily.com

interface TavilyResultItem {
  title:   string
  url:     string
  content: string
}

interface TavilyResponse {
  results?: TavilyResultItem[]
}

class TavilyProvider implements WebSearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string): Promise<WebSearchResult[]> {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key:        this.apiKey,
        query,
        max_results:    8,
        search_depth:   "basic",
        include_answer: false,
      }),
    })
    if (!res.ok) throw new Error(`Tavily error ${res.status}`)
    const data: TavilyResponse = await res.json()
    return (data.results ?? []).map((item) => ({
      title:   item.title   ?? "",
      url:     item.url     ?? "",
      snippet: item.content ?? "",
    }))
  }
}

// ─── Brave Search provider ────────────────────────────────────────────────────
//
// Requires API key (web_search_api_key).
// Free tier: ~1,000 queries/month. $5/1k after.
// https://brave.com/search/api

interface BraveWebResult {
  title:       string
  url:         string
  description: string
}

interface BraveResponse {
  web?: { results?: BraveWebResult[] }
}

class BraveProvider implements WebSearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string): Promise<WebSearchResult[]> {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`
    const res = await fetch(url, {
      headers: {
        "Accept":               "application/json",
        "Accept-Encoding":      "gzip",
        "X-Subscription-Token": this.apiKey,
      },
    })
    if (!res.ok) throw new Error(`Brave error ${res.status}`)
    const data: BraveResponse = await res.json()
    return (data.web?.results ?? []).map((item) => ({
      title:   item.title       ?? "",
      url:     item.url         ?? "",
      snippet: item.description ?? "",
    }))
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────
//
// Reads web_search_provider and web_search_api_key from useAppSettings.
// Returns the correct provider instance.
// Switching the default provider in future = one import change here.

import { useAppSettings } from "@/features/ui/store/useAppSettings"

export function getWebSearchProvider(): WebSearchProvider {
  const { settings } = useAppSettings.getState()
  const provider = settings.web_search_provider ?? "tinyfish"
  const apiKey   = settings.web_search_api_key  ?? ""

  switch (provider) {
    case "serper":  return new SerperProvider(apiKey)
    case "tavily":  return new TavilyProvider(apiKey)
    case "brave":   return new BraveProvider(apiKey)
    case "tinyfish":
    default: return new TinyFishProvider(apiKey)
  }
}

// ─── Provider metadata ────────────────────────────────────────────────────────
//
// Used by SettingsModal to build the dropdown and key field visibility logic.

export interface ProviderMeta {
  id:          string
  label:       string
  requiresKey: boolean
  keyLabel:    string
  docsUrl:     string
}

export const WEB_SEARCH_PROVIDERS: ProviderMeta[] = [
  { id: "tinyfish", label: "TinyFish (free)", requiresKey: true,  keyLabel: "TinyFish API key", docsUrl: "https://agent.tinyfish.ai/api-keys" },
  { id: "serper",   label: "Serper (Google-quality)",             requiresKey: true,  keyLabel: "Serper API key",   docsUrl: "https://serper.dev" },
  { id: "tavily",   label: "Tavily (AI-optimised)",               requiresKey: true,  keyLabel: "Tavily API key",   docsUrl: "https://app.tavily.com" },
  { id: "brave",    label: "Brave Search",                        requiresKey: true,  keyLabel: "Brave API key",    docsUrl: "https://brave.com/search/api" },
]