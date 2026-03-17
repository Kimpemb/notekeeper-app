// src/lib/templates/meeting.ts
import type { Template } from "./index";

export const meeting: Template = {
  id: "meeting",
  label: "Meeting Notes",
  description: "Agenda, notes, and action items",
  icon: "◎",
  defaultTitle: "Meeting — ",
  content: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Attendees" }],
      },
      { type: "paragraph", content: [] },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Agenda" }],
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
        content: [{ type: "text", text: "Notes" }],
      },
      { type: "paragraph", content: [] },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Action items" }],
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