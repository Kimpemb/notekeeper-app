// src/lib/templates/blank.ts
import type { Template } from "./index";

export const blank: Template = {
  id: "blank",
  label: "Blank",
  description: "Start from scratch",
  icon: "✦",
  defaultTitle: "",
  content: {
    type: "doc",
    content: [],
  },
};