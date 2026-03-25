// src/features/editor/components/Editor/FrontmatterEditor.tsx
import { useState, useEffect, useRef, useCallback } from "react";

interface Props {
  frontmatter: string | null;
  onChange: (frontmatter: string | null) => void;
}

interface Field {
  id: string;
  key: string;
  value: string;
}

export function FrontmatterEditor({ frontmatter, onChange }: Props) {
  const [fields, setFields] = useState<Field[]>([]);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const isInternalUpdate = useRef(false);

  // Generate stable ID for new fields
  const generateId = () => `${Date.now()}-${Math.random()}`;

  // Parse frontmatter JSON into fields array
  useEffect(() => {
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }

    if (!frontmatter) {
      setFields([]);
      return;
    }

    try {
      const parsed = JSON.parse(frontmatter);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const fieldList = Object.entries(parsed).map(([key, value]) => ({
          id: generateId(),
          key,
          value: String(value),
        }));
        setFields(fieldList);
      } else {
        setFields([]);
      }
    } catch {
      setFields([]);
    }
  }, [frontmatter]);

  // Debounced save
  const saveChanges = useCallback((newFields: Field[]) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    
    timeoutRef.current = setTimeout(() => {
      if (newFields.length === 0) {
        onChange(null);
      } else {
        const obj: Record<string, string> = {};
        for (const field of newFields) {
          if (field.key.trim()) {
            obj[field.key.trim()] = field.value;
          }
        }
        onChange(Object.keys(obj).length ? JSON.stringify(obj) : null);
      }
    }, 500);
  }, [onChange]);

  const updateFields = useCallback((newFields: Field[]) => {
    isInternalUpdate.current = true;
    setFields(newFields);
    saveChanges(newFields);
  }, [saveChanges]);

  const addField = () => {
    const newField = { id: generateId(), key: "", value: "" };
    updateFields([...fields, newField]);
  };

  const updateField = (id: string, key: string, value: string) => {
    const newFields = fields.map((field) =>
      field.id === id ? { ...field, key, value } : field
    );
    updateFields(newFields);
  };

  const removeField = (id: string) => {
    const newFields = fields.filter((field) => field.id !== id);
    updateFields(newFields);
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string, isKeyField: boolean) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (isKeyField) {
        // Move focus to the value field
        const valueInput = document.querySelector(`[data-field-id="${id}"][data-field-type="value"]`) as HTMLElement;
        valueInput?.focus();
      }
    }
  };

  const showEditor = fields.length > 0;

  if (!showEditor) {
    return (
      <div className="mb-4">
        <button
          onClick={addField}
          className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors duration-100"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Add frontmatter
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono text-zinc-400 dark:text-zinc-500">
          frontmatter
        </span>
        <button
          onClick={addField}
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors duration-100"
          title="Add field"
        >
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
            <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="space-y-2">
        {fields.map((field) => (
          <div key={field.id} className="flex items-center gap-2">
            <input
              data-field-id={field.id}
              data-field-type="key"
              type="text"
              value={field.key}
              onChange={(e) => updateField(field.id, e.target.value, field.value)}
              onKeyDown={(e) => handleKeyDown(e, field.id, true)}
              placeholder="key"
              className="flex-1 px-2 py-1 text-sm font-mono bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500 text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
            />
            <span className="text-zinc-400 dark:text-zinc-500">:</span>
            <input
              data-field-id={field.id}
              data-field-type="value"
              type="text"
              value={field.value}
              onChange={(e) => updateField(field.id, field.key, e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, field.id, false)}
              placeholder="value"
              className="flex-1 px-2 py-1 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500 text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
            />
            <button
              onClick={() => removeField(field.id)}
              className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors duration-100"
              title="Remove field"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 2.5h7M4 2.5V1.5h2V2.5M3 2.5v6a.5.5 0 00.5.5h3a.5.5 0 00.5-.5v-6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
        Click <span className="text-indigo-400">+</span> to add fields
      </div>
    </div>
  );
}