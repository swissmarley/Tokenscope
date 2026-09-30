import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropic } from './anthropic';

function sse(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(f + '\n\n'));
      c.close();
    },
  });
}

describe('anthropic provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('normalises the Messages stream into meta / delta / done', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const frames = [
      'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-x","usage":{"input_tokens":12,"output_tokens":1}}}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
      'event: message_stop\ndata: {"type":"message_stop"}',
    ];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      const headers = init?.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('test-key');
      const body = JSON.parse(String(init?.body)) as { system?: string; stream: boolean };
      expect(body.system).toBe('sys');
      expect(body.stream).toBe(true);
      return new Response(sse(frames), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const sent: Array<[string, unknown]> = [];
    await anthropic.stream(
      { model: 'claude-x', max_tokens: 10, temperature: 0.5, system: 'sys', messages: [{ role: 'user', content: 'hey' }] },
      (e, d) => sent.push([e, d]),
      new AbortController().signal,
    );
    expect(sent[0]?.[0]).toBe('meta');
    expect(sent.filter(([e]) => e === 'delta').map(([, d]) => (d as { text: string }).text)).toEqual(['Hi', ' there']);
    expect((sent.find(([e]) => e === 'delta')?.[1] as { raw: string }).raw).toContain('content_block_delta');
    expect(sent[sent.length - 1]).toEqual(['done', { stopReason: 'end_turn', usage: { input: 12, output: 2 } }]);
  });

  it('refuses to run without a key', async () => {
    await expect(
      anthropic.stream({ model: 'x', max_tokens: 1, temperature: 0, messages: [{ role: 'user', content: 'hi' }] }, () => {}, new AbortController().signal),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});
