// src/features/editor/components/Editor/ImageExtension.ts
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ImageNodeView } from "./ImageNodeView";
import { saveImage } from "@/lib/tauri/fs";

// ── Helpers ───────────────────────────────────────────────────────────────────

function uniqueFileName(file: File): string {
  const ext  = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const base = file.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
  return `${base}_${Date.now()}.${ext}`;
}

async function persistImage(file: File): Promise<string> {
  const bytes    = new Uint8Array(await file.arrayBuffer());
  const fileName = uniqueFileName(file);
  return await saveImage(fileName, bytes);
}

const ACCEPTED = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function isImageFile(file: File) {
  return ACCEPTED.includes(file.type);
}

// ── Extension ─────────────────────────────────────────────────────────────────

export const ImageExtension = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src:   { default: null },
      alt:   { default: "" },
      width: { default: null },
      align: { default: "left" },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },

  // ── Paste handler ──────────────────────────────────────────────────────────
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("imagePaste"),
        props: {
          handlePaste: (_view, event) => {
            const items = Array.from(event.clipboardData?.items ?? []);
            const imageItem = items.find((i) => ACCEPTED.includes(i.type));
            if (!imageItem) return false;

            const file = imageItem.getAsFile();
            if (!file) return false;

            event.preventDefault();

            persistImage(file)
              .then((path) => {
                this.editor.chain().focus().insertContent({
                  type: "image",
                  attrs: { src: path, alt: file.name, width: null, align: "left" },
                }).run();
              })
              .catch(console.error);

            return true;
          },

          handleDrop: (_view, event) => {
            const files = Array.from(event.dataTransfer?.files ?? []).filter(isImageFile);
            if (files.length === 0) return false;

            event.preventDefault();

            files.forEach((file) => {
              persistImage(file)
                .then((path) => {
                  this.editor.chain().focus().insertContent({
                    type: "image",
                    attrs: { src: path, alt: file.name, width: null, align: "left" },
                  }).run();
                })
                .catch(console.error);
            });

            return true;
          },
        },
      }),
    ];
  },
});