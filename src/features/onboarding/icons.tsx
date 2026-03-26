import React from 'react';

export const WelcomeIcon: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
  <svg className={className} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <path d="M9 2L2 6v6l7 4 7-4V6z" />
    <path d="M9 2v16M2 6l7 4 7-4" />
  </svg>
);

export const WorkspaceIcon: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
  <svg className={className} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <rect x="2" y="2" width="14" height="14" rx="3" />
    <path d="M7 2v14" />
  </svg>
);

export const EditorIcon: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
  <svg className={className} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <path d="M3 14L13 4l2 2L5 16H3v-2z" />
  </svg>
);

export const GraphIcon: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
  <svg className={className} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <circle cx="9" cy="9" r="2" />
    <circle cx="3" cy="4" r="1.5" />
    <circle cx="15" cy="4" r="1.5" />
    <circle cx="3" cy="14" r="1.5" />
    <circle cx="15" cy="14" r="1.5" />
    <path d="M7.5 7.5L4.5 5.5M10.5 7.5L13.5 5.5M7.5 10.5L4.5 12.5M10.5 10.5L13.5 12.5" />
  </svg>
);

export const CheckIcon: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
  <svg className={className} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <path d="M3 9l4 4 8-8" />
  </svg>
);