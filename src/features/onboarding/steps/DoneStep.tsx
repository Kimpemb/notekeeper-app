import React from 'react';

export const DoneStep: React.FC = () => {
  return (
    <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 mb-6 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
      <strong className="text-zinc-900 dark:text-zinc-100 font-medium">First tip:</strong>{' '}
      Long note titles fade in the sidebar instead of truncating. Try naming notes with full sentences — it reads cleanly.
    </div>
  );
};