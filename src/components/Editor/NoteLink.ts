// src/components/Editor/NoteLink.ts
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
  atom: true, // treated as a single unit — cursor jumps over it

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
    return [{ tag: 'span[data-note-link]' }];
  },

  renderHTML({ HTMLAttributes }) {
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