// src/features/calendar/components/LayerFilterBar.tsx

import { useCalendarStore, type LayerKey } from "@/features/calendar/store/useCalendarStore";

const LAYERS: { key: LayerKey; label: string; colour: string }[] = [
  { key: "personal", label: "Personal", colour: "#6366f1" },
  { key: "notes",    label: "Notes",    colour: "#8b5cf6" },
  { key: "tasks",    label: "Tasks",    colour: "#3b82f6" },
  { key: "goals",    label: "Goals",    colour: "#10b981" },
  { key: "cde",      label: "CDE",      colour: "#f59e0b" },
];

export function LayerFilterBar() {
  const layerVisibility = useCalendarStore((s) => s.layerVisibility);
  const toggleLayer     = useCalendarStore((s) => s.toggleLayer);

  return (
    <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-idemora-border flex-wrap">
      {LAYERS.map(({ key, label, colour }) => {
        const active = layerVisibility[key];
        return (
          <button
            key={key}
            onClick={() => toggleLayer(key)}
            className={[
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
              "transition-colors duration-150 cursor-pointer select-none",
              active
                ? "bg-idemora-bg-secondary text-idemora-text-normal border border-idemora-border"
                : "text-idemora-text-muted border border-transparent hover:border-idemora-border",
            ].join(" ")}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: active ? colour : "currentColor", opacity: active ? 1 : 0.4 }}
            />
            {label}
          </button>
        );
      })}
    </div>
  );
}