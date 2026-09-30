import type { Mode, Settings, Usage } from '../events';
import { RunBuilder } from '../../sim/runBuilder';
import { eosToken, tokenize } from '../../sim/tokenize';
import { streamChat, type StreamEventName } from '../../shared/llmStream';
import { sequenced, type Emit, type EventSource } from './EventSource';
import { parseSse } from './sse';

/**
 * Streams a real completion, either through the proxy (key in server/.env)
 * or directly from the browser (key the user stored in this browser).
 * Real: the request, timing, every text chunk, stop reason and usage.
 * Illustrative: tokenization (GPT-2 BPE), embeddings, layers, attention,
 * KV cache and logits — the API does not expose them, and every such
 * event is labelled.
 */

export interface LiveConnection {
  mode: 'proxy' | 'direct';
  proxyUrl: string;
  provider: 'anthropic' | 'openai';
  apiKey: string;
  baseUrl: string;
}

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

  constructor(private readonly conn: LiveConnection) {}

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

    let firstByte = false;
    let stopReason = 'unknown';
    let usage = null as Usage | null;
    let text = '';

    const onFirstByte = (): void => {
      if (firstByte) return;
      firstByte = true;
      const t = now();
      b.requestSent(t, [{ label: `Browser → ${this.conn.mode === 'proxy' ? 'proxy → ' : ''}API → first byte`, ms: t }], 'real');
      b.tokenized(t);
      b.embedded(t);
      b.prefill(Math.max(1, t - 40), t);
    };

    const handle = (event: StreamEventName | string, data: unknown): void => {
      if (signal.aborted) return;
      onFirstByte();
      switch (event) {
        case 'meta': {
          const meta = data as MetaData;
          if (meta.usage?.input) usage = { input: meta.usage.input, output: 0 };
          break;
        }
        case 'delta': {
          const d = data as DeltaData;
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
          const d = data as DoneData;
          stopReason = d.stopReason;
          usage = { input: d.usage.input || usage?.input || 0, output: d.usage.output };
          break;
        }
        case 'error': {
          const d = data as ErrorData;
          throw new Error(d.message);
        }
        default:
          break;
      }
    };

    if (this.conn.mode === 'direct') {
      if (!this.conn.apiKey && this.conn.provider === 'anthropic') {
        throw new Error('No API key: open Settings → Connection and paste your key (it stays in this browser).');
      }
      await streamChat(
        { provider: this.conn.provider, apiKey: this.conn.apiKey, baseUrl: this.conn.baseUrl, fromBrowser: true },
        b.body,
        handle,
        signal,
      );
    } else {
      const base = this.conn.proxyUrl.replace(/\/$/, '');
      const res = await fetch(`${base}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(b.body),
        signal,
      });
      if (!res.ok || !res.body) {
        const raw = await res.text().catch(() => '');
        let detail = raw.slice(0, 300);
        try {
          const parsed = JSON.parse(raw) as { error?: string };
          if (parsed.error) detail = parsed.error;
        } catch {
          /* not JSON */
        }
        throw new Error(`Proxy responded ${res.status}${detail ? `: ${detail}` : ''}`);
      }
      for await (const msg of parseSse(res.body, signal)) {
        if (signal.aborted) return;
        let data: unknown = null;
        try {
          data = JSON.parse(msg.data);
        } catch {
          continue;
        }
        handle(msg.event, data);
      }
    }
    if (signal.aborted) return;

    const tEnd = now();
    if (stopReason === 'end_turn' || stopReason === 'stop') {
      // The model emitted its stop token; the draw itself is illustrative.
      b.predict(tEnd - 2, eosToken(b.context.length), { isEos: true });
    }
    b.finish(tEnd, usage ? { stopReason, usage, text } : { stopReason, text });
  }
}
