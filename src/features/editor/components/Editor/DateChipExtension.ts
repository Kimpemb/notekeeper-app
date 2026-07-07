// src/features/editor/components/Editor/DateChipExtension.ts

import { Node, Extension, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import {
  parseNaturalDate, formatDateForChip, dateToISO,
  extractTime, extractTimeRange, computeDurationMins,
} from "@/features/calendar/lib/dateParser";
import { createEvent, deleteEvent } from "@/features/calendar/db/calendarQueries";
import { DateChipNodeView } from "./DateChipNodeView";

const dateChipTriggerKey  = new PluginKey("dateChipTrigger");
const dateChipDeletionKey = new PluginKey("dateChipDeletion");

export interface DateChipOptions {
  // The note currently open in this editor instance — used as source_id
  // on the created calendar event. Set via .configure({ noteId }).
  noteId: string | null;
  // Returns the current note's display title at call time — called just before
  // createEvent so the title is fresh even if the note was renamed.
  getTitle: () => string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    dateChip: {
      insertDateChip: (isoDate: string, displayDate: string) => ReturnType;
    };
  }
}

// ── Patterns that can follow @ ────────────────────────────────────────────────
// We capture everything after @ up to a space, newline, or end of text.
// chrono-node does the actual parsing — we just slice the raw text and let it try.
const MAX_LOOKAHEAD_CHARS = 40;

export const DateChipExtension = Node.create<DateChipOptions>({
  name: "dateChip",
  group: "inline",
  inline: true,
  atom: true,   // not editable inline — delete and retype to change, matching NoteLink

  addOptions() {
    return {
      noteId: null as string | null,
      getTitle: (() => "Untitled") as () => string,
    };
  },

  addAttributes() {
    return {
      isoDate:         { default: null },
      displayDate:     { default: "" },
      calendarEventId: { default: null },
      time:            { default: null },
      durationMins:    { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-date-chip]",
        getAttrs: (element) => {
          const el = element as HTMLElement;
          return {
            isoDate:         el.getAttribute("data-iso-date") ?? null,
            displayDate:     el.getAttribute("data-display-date") ?? el.textContent ?? "",
            calendarEventId: el.getAttribute("data-calendar-event-id") ?? null,
            time:            el.getAttribute("data-time") ?? null,
            durationMins:    el.getAttribute("data-duration-mins") ? parseInt(el.getAttribute("data-duration-mins")!) : null,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-date-chip": "",
        "data-iso-date":           HTMLAttributes.isoDate,
        "data-display-date":       HTMLAttributes.displayDate,
        "data-calendar-event-id":  HTMLAttributes.calendarEventId,
        "data-time":               HTMLAttributes.time,
        "data-duration-mins":      HTMLAttributes.durationMins,
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DateChipNodeView);
  },

  addCommands() {
    return {
      insertDateChip:
        (isoDate, displayDate) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { isoDate, displayDate, calendarEventId: null, time: null, durationMins: null },
          }),
    };
  },

  // ── @ trigger detection ────────────────────────────────────────────────────
  // Fires on every editor update. Looks at the text immediately before the
  // cursor — if it starts with @ and chrono-node can parse what follows,
  // replace the raw text with a DateChip node and create a calendar event.
  //
  // We watch for the @ character the same way the main editor watches for
  // "/" (slash menu) and "[[" (note link suggest): inside onUpdate.
  // However, DateChip does this autonomously inside the extension so the
  // main editor file stays clean.
  addProseMirrorPlugins() {
    const extensionThis = this;

    return [
      new Plugin({
        key: dateChipTriggerKey,
        props: {
          handleKeyDown(view, event) {
            // Resolve on Space or Enter
            if (event.key !== " " && event.key !== "Enter") return false;

            const { state } = view;
            const { from, to } = state.selection;
            if (from !== to) return false; // only collapsed selections

            // Walk back from cursor to find an @ character on the same line
            const textBefore = state.doc.textBetween(
              Math.max(0, from - MAX_LOOKAHEAD_CHARS),
              from,
              "\n"
            );

            const atIdx = textBefore.lastIndexOf("@");
            if (atIdx === -1) return false;

            const rawInput = textBefore.slice(atIdx + 1); // text after @
            if (!rawInput.trim()) return false;

            // Strip trailing end-time range before passing to chrono
            const { cleanInput, startTimeStr, endTimeStr } = extractTimeRange(rawInput);

            const parsed = parseNaturalDate(cleanInput);
            if (!parsed) return false;

            const isoDate     = dateToISO(parsed);
            const displayDate = formatDateForChip(parsed);
            // Prefer manually extracted start time over chrono's (handles no-space format)
            const time        = startTimeStr ?? extractTime(parsed);
            const durationMins = (time && endTimeStr)
              ? computeDurationMins(time, endTimeStr)
              : null;

            const deleteFrom = Math.max(0, from - textBefore.length + atIdx);
            const deleteTo   = from;

            // Replace the raw @text with the chip node
            view.dispatch(
              state.tr
                .deleteRange(deleteFrom, deleteTo)
                .insert(
                  deleteFrom,
                  state.schema.nodes.dateChip.create({
                    isoDate,
                    displayDate,
                    calendarEventId: null,
                    time,
                    durationMins,
                  })
                )
            );

            // Async: create the calendar event and patch the node's attr
            const noteId = extensionThis.options.noteId;
            const noteTitle = extensionThis.options.getTitle();
            createEvent({
              title:          noteTitle,
              date:           isoDate,
              time:           time ?? null,
              duration_mins:  durationMins ?? null,
              category:       "note",
              source_id:      noteId,
              source_type:    "note",
              linked_note_id: noteId,
            }).then((eventId) => {
              // Find the chip node we just inserted and update its calendarEventId attr
              const currentState = view.state;
              currentState.doc.descendants((node, pos) => {
                if (
                  node.type.name === "dateChip" &&
                  node.attrs.isoDate === isoDate &&
                  node.attrs.calendarEventId === null
                ) {
                  view.dispatch(
                    currentState.tr.setNodeAttribute(pos, "calendarEventId", eventId)
                  );
                  return false; // stop after first match
                }
              });
            }).catch((err) => {
              console.error("[DateChipExtension] createEvent failed:", err);
            });

            return true; // consumed the keystroke
          },
        },
      }),
    ];
  },

  // ── Cleanup on node delete ─────────────────────────────────────────────────
  // When a DateChip is removed from the document, delete its calendar event.
  // anti-gaming: deleteEvent in calendarQueries does NOT touch score_event_log,
  // so if the chip date is today the score row persists (counts as missed).
  onDestroy() {
    // TipTap doesn't expose a per-node destroy hook here — cleanup is handled
    // via a transaction plugin watching for node removals. See the plugin below.
  },
});

// ── Deletion watcher ──────────────────────────────────────────────────────────
// Separate plain extension that watches transactions for removed dateChip nodes
// and fires deleteEvent for their calendarEventId.
//
// This is intentionally NOT part of DateChipExtension itself so it doesn't
// interfere with the @ trigger plugin above.

export const DateChipDeletionWatcher = Extension.create({
  name: "dateChipDeletionWatcher",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: dateChipDeletionKey,
        appendTransaction(transactions, oldState, _newState) {
          for (const tr of transactions) {
            if (!tr.docChanged) continue;

            // Collect calendarEventIds present in old doc
            const oldIds = new Map<string, string>(); // eventId → isoDate
            oldState.doc.descendants((node) => {
              if (
                node.type.name === "dateChip" &&
                node.attrs.calendarEventId
              ) {
                oldIds.set(node.attrs.calendarEventId, node.attrs.isoDate);
              }
            });

            if (oldIds.size === 0) continue;

            // Check which are still present in new doc
            const newIds = new Set<string>();
            _newState.doc.descendants((node) => {
              if (
                node.type.name === "dateChip" &&
                node.attrs.calendarEventId
              ) {
                newIds.add(node.attrs.calendarEventId);
              }
            });

            // Any removed → delete the calendar event
            for (const [eventId] of oldIds) {
              if (!newIds.has(eventId)) {
                // Fire and forget — anti-gaming: score_event_log row survives
                deleteEvent(eventId).catch((err) => {
                  console.error("[DateChipDeletionWatcher] deleteEvent failed:", err);
                });
              }
            }
          }

          return null; // no new transaction needed
        },
      }),
    ];
  },
});