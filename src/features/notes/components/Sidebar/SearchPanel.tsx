// src/features/notes/components/Sidebar/SearchPanel.tsx
import { useUIStore } from "@/features/ui/store/useUIStore";
import { SearchBar } from "./SearchBar";
import { SearchResults } from "./SearchResults";

export function SearchPanel() {
  const searchQuery = useUIStore((s) => s.searchQuery);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center px-3 pt-3 pb-2 shrink-0">
        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">
          Search
        </span>
      </div>
      <div className="mx-3 border-t border-zinc-200 dark:border-zinc-800 shrink-0" />
      <div className="px-3 pt-2 shrink-0">
        <SearchBar />
      </div>
      <div className="flex-1 overflow-y-auto mt-1">
        <SearchResults query={searchQuery} />
      </div>
    </div>
  );
}