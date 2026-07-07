// src/features/editor/components/Editor/DateChipNodeView.tsx

import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useCalendarStore } from "@/features/calendar/store/useCalendarStore";
 

export function DateChipNodeView({ node }: NodeViewProps) {
  const { displayDate, isoDate } = node.attrs as {
    displayDate: string;
    isoDate: string;
    calendarEventId: string | null;
  };

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Navigate to the day view for this date
    useCalendarStore.getState().setSelectedDate(isoDate);
    useCalendarStore.getState().setActiveView("day");
    useUIStore.getState().openCalendar();
  }

  return (
    <NodeViewWrapper as="span" className="date-chip-wrapper" contentEditable={false}>
      <span
        onClick={handleClick}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded
                   bg-blue-500/10 border border-blue-500/25 text-blue-300
                   text-xs font-medium cursor-pointer select-none
                   hover:bg-blue-500/20 hover:border-blue-500/40 transition-colors"
        title={`Open ${displayDate}
        {time && (
          <>
            <span className="opacity-40 mx-0.5">·</span>
            {formatTimeForChip(time, durationMins)}
          </>
        )} in calendar`}
      >
        {/* Calendar icon */}
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" className="shrink-0 opacity-70"
        >
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="8"  y1="2"  x2="8"  y2="6"/>
          <line x1="16" y1="2"  x2="16" y2="6"/>
          <line x1="3"  y1="10" x2="21" y2="10"/>
        </svg>
        {displayDate}
      </span>
    </NodeViewWrapper>
  );
}