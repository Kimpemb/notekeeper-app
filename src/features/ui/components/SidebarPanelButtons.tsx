// src/features/ui/components/SidebarPanelButtons.tsx
//
// The row of sidebar panel buttons in the header. Lives in its own component so that
// switching panels re-renders only this row, not the whole App.
import { useUIStore } from "@/features/ui/store/useUIStore";

export function SidebarPanelButtons() {
  const activeSidebarPanel = useUIStore((s) => s.activeSidebarPanel);
  const toggleSidebarPanel = useUIStore((s) => s.toggleSidebarPanel);

  return (
        <div className="flex items-center gap-1">
          {["notes", "search", "bookmarks", "trash", "env"].map((id) => (
            <button
              key={id}
              onClick={() => toggleSidebarPanel(id as any)}
              className={`relative shrink-0 w-8 h-8 flex items-center justify-center rounded-md transition-colors
                ${activeSidebarPanel === id ? "text-idemora-text-normal" : "text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/6 dark:hover:bg-white/7"}`}
            >
              {activeSidebarPanel === id && <span className="absolute bottom-1 left-2 right-2 h-0.5 rounded-full bg-blue-500" />}
              {id === "notes" && (
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                  <path d="M2 5.5a1.5 1.5 0 011.5-1.5h3.5L9 6.5h5.5a1.5 1.5 0 011.5 1.5v5.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 012 13.5v-8z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              {id === "search" && (
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                  <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M12.5 12.5l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              )}
              {id === "bookmarks" && (
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                  <path d="M5 2.5h8a1.5 1.5 0 011.5 1.5v11l-5.5-3-5.5 3V4a1.5 1.5 0 011.5-1.5z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              {id === "trash" && (
                <svg width="16" height="16" viewBox="0 0 640 640" fill="none">
                  <path d="M216.3 124C262.5 44 378 44 424.2 124L461.5 188.6L489.2 172.6C497.6 167.7 508.1 168.4 515.8 174.3C523.5 180.2 526.9 190.2 524.4 199.6L500.9 287C497.5 299.8 484.3 307.4 471.5 304L384.1 280.6C374.7 278.1 367.8 270.2 366.5 260.6C365.2 251 369.9 241.5 378.3 236.7L406 220.7L368.7 156.1C347.1 118.8 293.3 118.8 271.7 156.1L266.4 165.2C257.6 180.5 238 185.7 222.7 176.9C207.4 168.1 202.2 148.5 211 133.1L216.3 124zM513.7 343.1C529 334.3 548.6 339.5 557.4 354.8L562.7 363.9C608.9 443.9 551.2 543.9 458.8 543.9L384.2 543.9L384.2 575.9C384.2 585.6 378.4 594.4 369.4 598.1C360.4 601.8 350.1 599.8 343.2 592.9L279.2 528.9C269.8 519.5 269.8 504.3 279.2 495L343.2 431C350.1 424.1 360.4 422.1 369.4 425.8C378.4 429.5 384.2 438.3 384.2 448L384.2 480L458.8 480C501.9 480 528.9 433.3 507.3 396L502 386.9C493.2 371.6 498.4 352 513.7 343.2zM115 299.4L87.3 283.4C78.9 278.5 74.2 269.1 75.5 259.5C76.8 249.9 83.7 242 93.1 239.5L180.5 216C193.3 212.6 206.5 220.2 209.9 233L233.3 320.4C235.8 329.8 232.4 339.7 224.7 345.7C217 351.7 206.5 352.3 198.1 347.4L170.4 331.4L133.1 396C111.5 433.3 138.5 480 181.6 480L192.2 480C209.9 480 224.2 494.3 224.2 512C224.2 529.7 209.9 544 192.2 544L181.6 544C89.3 544 31.6 444 77.8 364L115 299.4z" fill="currentColor"/>
                </svg>
              )}
              {id === "env" && (
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                  <rect x="3" y="2" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M6 6h6M6 9h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  <circle cx="12.5" cy="13.5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M14.5 15.5l1.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              )}
            </button>
          ))}
        </div>
  );
}
