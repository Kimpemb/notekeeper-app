// src/features/importer/lib/importErrors.ts

export type ImportErrorCode =
  | "OVERSIZED_FILE"
  | "ENCRYPTED_PDF"
  | "SCANNED_PDF"
  | "CORRUPT_FILE"
  | "EMPTY_CONVERSION"
  | "DUPLICATE"
  | "USER_CANCELLED"

export class ImportError extends Error {
  constructor(
    public readonly code: ImportErrorCode,
    message: string
  ) {
    super(message)
    this.name = "ImportError"
  }
}

export const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

export function checkFileSize(byteLength: number): void {
  if (byteLength > MAX_FILE_SIZE) {
    throw new ImportError(
      "OVERSIZED_FILE",
      `This file is ${(byteLength / 1024 / 1024).toFixed(0)} MB. Files over 50 MB may be slow to process — do you want to continue?`
    )
  }
}

export function userFriendlyMessage(err: unknown): string {
  if (err instanceof ImportError) return err.message
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes("password") || msg.includes("encrypted"))
    return "This PDF is password-protected and cannot be imported."
  if (msg.includes("Invalid PDF") || msg.includes("corrupt") || msg.includes("unexpected"))
    return "This file could not be read. It may be damaged."
  return `Import failed: ${msg}`
}