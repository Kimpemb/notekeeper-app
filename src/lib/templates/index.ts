// src/lib/templates/index.ts

export interface Template {
  id: string;
  label: string;
  description: string;
  icon: string; // emoji or short text
  defaultTitle: string; // pre-filled title, or "" to leave blank
  content: object; // ProseMirror JSON doc
}

export { daily } from "./daily";