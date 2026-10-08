import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PipelineEvent, Settings } from '../events';
import { LabSource } from './LabSource';

const conn = { direct: false, proxyUrl: '/api', labUrl: 'http://localhost:8788', model: 'gpt2' };

const settings: Settings = { model: '', systemPrompt: '', maxTokens: 64, temperature: 0.7, topK: 40, topP: 0.95 };

const tok = (id: number, text: string, index: number) => ({ id, text, bytes: [...new TextEncoder().encode(text)], index });

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}`;
}

/** A two-token prompt, one layer, one head; `delayMs` before each frame after `prefill`. */
function labFrames(end: 'done' | 'error' | 'cut'): Array<{ frame: string; delayMs: number }> {
  const ffn = [{ sparsity: 0.5, sample: [0.1] }];
  const frames = [
    { frame: frame('meta', { model: 'gpt2', arch: 'gpt2', nLayers: 1, nHeads: 1, dModel: 4, dHead: 4, ffnHidden: 16, vocabSize: 100, tokenizer: 'gpt2 BPE' }), delayMs: 0 },
    { frame: frame('tokenized', { tokens: [tok(1, 'Hi', 0), tok(2, ' there', 1)] }), delayMs: 0 },
    { frame: frame('embedded', { dims: 4, shownDims: 2, vectors: [[0, 1], [1, 0]], positional: [[0, 0], [0, 1]], positionKind: 'learned', projected: [[0, 0], [1, 1]] }), delayMs: 0 },
    // Lower triangle only: row q has q + 1 weights.
    { frame: frame('prefill', { attentions: [[[[1], [0.4, 0.6]]]], residualNorms: [1], ffn }), delayMs: 0 },
    { frame: frame('step', { step: 0, seqLen: 2, token: tok(3, '!', 2), candidates: [{ token: tok(3, '!', 2), logit: 2, prob: 0.9 }], tailMass: 0.1, prob: 0.9, rank: 0, roll: 0.3, isEos: false, attentions: null, residualNorms: null, ffn: null }), delayMs: 30 },
    { frame: frame('chunk', { text: '!', tokenId: 3 }), delayMs: 0 },
    { frame: frame('step', { step: 1, seqLen: 3, token: tok(4, ' Bye', 3), candidates: [{ token: tok(4, ' Bye', 3), logit: 2, prob: 0.9 }], tailMass: 0.1, prob: 0.9, rank: 0, roll: 0.3, isEos: false, attentions: [[[0.2, 0.3, 0.5]]], residualNorms: [1], ffn }), delayMs: 60 },
    { frame: frame('chunk', { text: ' Bye', tokenId: 4 }), delayMs: 0 },
  ];
  if (end === 'done') frames.push({ frame: frame('done', { stopReason: 'max_tokens', usage: { input: 2, output: 2 }, text: '! Bye' }), delayMs: 0 });
  if (end === 'error') frames.push({ frame: frame('error', { message: 'Lab server: IndexError: index out of range in self' }), delayMs: 0 });
  return frames;
}

function sseBody(frames: Array<{ frame: string; delayMs: number }>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const f of frames) {
        if (f.delayMs) await new Promise((r) => setTimeout(r, f.delayMs));
        controller.enqueue(enc.encode(f.frame + '\n\n'));
      }
      controller.close();
    },
  });
}

async function runWith(body: ReadableStream<Uint8Array>): Promise<PipelineEvent[]> {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
  const events: PipelineEvent[] = [];
  await new LabSource(conn).run('Hi there', settings, (e) => events.push(e), new AbortController().signal);
  return events;
}

describe('LabSource', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('names the loaded model, pads causal attention rows and measures TTFT apart from the total', async () => {
    const events = await runWith(sseBody(labFrames('done')));

    const start = events.find((e) => e.type === 'run_start');
    expect(start?.type === 'run_start' && start.model).toBe('local lab model (gpt2)');

    const prefillAttn = events.find((e) => e.type === 'attention' && e.stage === 'attention');
    expect(prefillAttn?.type === 'attention' && prefillAttn.heads).toEqual([[[1, 0], [0.4, 0.6]]]);

    const done = events[events.length - 1];
    expect(done?.type).toBe('done');
    if (done?.type !== 'done') return;
    expect(done.ttftMs).toBeGreaterThanOrEqual(25);
    expect(done.totalMs - done.ttftMs).toBeGreaterThanOrEqual(50);
    // One token after the first, over the time after the first.
    expect(done.tokensPerSec).toBeCloseTo(1000 / (done.totalMs - done.ttftMs), 5);
  });

  it('relays an error event from the lab server', async () => {
    await expect(runWith(sseBody(labFrames('error')))).rejects.toThrow('IndexError');
  });

  it('fails instead of finishing quietly when the stream stops without done', async () => {
    await expect(runWith(sseBody(labFrames('cut')))).rejects.toThrow(/closed the stream/);
  });

  it('shows why the lab server rejected the request', async () => {
    const body = JSON.stringify({ error: 'Prompt is 200 tokens; the lab server accepts at most 128.' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 400 })));
    await expect(new LabSource(conn).run('x', settings, () => {}, new AbortController().signal)).rejects.toThrow(/400 — Prompt is 200 tokens/);
  });
});
