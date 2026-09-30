import type { Mode, Settings, Usage } from '../events';
import { RunBuilder } from '../../sim/runBuilder';
import { eosToken, tokenize } from '../../sim/tokenize';
import { sequenced, type Emit, type EventSource } from './EventSource';
import { parseSse } from './sse';

/**
 * Streams a real completion through the proxy. Real: the request, timing,
 * every text chunk, stop reason and usage. Illustrative: tokenization
 * (GPT-2 BPE), embeddings, layers, attention, KV cache and logits — the
 * API does not expose them, and they are labelled as such on every event.
 */

interface MetaData {
  provider: string;
  model: string;
  usage?: Partial<Usage>;
}
interface DeltaData {
  text: string;
  raw?: string;
}
interface DoneData {
  stopReason: string;
  usage: Usage;
}
interface ErrorData {
  message: string;
}

export class LiveSource implements EventSource {
  readonly kind: Mode = 'live';

  constructor(private readonly proxyUrl: string) {}

  async run(prompt: string, settings: Settings, emit: Emit, signal: AbortSignal): Promise<void> {
    const t0 = performance.now();
    const now = (): number => Math.round(performance.now() - t0);
    const b = new RunBuilder({
      runId: `live-${Date.now().toString(36)}`,
      mode: 'live',
      prompt,
      settings,
      emit: sequenced(emit),
    });

    b.runStart(now());
    b.requestBuilt(now());

    const base = this.proxyUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b.body),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      let detail = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error) detail = parsed.error;
      } catch {
        /* not JSON */
      }
      throw new Error(`Proxy responded ${res.status}${detail ? `: ${detail}` : ''}`);
    }

    let firstByte = false;
    let stopReason = 'unknown';
    let usage = null as Usage | null;
    let text = '';

    for await (const msg of parseSse(res.body, signal)) {
      if (signal.aborted) return;
      if (!firstByte) {
        firstByte = true;
        const t = now();
        b.requestSent(t, [{ label: 'Browser → proxy → API → first byte', ms: t }], 'real');
        b.tokenized(t);
        b.embedded(t);
        b.prefill(Math.max(1, t - 40), t);
      }
      switch (msg.event) {
        case 'meta': {
          const meta = JSON.parse(msg.data) as MetaData;
          if (meta.usage?.input) usage = { input: meta.usage.input, output: 0 };
          break;
        }
        case 'delta': {
          const d = JSON.parse(msg.data) as DeltaData;
          if (!d.text) break;
          const t = now();
          const toks = tokenize(d.text, b.context.length);
          for (const tok of toks) b.predict(t, tok, { isEos: false });
          const last = toks[toks.length - 1];
          if (last) b.streamed(t, last, d.text, 'sse', d.raw);
          text += d.text;
          break;
        }
        case 'done': {
          const d = JSON.parse(msg.data) as DoneData;
          stopReason = d.stopReason;
          usage = { input: d.usage.input || usage?.input || 0, output: d.usage.output };
          break;
        }
        case 'error': {
          const d = JSON.parse(msg.data) as ErrorData;
          throw new Error(d.message);
        }
        default:
          break;
      }
    }

    const tEnd = now();
    if (stopReason === 'end_turn' || stopReason === 'stop') {
      // The model emitted its stop token; the draw itself is illustrative.
      b.predict(tEnd - 2, eosToken(b.context.length), { isEos: true });
    }
    b.finish(tEnd, usage ? { stopReason, usage, text } : { stopReason, text });
  }
}
