// src/lib/templates/project.ts
import type { Template } from "./index";

export const project: Template = {
  id: "project",
  label: "Project",
  description: "Goals, scope, and milestones",
  icon: "◈",
  defaultTitle: "",
  content: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Overview" }],
      },
      { type: "paragraph", content: [] },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Goals" }],
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
        content: [{ type: "text", text: "Out of scope" }],
      },
      { type: "paragraph", content: [] },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Milestones" }],
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
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Notes" }],
      },
      { type: "paragraph", content: [] },
    ],
  },
};