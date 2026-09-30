import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PipelineEvent, Settings } from '../events';
import { LiveSource } from './LiveSource';
import { parseFrame } from './sse';

const settings: Settings = {
  model: 'claude-test',
  systemPrompt: 'Be brief.',
  maxTokens: 64,
  temperature: 0.7,
  topK: 40,
  topP: 0.95,
};

function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const f of frames) {
        controller.enqueue(enc.encode(f + '\n\n'));
        await new Promise((r) => setTimeout(r, 2));
      }
      controller.close();
    },
  });
}

describe('SSE frame parsing', () => {
  it('reads event and multi-line data', () => {
    const f = parseFrame('event: delta\ndata: {"a":1}\ndata: {"b":2}');
    expect(f).toEqual({ event: 'delta', data: '{"a":1}\n{"b":2}', raw: 'event: delta\ndata: {"a":1}\ndata: {"b":2}' });
  });
  it('ignores comments and empty frames', () => {
    expect(parseFrame(': keep-alive')).toBeNull();
    expect(parseFrame('')).toBeNull();
  });
});

describe('LiveSource', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns a normalised SSE stream into a full, well-ordered event log', async () => {
    const frames = [
      'event: meta\ndata: {"provider":"anthropic","model":"claude-test","usage":{"input":21}}',
      'event: delta\ndata: {"text":"The","raw":"event: content_block_delta\\ndata: {}"}',
      'event: delta\ndata: {"text":" trophy was"}',
      'event: delta\ndata: {"text":" too big."}',
      'event: done\ndata: {"stopReason":"end_turn","usage":{"input":21,"output":6}}',
    ];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }>; stream: boolean };
      expect(body.messages[0]?.content).toBe('What was too big?');
      expect(body.stream).toBe(true);
      return new Response(sseBody(frames), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const events: PipelineEvent[] = [];
    await new LiveSource('/api').run('What was too big?', settings, (e) => events.push(e), new AbortController().signal);

    const types = events.map((e) => e.type);
    expect(types.slice(0, 5)).toEqual(['run_start', 'request_built', 'request_sent', 'tokenized', 'embedded']);
    expect(types.filter((t) => t === 'token_streamed')).toHaveLength(3);
    expect(types[types.length - 2]).toBe('detokenized');
    expect(types[types.length - 1]).toBe('done');

    // seq is contiguous and t is monotonic-ish within real events
    events.forEach((e, i) => expect(e.seq).toBe(i));

    // Real vs illustrative labelling
    const byType = (t: PipelineEvent['type']) => events.filter((e) => e.type === t);
    expect(byType('request_sent')[0]?.fidelity).toBe('real');
    expect(byType('token_streamed').every((e) => e.fidelity === 'real')).toBe(true);
    expect(byType('attention').every((e) => e.fidelity === 'illustrative')).toBe(true);
    expect(byType('logits').every((e) => e.fidelity === 'illustrative')).toBe(true);

    // Chunk text is preserved verbatim; the raw wire frame rides along when given
    const streamed = byType('token_streamed');
    expect(streamed.map((e) => (e.type === 'token_streamed' ? e.text : '')).join('')).toBe('The trophy was too big.');
    expect(streamed[0]?.type === 'token_streamed' && streamed[0].raw).toContain('content_block_delta');

    // The multi-token chunk " trophy was" produced one prediction step per BPE token
    const sampled = byType('sampled');
    expect(sampled.length).toBeGreaterThanOrEqual(6); // 5 word tokens + '.' + EOS ≥ 6
    const lastSampled = sampled[sampled.length - 1];
    expect(lastSampled?.type === 'sampled' && lastSampled.isEos).toBe(true);

    const done = events[events.length - 1];
    expect(done?.type === 'done' && done.usage).toEqual({ input: 21, output: 6 });
    expect(done?.type === 'done' && done.stopReason).toBe('end_turn');
  });

  it('surfaces proxy errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('No API key', { status: 503 })));
    await expect(new LiveSource('/api').run('hi', settings, () => {}, new AbortController().signal)).rejects.toThrow(/503/);
  });

  it('relays stream errors from the provider', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(sseBody(['event: error\ndata: {"message":"rate limited"}']), { status: 200 })),
    );
    await expect(new LiveSource('/api').run('hi', settings, () => {}, new AbortController().signal)).rejects.toThrow('rate limited');
  });
});
