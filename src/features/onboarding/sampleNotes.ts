// src/features/onboarding/sampleNotes.ts
//
// Pre-written sample notes inserted on first launch.
// Each showcases a feature cluster to provide meaningful
// content for the guided tour.

export interface SampleNote {
  title: string;
  content: Record<string, any>; // TipTap JSON document
}

// Sample notes array
export const SAMPLE_NOTES: SampleNote[] = [
  {
    title: "Welcome to Idemora 👋",
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Welcome to Idemora" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "This is your first note. Everything is stored locally — no account, no cloud, no lock-in." },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "💡 Type / anywhere to open the slash menu and insert blocks." }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "What you can do" }],
        },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Write in rich markdown with slash commands" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Link notes together and explore the graph view" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Nest notes as sub-pages inside other notes" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Search across everything instantly with Ctrl+K" }] }] },
          ],
        },
      ],
    },
  },
  {
    title: "My first meeting note",
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "My first meeting note" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "This note was created from the Meeting template. You can find more templates by pressing / and typing 'template'." },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Agenda" }],
        },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Review last week's progress" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Plan next milestone" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Assign action items" }] }] },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Notes" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Start typing here..." }],
        },
      ],
    },
  },
  {
    title: "Ideas & scratchpad",
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Ideas & scratchpad" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "A place to dump thoughts before they disappear. Link ideas to other notes using [[ to create a note link." },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "markdown" },
          content: [
            {
              type: "text",
              text: "# Quick syntax reference\n\n**Bold**, *italic*, `inline code`\n\n- Bullet list\n1. Numbered list\n\n> Blockquote\n\n[[Link to another note]]",
            },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "🔖 Things to explore" }],
        },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Try the graph view — Ctrl+Shift+G" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Open the outline panel — Ctrl+'" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Link this note to Welcome using [[Welcome" }] }] },
          ],
        },
      ],
    },
  },
];