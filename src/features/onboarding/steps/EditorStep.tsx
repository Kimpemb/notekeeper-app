import React from 'react';

export const EditorStep: React.FC = () => {
  const shortcuts = [
    { label: 'Slash menu', shortcut: '/' },
    { label: 'Link a note', shortcut: '[[' },
    { label: 'Find & replace', shortcut: '⌘ H' },
  ];

  return (
    <div className="bg-idemora-bg-primary /50 border-idemora-border  rounded-xl p-4 mb-6">
      {shortcuts.map((item, i) => (
        <div
          key={item.label}
          className={`flex items-center justify-between py-1.5 text-sm text-idemora-text-normal text-idemora-text-muted ${
            i > 0 ? 'border-t border-idemora-border  mt-1.5 pt-1.5' : ''
          }`}
        >
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-idemora-bg-primary " />
            <span>{item.label}</span>
          </div>
          <span className="text-xs font-mono bg-idemora-bg-primary border-idemora-border  rounded px-1.5 py-0.5 text-idemora-text-muted">
            {item.shortcut}
          </span>
        </div>
      ))}
    </div>
  );
};