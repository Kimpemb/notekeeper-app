// src/features/onboarding/steps/WelcomeStep.tsx
import React from 'react';

export const WelcomeStep: React.FC = () => {
  const sampleNotes = [
    { title: 'Getting started', icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M2 3h10M2 7h10M2 11h6" strokeLinecap="round"/>
      </svg>
    )},
    { title: 'What I\'m working on', icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
        <circle cx="7" cy="7" r="2.5"/>
        <path d="M12 12L9 9" strokeLinecap="round"/>
      </svg>
    )},
    { title: 'Ideas & scratchpad', icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M3 2h8v10L7 9 3 12V2z" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )},
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
            <span className="text-zinc-500 dark:text-zinc-400">{note.icon}</span>
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {note.title}
            </span>
          </div>
        ))}
      </div>
    </>
  );
};