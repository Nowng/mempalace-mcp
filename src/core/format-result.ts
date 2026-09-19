export interface TextChunk {
  type: string;
  text: string;
}

/**
 * A normalised MCP tool result. We deliberately decouple from the SDK's union
 * shape (which varies with the requested resultSchema) so the rest of the code
 * has a single, stable type to work with.
 */
export interface MemoResult {
  content: TextChunk[];
  isError?: boolean;
}

/**
 * Flatten a normalised result into a single human/model-readable string by
 * joining its text chunks.
 */
export function resultText(result: MemoResult | undefined): string {
  if (!result || !Array.isArray(result.content)) return 'MemPalace returned no response.';
  const texts = result.content.map((c) => c?.text ?? '').filter((t) => t.length > 0);
  return texts.length ? texts.join('\n') : 'MemPalace returned no text content.';
}
