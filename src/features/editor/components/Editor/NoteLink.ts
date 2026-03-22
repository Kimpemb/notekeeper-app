// src/features/editor/components/Editor/NoteLink.ts
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { NoteLinkView } from "./NoteLinkView";

export interface NoteLinkOptions {
  onNavigate: (id: string) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    noteLink: {
      insertNoteLink: (id: string, label: string) => ReturnType;
    };
  }
}

export const NoteLink = Node.create<NoteLinkOptions>({
  name: "noteLink",
  group: "inline",
  inline: true,
  atom: true,

  addOptions() {
    return { onNavigate: () => {} };
  },

  addAttributes() {
    return {
      id:    { default: null },
      label: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-note-link]",
        // Without getAttrs, TipTap doesn't know how to map the HTML
        // attributes back to node attrs on reload — id and label would
        // come back as null/"". This explicitly pulls them off the element.
        getAttrs: (element) => {
          const el = element as HTMLElement;
          return {
            id:    el.getAttribute("id")    ?? null,
            label: el.getAttribute("label") ?? el.textContent ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // Spread all node attrs into the span so parseHTML can read them back.
    return ["span", mergeAttributes(HTMLAttributes, { "data-note-link": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteLinkView);
  },

  addCommands() {
    return {
      insertNoteLink:
        (id, label) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { id, label },
          }),
    };
  },
});