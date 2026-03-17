// src/lib/templates/index.ts

export interface Template {
  id: string;
  label: string;
  description: string;
  icon: string; // emoji or short text
  defaultTitle: string; // pre-filled title, or "" to leave blank
  content: object; // ProseMirror JSON doc
}

export { blank } from "./blank";
export { daily } from "./daily";
export { meeting } from "./meeting";
export { project } from "./project";
export { brainstorm } from "./brainstorm";

import { blank } from "./blank";
import { daily } from "./daily";
import { meeting } from "./meeting";
import { project } from "./project";
import { brainstorm } from "./brainstorm";

export const TEMPLATES: Template[] = [
  blank,
  daily,
  meeting,
  project,
  brainstorm,
];