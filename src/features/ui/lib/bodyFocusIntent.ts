// src/features/ui/lib/bodyFocusIntent.ts
// One-shot hint: the next editor that opens should put the cursor in the note
// body. Used by the blank page, where the title is typed before the note exists.
let armedAt = 0;
const WINDOW_MS = 3000;

export function armBodyFocus(): void {
  armedAt = Date.now();
}

export function consumeBodyFocus(): boolean {
  const fresh = armedAt > 0 && Date.now() - armedAt < WINDOW_MS;
  armedAt = 0;
  return fresh;
}