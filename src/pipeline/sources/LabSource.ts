import type { Candidate, Fidelity, Mode, PipelineEvent, Settings, StageId, Token } from '../events';
import { sinusoidalPosition } from '../../sim/embed';
import { buildRequestBody, DUR } from '../../sim/runBuilder';
import { sequenced, type Emit, type EventSource } from './EventSource';
import { parseSse } from './sse';

/**
 * Real internals from the Python lab server (a small open model such as
 * distilgpt2): real tokens, embedding rows, attention per layer and head,
 * MLP activations, logits and the actual sampling draw. Everything emitted
 * here is `real` except a sinusoidal position illustration for models that
 * use rotary embeddings (they have no position table to show).
 */

interface Meta {
  model: string;
  arch: string;
  nLayers: number;
  nHeads: number;
  dModel: number;
  dHead: number;
  ffnHidden: number;
  vocabSize: number;
  tokenizer: string;
}
interface Tokenized {
  tokens: Token[];
}
interface Embedded {
  dims: number;
  shownDims: number;
  vectors: number[][];
  positional: number[][] | null;
  positionKind: 'learned' | 'rotary';
  projected: Array<[number, number]>;
}
interface FfnStat {
  sparsity: number;
  sample: number[];
}
interface Prefill {
  attentions: number[][][][];
  residualNorms: number[];
  ffn: FfnStat[];
}
interface Step {
  step: number;
  seqLen: number;
  token: Token;
  candidates: Candidate[];
  tailMass: number;
  prob: number;
  rank: number;
  roll: number;
  isEos: boolean;
  attentions: number[][][] | null;
  residualNorms: number[] | null;
  ffn: FfnStat[] | null;
}
interface Chunk {
  text: string;
  tokenId: number;
}
interface Done {
  stopReason: string;
  usage: { input: number; output: number };
  text: string;
}

type Payload<T extends PipelineEvent['type']> = Omit<
  Extract<PipelineEvent, { type: T }>,
  'seq' | 't' | 'baseDurationMs' | 'stage' | 'fidelity' | 'step'
>;

export interface LabConnection {
  /** Call the Python server straight from the browser (static hosting) instead of via the proxy. */
  direct: boolean;
  proxyUrl: string;
  labUrl: string;
}

export class LabSource implements EventSource {
  readonly kind: Mode = 'lab';

  constructor(private readonly conn: LabConnection) {}

  async run(prompt: string, settings: Settings, emit: Emit, signal: AbortSignal): Promise<void> {
    const out = sequenced(emit);
    const t0 = performance.now();
    const now = (): number => Math.round(performance.now() - t0);
    const push = <T extends PipelineEvent['type']>(
      stage: StageId,
      step: number,
      baseDurationMs: number,
      payload: Payload<T> & { type: T },
      fidelity: Fidelity = 'real',
    ): void => {
      out({ ...(payload as object), seq: 0, t: now(), baseDurationMs, stage, fidelity, step } as PipelineEvent);
    };

    const runId = `lab-${Date.now().toString(36)}`;
    // Small local models ramble; keep lab runs watchable.
    const maxTokens = Math.min(settings.maxTokens, 128);
    settings = { ...settings, model: 'local lab model (distilgpt2)', maxTokens };
    const body = buildRequestBody(prompt, settings);
    let meta: Meta | null = null;
    let promptTokens: Token[] = [];
    const context: Token[] = [];
    let computeSaved = 0;
    let chunkIndex = 0;
    let firstByte = false;

    push<'run_start'>('compose', 0, DUR.runStart, {
      type: 'run_start',
      runId,
      mode: 'lab',
      prompt,
      model: settings.model,
      settings,
    });
    push<'request_built'>('compose', 0, DUR.requestBuilt, {
      type: 'request_built',
      body,
      bytes: new TextEncoder().encode(JSON.stringify(body)).length,
    });

    const url = this.conn.direct ? `${this.conn.labUrl.replace(/\/$/, '')}/run` : `${this.conn.proxyUrl.replace(/\/$/, '')}/lab/run`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        max_tokens: maxTokens,
        temperature: settings.temperature,
        top_k: settings.topK,
        top_p: settings.topP,
      }),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`Lab server: ${res.status}${text ? ` — ${text.slice(0, 300)}` : ''}. Start it with \`npm run lab\` (lab-server/).`);
    }

    const emitLayerPass = (
      stage: StageId,
      step: number,
      seqLen: number,
      residual: number[],
      ffn: FfnStat[],
      attn: (layer: number) => number[][][],
      kvPositions: number[],
      first: boolean,
    ): void => {
      const m = meta as Meta;
      const decode = step > 0;
      for (let l = 0; l < m.nLayers; l++) {
        const isFirst = first && l === 0;
        push<'layer_start'>(stage, step, decode ? DUR.decodeLayerStart : isFirst ? DUR.layer0Start : DUR.layerStart, {
          type: 'layer_start',
          layer: l,
          nLayers: m.nLayers,
          seqLen,
        });
        if (decode) {
          push<'attention'>(stage, step, DUR.decodeAttention, {
            type: 'attention',
            layer: l,
            nHeads: m.nHeads,
            dHead: m.dHead,
            heads: attn(l),
            seqLen,
          });
          computeSaved += (seqLen - 1) * 2;
          push<'kv_cache_update'>(stage, step, DUR.decodeKv, {
            type: 'kv_cache_update',
            layer: l,
            positions: kvPositions,
            cachedTokens: seqLen,
            computeSaved,
            phase: 'decode',
          });
        }
        const f = ffn[l] ?? { sparsity: 0, sample: [] };
        push<'ffn'>(stage, step, decode ? DUR.decodeFfn : isFirst ? DUR.layer0Ffn : DUR.layerFfn, {
          type: 'ffn',
          layer: l,
          hiddenDim: m.ffnHidden,
          activationSparsity: f.sparsity,
          sample: f.sample,
        });
        push<'layer_end'>(stage, step, decode ? DUR.decodeLayerEnd : isFirst ? DUR.layer0End : DUR.layerEnd, {
          type: 'layer_end',
          layer: l,
          residualNorm: residual[l] ?? 0,
        });
      }
      if (!decode) {
        for (let l = 0; l < m.nLayers; l++) {
          push<'attention'>('attention', 0, l === 0 ? DUR.attention0 : DUR.attentionN, {
            type: 'attention',
            layer: l,
            nHeads: m.nHeads,
            dHead: m.dHead,
            heads: attn(l),
            seqLen,
          });
        }
        for (let l = 0; l < m.nLayers; l++) {
          push<'kv_cache_update'>('kvcache', 0, l === m.nLayers - 1 ? DUR.kvLast : DUR.kv, {
            type: 'kv_cache_update',
            layer: l,
            positions: kvPositions,
            cachedTokens: seqLen,
            computeSaved: 0,
            phase: 'prefill',
          });
        }
      }
    };

    let stopReason = 'unknown';
    let usage = { input: 0, output: 0 };
    let finalText = '';
    let stepsSeen = 0;

    for await (const msg of parseSse(res.body, signal)) {
      if (signal.aborted) return;
      if (!firstByte) {
        firstByte = true;
        push<'request_sent'>('compose', 0, DUR.requestSent, {
          type: 'request_sent',
          hops: [{ label: 'Browser → proxy → lab server → first byte', ms: now() }],
          totalMs: now(),
        });
      }
      switch (msg.event) {
        case 'meta': {
          meta = JSON.parse(msg.data) as Meta;
          break;
        }
        case 'tokenized': {
          const d = JSON.parse(msg.data) as Tokenized;
          promptTokens = d.tokens;
          context.push(...promptTokens);
          push<'tokenized'>('tokenize', 0, DUR.tokenized, {
            type: 'tokenized',
            tokens: promptTokens,
            tokenizer: meta?.tokenizer ?? 'lab tokenizer',
            vocabSize: meta?.vocabSize ?? 0,
            hiddenTokenCount: 0,
          });
          break;
        }
        case 'embedded': {
          const d = JSON.parse(msg.data) as Embedded;
          const positional =
            d.positional ?? promptTokens.map((t) => sinusoidalPosition(t.index, d.dims, d.shownDims));
          push<'embedded'>(
            'embed',
            0,
            DUR.embedded,
            {
              type: 'embedded',
              dims: d.dims,
              shownDims: d.shownDims,
              vectors: d.vectors,
              positional,
              projected: d.projected,
            },
            d.positional ? 'real' : 'illustrative',
          );
          break;
        }
        case 'prefill': {
          const d = JSON.parse(msg.data) as Prefill;
          emitLayerPass('layers', 0, promptTokens.length, d.residualNorms, d.ffn, (l) => d.attentions[l] ?? [], promptTokens.map((t) => t.index), true);
          break;
        }
        case 'step': {
          const d = JSON.parse(msg.data) as Step;
          stepsSeen = d.step + 1;
          if (d.step > 0 && d.attentions && d.residualNorms && d.ffn) {
            const att = d.attentions;
            emitLayerPass('loop', d.step, d.seqLen, d.residualNorms, d.ffn, (l) => (att[l] ?? []).map((row) => [row]), [d.seqLen - 1], false);
          }
          const stage: StageId = d.step === 0 ? 'sample' : 'loop';
          push<'logits'>(stage, d.step, d.step === 0 ? DUR.logits0 : DUR.decodeLogits, {
            type: 'logits',
            candidates: d.candidates,
            tailMass: d.tailMass,
            vocabSize: meta?.vocabSize ?? 0,
            temperature: settings.temperature,
            topK: settings.topK,
            topP: settings.topP,
          });
          push<'sampled'>(stage, d.step, d.step === 0 ? DUR.sampled0 : DUR.decodeSampled, {
            type: 'sampled',
            token: d.token,
            prob: d.prob,
            rank: d.rank,
            roll: d.roll,
            isEos: d.isEos,
          });
          if (!d.isEos) context.push(d.token);
          break;
        }
        case 'chunk': {
          const d = JSON.parse(msg.data) as Chunk;
          const tok = context[context.length - 1] ?? { id: d.tokenId, text: d.text, bytes: [], index: context.length };
          push<'token_streamed'>('loop', Math.max(0, stepsSeen - 1), chunkIndex === 0 ? DUR.streamed0 : DUR.decodeStreamed, {
            type: 'token_streamed',
            token: tok,
            text: d.text,
            chunkIndex: chunkIndex++,
            wire: 'lab',
            raw: msg.raw,
          });
          break;
        }
        case 'done': {
          const d = JSON.parse(msg.data) as Done;
          stopReason = d.stopReason;
          usage = d.usage;
          finalText = d.text;
          break;
        }
        case 'error': {
          const d = JSON.parse(msg.data) as { message: string };
          throw new Error(d.message);
        }
        default:
          break;
      }
    }

    const generated = context.slice(promptTokens.length);
    const step = Math.max(0, stepsSeen - 1);
    const firstChunk = firstByte ? now() : 0;
    push<'detokenized'>('stream', step, DUR.detokenized, { type: 'detokenized', text: finalText, tokens: generated });
    const tEnd = now();
    push<'done'>('stream', step, DUR.done, {
      type: 'done',
      stopReason,
      usage,
      ttftMs: firstChunk,
      totalMs: tEnd,
      tokensPerSec: generated.length > 1 ? (generated.length - 1) / Math.max(0.001, tEnd / 1000) : 0,
    });
  }
}
