import React from 'react';

export const GraphStep: React.FC = () => {
  return (
    <div className="h-[120px] bg-idemora-bg-primary /50 border-idemora-border  rounded-xl mb-6 relative overflow-hidden flex items-center justify-center">
      <svg viewBox="0 0 448 120" className="w-full h-full">
        {/* Connection lines */}
        <line x1="224" y1="60" x2="120" y2="40" stroke="currentColor" strokeWidth="1" className="text-idemora-text-normal " />
        <line x1="224" y1="60" x2="340" y2="35" stroke="currentColor" strokeWidth="1" className="text-idemora-text-normal " />
        <line x1="224" y1="60" x2="160" y2="90" stroke="currentColor" strokeWidth="1" className="text-idemora-text-normal " />
        <line x1="224" y1="60" x2="310" y2="88" stroke="currentColor" strokeWidth="1" className="text-idemora-text-normal " />
        <line x1="120" y1="40" x2="70" y2="68" stroke="currentColor" strokeWidth="0.8" className="text-idemora-text-muted " />
        <line x1="340" y1="35" x2="390" y2="62" stroke="currentColor" strokeWidth="0.8" className="text-idemora-text-muted " />
        <line x1="160" y1="90" x2="100" y2="100" stroke="currentColor" strokeWidth="0.8" className="text-idemora-text-muted " />
        
        {/* Nodes */}
        <circle cx="224" cy="60" r="7" fill="currentColor" className="text-idemora-text-normal" />
        <circle cx="120" cy="40" r="5" fill="currentColor" className="text-idemora-text-muted" />
        <circle cx="340" cy="35" r="5" fill="currentColor" className="text-idemora-text-muted" />
        <circle cx="160" cy="90" r="4" fill="currentColor" className="text-idemora-text-muted" />
        <circle cx="310" cy="88" r="4" fill="currentColor" className="text-idemora-text-muted" />
        <circle cx="70" cy="68" r="3" fill="currentColor" className="text-idemora-text-muted" />
        <circle cx="390" cy="62" r="3" fill="currentColor" className="text-idemora-text-muted" />
        <circle cx="100" cy="100" r="3" fill="currentColor" className="text-idemora-text-muted" />
      </svg>
    </div>
  );
};