// src/features/ui/components/VaultDuplicateModal.tsx

import type { DuplicatePromptPayload } from '@/features/vault/lib/pipeline'

interface Props {
  open: boolean
  payload: DuplicatePromptPayload | null
  onAction: (action: 'import' | 'replace' | 'skip') => void
}

export function VaultDuplicateModal({ open, payload, onAction }: Props) {
  if (!open || !payload) return null

  const date = new Date(payload.existingDate).toLocaleDateString([], {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  const charDiffLabel = payload.charDiff > 0
    ? `The new file has approximately ${payload.charDiff} more characters.`
    : 'The files are nearly identical in length.'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50">
      <div
        className="w-[480px] rounded-lg bg-idemora-bg-primary border border-idemora-border shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-7 pt-7 pb-4">
          <p className="text-base font-semibold text-idemora-text-normal mb-1">
            Similar file detected
          </p>
          <p className="text-sm text-idemora-text-muted leading-relaxed">
            This file looks very similar to{' '}
            <span className="font-medium text-idemora-text-normal">
              {payload.existingFileName}
            </span>{' '}
            imported on {date}. {charDiffLabel}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 px-7 pb-7 pt-2">
          <button
            onClick={() => onAction('import')}
            className="w-full px-4 py-2.5 rounded-md text-sm font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors text-left"
          >
            <span className="font-semibold">Import as new session</span>
            <span className="block text-xs text-blue-400/70 mt-0.5">
              Keep the existing entry and create a new one
            </span>
          </button>
          <button
            onClick={() => onAction('replace')}
            className="w-full px-4 py-2.5 rounded-md text-sm font-medium bg-idemora-bg-secondary border border-idemora-border text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors text-left"
          >
            <span className="font-semibold">Replace existing</span>
            <span className="block text-xs text-idemora-text-muted mt-0.5">
              Delete the old entry and import this file instead
            </span>
          </button>
          <button
            onClick={() => onAction('skip')}
            className="w-full px-4 py-2.5 rounded-md text-sm text-idemora-text-muted border border-idemora-border hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors text-left"
          >
            <span className="font-semibold">Skip</span>
            <span className="block text-xs mt-0.5">
              Don't import this file
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}