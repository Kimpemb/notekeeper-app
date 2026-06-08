declare module "mammoth/mammoth.browser" {
  export function convertToMarkdown(
    input: { arrayBuffer: ArrayBuffer },
    options?: { styleMap?: string }
  ): Promise<{ value: string; messages: unknown[] }>;

  export function convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: { styleMap?: string }
  ): Promise<{ value: string; messages: unknown[] }>;
}
