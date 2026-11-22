import { describe, it, expect } from "vitest"
import { isAIHidden, aiVisibleSql } from "./aiHidden"

describe("isAIHidden", () => {
  it("hides a born-excluded notepad", () => {
    expect(isAIHidden({ source_type: "notepad", rag_excluded: 1 })).toBe(true)
  })
  it("shows a notepad after opt-in", () => {
    expect(isAIHidden({ source_type: "notepad", rag_excluded: 0 })).toBe(false)
  })
  it("leaves ordinary excluded notes to the existing rules", () => {
    expect(isAIHidden({ source_type: "note", rag_excluded: 1 })).toBe(false)
  })
  it("handles missing notes", () => {
    expect(isAIHidden(null)).toBe(false)
    expect(isAIHidden(undefined)).toBe(false)
  })
})

describe("aiVisibleSql", () => {
  it("uses the given alias", () => {
    expect(aiVisibleSql("ntc_n")).toContain("ntc_n.source_type = 'notepad'")
  })
})