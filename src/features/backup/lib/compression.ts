// src/features/backup/lib/compression.ts
//
// Shared gzip compress / decompress helpers.
// Used by both backup.ts (manual export/restore) and scheduler.ts (auto-backup).

export async function compress(input: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(new TextEncoder().encode(input));
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const total  = chunks.reduce((n, c) => n + c.length, 0);
  const result = new Uint8Array(new ArrayBuffer(total));
  let offset   = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result as Uint8Array<ArrayBuffer>;
}

export async function decompress(input: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(input);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const total  = chunks.reduce((n, c) => n + c.length, 0);
  const result = new Uint8Array(new ArrayBuffer(total));
  let offset   = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(result);
}