// src/lib/templates/brainstorm.ts
import type { Template } from "./index";

export const brainstorm: Template = {
  id: "brainstorm",
  label: "Brainstorm",
  description: "Dump ideas, then shape them",
  icon: "⚡",
  defaultTitle: "",
  content: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "The question" }],
      },
      { type: "paragraph", content: [] },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Raw ideas" }],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [] }],
          },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Worth exploring" }],
      },
      { type: "paragraph", content: [] },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Next steps" }],
      },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [{ type: "paragraph", content: [] }],
          },
        ],
      },
    ],
  },
};