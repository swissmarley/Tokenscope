import type { EventOf } from './events';

type Streamed = EventOf<'token_streamed'>;

/**
 * The SSE frame to show for a chunk: the one that actually arrived when the source kept it
 * (Anthropic, OpenAI-compatible or lab server), else an Anthropic-style example for canned runs.
 * Returned as [field, value] lines; a line without a field has field ''.
 */
export function wireFrame(c: Streamed): Array<[string, string]> {
  const raw =
    c.raw ??
    `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: c.text } })}`;
  return raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const colon = line.indexOf(':');
      return colon > 0 ? [line.slice(0, colon), line.slice(colon + 1).trimStart()] : ['', line];
    });
}

/** Where the frame from `wireFrame` came from. */
export function wireLabel(c: Streamed): string {
  if (!c.raw) return 'example frame (canned run)';
  return c.wire === 'lab' ? 'lab server frame, as received' : 'provider frame, as received';
}
