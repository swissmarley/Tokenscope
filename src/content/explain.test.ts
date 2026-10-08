import { describe, expect, it } from 'vitest';
import { emptyView } from '../pipeline/derive';
import type { EventOf } from '../pipeline/events';
import { explainEvent } from './explain';

function chunk(wire: EventOf<'token_streamed'>['wire'], raw?: string): EventOf<'token_streamed'> {
  return {
    type: 'token_streamed',
    seq: 0,
    t: 120,
    baseDurationMs: 100,
    stage: 'loop',
    fidelity: wire === 'canned' ? 'illustrative' : 'real',
    step: 0,
    token: { id: 464, text: 'The', bytes: [84, 104, 101], index: 3 },
    text: 'The',
    chunkIndex: 0,
    wire,
    ...(raw === undefined ? {} : { raw }),
  };
}

const math = (e: EventOf<'token_streamed'>): string => explainEvent(e, emptyView()).math;

describe('explain: a chunk on the wire', () => {
  it('quotes the provider frame that arrived in Live mode', () => {
    const m = math(chunk('sse', 'data: {"choices":[{"delta":{"content":"The"}}]}'));
    expect(m).toContain('provider frame, as received: data: {"choices"');
    expect(m).not.toContain('content_block_delta');
  });

  it("quotes the lab server's own frame in Lab mode", () => {
    const m = math(chunk('lab', 'event: chunk\ndata: {"text": "The", "tokenId": 464, "t": 118}'));
    expect(m).toContain('lab server frame, as received: event: chunk · data: {"text": "The"');
    expect(m).not.toContain('content_block_delta');
  });

  it('labels the Anthropic-style frame as an example in Mock mode', () => {
    expect(math(chunk('canned'))).toMatch(/^example frame \(canned run\): event: content_block_delta · data: .*"text":"The"/);
  });
});
