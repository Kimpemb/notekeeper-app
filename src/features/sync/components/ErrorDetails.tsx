// src/features/sync/components/ErrorDetails.tsx
//
// Stage 4d.3, step 14b, batch 2. A collapsed "Details" line under a plain-language
// error. Holds the raw error text (cleaned and capped by classifyError) so a bug report
// can quote it, without putting it in the user's face.

interface Props {
  details: string;
}

export function ErrorDetails({ details }: Props) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-idemora-text-muted">Details</summary>
      <p className="mt-1 break-words text-xs text-idemora-text-muted">{details}</p>
    </details>
  );
}
