// src/components/ThemeToggle.tsx
import { useUIStore } from "@/store/useUIStore";

export function ThemeToggle() {
  const theme       = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  return (
    <button
      onClick={toggleTheme}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="
        w-7 h-7 flex items-center justify-center rounded-md
        text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200
        hover:bg-zinc-200 dark:hover:bg-zinc-700
        transition-colors duration-100
      "
    >
      {theme === "dark" ? (
        /* Sun */
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <circle cx="7.5" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M3.05 3.05l1.06 1.06M10.9 10.9l1.05 1.05M3.05 11.95l1.06-1.06M10.9 4.1l1.05-1.05"
            stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      ) : (
        /* Moon */
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M12 9.5A6 6 0 014.5 2a6 6 0 107.5 7.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
}