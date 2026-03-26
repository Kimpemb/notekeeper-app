import React from 'react';

export const WelcomeStep: React.FC = () => {
  const sampleNotes = [
    { title: 'Getting started', icon: '📝' },
    { title: 'What I\'m working on', icon: '🎯' },
    { title: 'Ideas & scratchpad', icon: '💡' },
  ];

  return (
    <>
      <div className="text-xl font-medium text-zinc-900 dark:text-zinc-100 mb-1.5 tracking-tight">
        Welcome to Idemora
      </div>
      <div className="text-sm text-zinc-500 dark:text-zinc-400 mb-7 leading-relaxed">
        A quiet place for your notes, ideas, and the connections between them.
      </div>
      <div className="space-y-1.5 mb-6">
        {sampleNotes.map((note) => (
          <div
            key={note.title}
            className="flex items-center gap-2.5 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg"
          >
            <span className="text-base">{note.icon}</span>
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {note.title}
            </span>
          </div>
        ))}
      </div>
    </>
  );
};