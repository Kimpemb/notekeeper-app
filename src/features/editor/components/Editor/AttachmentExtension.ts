// src/features/editor/components/Editor/AttachmentExtension.ts
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { AttachmentNodeView } from "./AttachmentNodeView";
import { saveAttachment } from "@/lib/tauri/fs";

// ── Accepted types ────────────────────────────────────────────────────────────

const ACCEPTED_PDF   = ["application/pdf"];
const ACCEPTED_AUDIO = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/mp4", "audio/aac", "audio/x-m4a"];
const ACCEPTED_ALL   = [...ACCEPTED_PDF, ...ACCEPTED_AUDIO];

export type AttachmentKind = "pdf" | "audio";

function kindFromMime(mime: string): AttachmentKind | null {
  if (ACCEPTED_PDF.includes(mime))   return "pdf";
  if (ACCEPTED_AUDIO.includes(mime)) return "audio";
  return null;
}

function kindFromExt(filename: string): AttachmentKind | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["mp3", "wav", "ogg", "m4a", "aac"].includes(ext)) return "audio";
  return null;
}

function isAttachmentFile(file: File): boolean {
  return kindFromMime(file.type) !== null || kindFromExt(file.name) !== null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uniqueFileName(file: File): string {
  const ext  = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const base = file.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
  return `${base}_${Date.now()}.${ext}`;
}

async function persistAttachment(file: File): Promise<{ path: string; kind: AttachmentKind }> {
  const kind     = kindFromMime(file.type) ?? kindFromExt(file.name) ?? "pdf";
  const bytes    = new Uint8Array(await file.arrayBuffer());
  const fileName = uniqueFileName(file);
  const path     = await saveAttachment(fileName, bytes);
  return { path, kind };
}

// ── Extension ─────────────────────────────────────────────────────────────────

export const AttachmentExtension = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src:      { default: null },
      filename: { default: "" },
      kind:     { default: "pdf" },  // "pdf" | "audio"
      size:     { default: null },   // bytes, optional
    };
  },

  parseHTML() {
    return [{ tag: "div[data-attachment]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-attachment": "" }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentNodeView);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("attachmentPaste"),
        props: {
          handlePaste: (_view, event) => {
            const items = Array.from(event.clipboardData?.items ?? []);
            const item  = items.find((i) => ACCEPTED_ALL.includes(i.type));
            if (!item) return false;

            const file = item.getAsFile();
            if (!file) return false;

            event.preventDefault();

            persistAttachment(file)
              .then(({ path, kind }) => {
                this.editor.chain().focus().insertContent({
                  type: "attachment",
                  attrs: { src: path, filename: file.name, kind, size: file.size },
                }).run();
              })
              .catch(console.error);

            return true;
          },

          handleDrop: (_view, event) => {
            const files = Array.from(event.dataTransfer?.files ?? []).filter(isAttachmentFile);
            if (files.length === 0) return false;

            event.preventDefault();

            files.forEach((file) => {
              persistAttachment(file)
                .then(({ path, kind }) => {
                  this.editor.chain().focus().insertContent({
                    type: "attachment",
                    attrs: { src: path, filename: file.name, kind, size: file.size },
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