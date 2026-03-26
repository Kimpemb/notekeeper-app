import React from 'react';

export const EditorStep: React.FC = () => {
  const shortcuts = [
    { label: 'Slash menu', shortcut: '/' },
    { label: 'Link a note', shortcut: '[[' },
    { label: 'Find & replace', shortcut: '⌘ H' },
  ];

  return (
    <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 mb-6">
      {shortcuts.map((item, i) => (
        <div
          key={item.label}
          className={`flex items-center justify-between py-1.5 text-sm text-zinc-600 dark:text-zinc-400 ${
            i > 0 ? 'border-t border-zinc-200 dark:border-zinc-700 mt-1.5 pt-1.5' : ''
          }`}
        >
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500" />
            <span>{item.label}</span>
          </div>
          <span className="text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded px-1.5 py-0.5 text-zinc-500 dark:text-zinc-400">
            {item.shortcut}
          </span>
        </div>
      ))}
    </div>
  );
};