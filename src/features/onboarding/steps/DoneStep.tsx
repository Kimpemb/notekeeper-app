import React from 'react';

export const DoneStep: React.FC = () => {
  return (
    <div className="bg-idemora-bg-primary /50 border-idemora-border  rounded-xl p-4 mb-6 text-sm text-idemora-text-normal text-idemora-text-muted leading-relaxed">
      <strong className="text-idemora-text-normal font-medium">First tip:</strong>{' '}
      Long note titles fade in the sidebar instead of truncating. Try naming notes with full sentences — it reads cleanly.
    </div>
  );
};