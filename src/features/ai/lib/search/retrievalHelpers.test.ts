import { describe, it, expect } from "vitest"
import { titleScopePrefixes, findReference, textHasReference } from "./retrievalHelpers"

describe("titleScopePrefixes", () => {
  it("matches a title that has a typo", () => {
    const prefixes = titleScopePrefixes("data communications")
    expect(prefixes).toEqual(["data", "communicat"])
    const title = "data communicatons and networking - behrouz a. forouzan"
    expect(prefixes.every((p) => title.includes(p))).toBe(true)
  })
  it("drops filler words", () => {
    expect(titleScopePrefixes("the data of networks")).toEqual(["data", "networ"])
  })
  it("keeps a short title instead of returning nothing", () => {
    expect(titleScopePrefixes("of")).toEqual(["of"])
  })
})

describe("findReference / textHasReference", () => {
  it("finds a labelled number", () => {
    expect(findReference("Example 31.1")).toEqual({ label: "example", num: "31.1" })
    expect(findReference("see fig. 5.3 please")).toEqual({ label: "figure", num: "5.3" })
  })
  it("returns null when there is no label", () => {
    expect(findReference("explain the additive cipher")).toBeNull()
    expect(findReference("version 2.2.4 notes")).toBeNull()
  })
  it("matches the exact reference only", () => {
    const ref = { label: "example", num: "31.1" }
    expect(textHasReference("Example 31.1 Use the additive cipher", ref)).toBe(true)
    expect(textHasReference("as in Example 31.1.", ref)).toBe(true)
    expect(textHasReference("Example 31.12 is different", ref)).toBe(false)
    expect(textHasReference("Example 31.1.2 is different", ref)).toBe(false)
  })
  it("treats Fig. as Figure", () => {
    expect(textHasReference("shown in Fig. 5.3 above", { label: "figure", num: "5.3" })).toBe(true)
  })
})