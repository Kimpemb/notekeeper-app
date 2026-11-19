// src/features/ui/lib/selectAllGuard.test.ts
import { describe, expect, it } from "vitest";
import { isSelectAllAllowed } from "@/features/ui/lib/selectAllGuard";

describe("isSelectAllAllowed", () => {
  it("allows inputs, textareas and selects", () => {
    expect(isSelectAllAllowed({ tagName: "INPUT" })).toBe(true);
    expect(isSelectAllAllowed({ tagName: "textarea" })).toBe(true);
    expect(isSelectAllAllowed({ tagName: "SELECT" })).toBe(true);
  });
  it("allows contenteditable and elements inside the editor", () => {
    expect(isSelectAllAllowed({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isSelectAllAllowed({ tagName: "P", closest: () => ({}) })).toBe(true);
  });
  it("blocks the page body, buttons and a missing target", () => {
    expect(isSelectAllAllowed({ tagName: "BODY", closest: () => null })).toBe(false);
    expect(isSelectAllAllowed({ tagName: "BUTTON", closest: () => null })).toBe(false);
    expect(isSelectAllAllowed(null)).toBe(false);
  });
});