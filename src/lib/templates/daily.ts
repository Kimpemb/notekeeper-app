// src/lib/templates/daily.ts
import type { Template } from "./index";

export const daily: Template = {
  id: "daily",
  label: "Daily Note",
  description: "Log, tasks, and reflections for the day",
  icon: "☀",
  defaultTitle: "", // filled dynamically with today's date
  content: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Today's focus" }],
      },
      { type: "paragraph", content: [] },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Tasks" }],
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
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "End of day" }],
      },
      { type: "paragraph", content: [] },
    ],
  },
};