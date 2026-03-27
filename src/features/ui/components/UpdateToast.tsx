import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface UpdateToastProps {
  version: string;
  onDismiss: () => void;
}

export function UpdateToast({ version, onDismiss }: UpdateToastProps) {
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // Trigger slide-in animation
    const t = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(t);
  }, []);

  async function handleRelaunch() {
    setInstalling(true);
    try {
      await invoke("install_update");
    } catch (err) {
      console.error("Install failed:", err);
      setInstalling(false);
    }
  }

  function handleDismiss() {
    setVisible(false);
    setTimeout(onDismiss, 300);
  }

  return (
    <div
      className={`fixed bottom-10 right-5 z-50 transition-all duration-300 ease-out ${
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-800 dark:bg-zinc-800 shadow-xl border border-zinc-700 min-w-[280px] max-w-[320px]">
        {/* Leaf icon */}
        <div className="shrink-0 text-zinc-400">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M6 22C6 22 8 14 14 10C20 6 24 6 24 6C24 6 24 10 20 16C16 22 8 22 6 22Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <path
              d="M6 22C6 22 10 18 14 14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-100 leading-tight">
            Updated to {version}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">Relaunch to apply</p>
        </div>

        {/* Relaunch button */}
        <button
          onClick={handleRelaunch}
          disabled={installing}
          className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-600 text-zinc-200 hover:bg-zinc-700 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {installing ? "Installing..." : "Relaunch"}
        </button>

        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="absolute top-2 right-2 w-4 h-4 flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors duration-150"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1 1L7 7M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}