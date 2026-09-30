import type {
  Fidelity,
  Hop,
  Mode,
  PipelineEvent,
  RequestBody,
  Settings,
  StageId,
  Token,
  Usage,
} from '../pipeline/events';
import { rollFor, sampleDistribution } from '../math/softmax';
import { assignHeadKinds, attentionForLayer, HEAD_KIND_LABEL } from './attention';
import { embedTokens } from './embed';
import { simulateLogits } from './logits';
import { rngFor, type Rng } from './prng';
import { countTokens, TOKENIZER_NAME, tokenize, VOCAB_SIZE } from './tokenize';

/**
 * Builds pipeline events incrementally. MockSource drives it with synthetic
 * timestamps; LiveSource drives it with real ones as chunks arrive. Anything
 * the API does not expose is generated here and flagged `illustrative`.
 */

export interface ModelGeometry {
  nLayers: number;
  nHeads: number;
  dModel: number;
  dHead: number;
  ffnHidden: number;
  shownDims: number;
}

export const DEFAULT_GEOMETRY: ModelGeometry = {
  nLayers: 12,
  nHeads: 12,
  dModel: 768,
  dHead: 64,
  ffnHidden: 3072,
  shownDims: 48,
};

/** Base holds at 1×, in ms. A full mock run is ≈ 60 s at 1×. */
export const DUR = {
  runStart: 500,
  requestBuilt: 1800,
  requestSent: 1600,
  tokenized: 2400,
  embedded: 2600,
  layer0Start: 1400,
  layer0Ffn: 1000,
  layer0End: 500,
  layerStart: 150,
  layerFfn: 110,
  layerEnd: 60,
  attention0: 3200,
  attentionN: 200,
  kv: 160,
  kvLast: 1400,
  logits0: 2200,
  sampled0: 1400,
  streamed0: 900,
  decodeLayerStart: 14,
  decodeAttention: 18,
  decodeFfn: 10,
  decodeLayerEnd: 6,
  decodeKv: 10,
  decodeLogits: 220,
  decodeSampled: 160,
  decodeStreamed: 100,
  detokenized: 1400,
  done: 1200,
} as const;

export interface BuilderOptions {
  runId: string;
  mode: Mode;
  prompt: string;
  settings: Settings;
  seed?: string;
  geometry?: Partial<ModelGeometry>;
  /** Called for every event as it is created (in addition to `events`). */
  emit?: (e: PipelineEvent) => void;
}

type Payload<T extends PipelineEvent['type']> = Omit<
  Extract<PipelineEvent, { type: T }>,
  'seq' | 't' | 'baseDurationMs' | 'stage' | 'fidelity' | 'step'
>;

export function buildRequestBody(prompt: string, settings: Settings): RequestBody {
  const body: RequestBody = {
    model: settings.model,
    max_tokens: settings.maxTokens,
    temperature: settings.temperature,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  };
  if (settings.systemPrompt.trim()) body.system = settings.systemPrompt;
  return body;
}

export class RunBuilder {
  readonly events: PipelineEvent[] = [];
  readonly geo: ModelGeometry;
  readonly promptTokens: Token[];
  /** Prompt + everything appended so far. */
  readonly context: Token[];
  readonly body: RequestBody;
  readonly systemTokens: number;

  private seq = 0;
  private step = 0;
  private chunkIndex = 0;
  private computeSaved = 0;
  private firstTokenT: number | null = null;
  private readonly rng: Rng;
  private readonly headKinds;
  private readonly real: Fidelity;
  private readonly sim: Fidelity = 'illustrative';
  private readonly o: BuilderOptions;

  constructor(o: BuilderOptions) {
    this.o = o;
    this.geo = { ...DEFAULT_GEOMETRY, ...o.geometry };
    this.rng = rngFor(`run:${o.seed ?? o.prompt}`);
    this.promptTokens = tokenize(o.prompt);
    this.context = [...this.promptTokens];
    this.body = buildRequestBody(o.prompt, o.settings);
    this.systemTokens = countTokens(o.settings.systemPrompt);
    this.headKinds = assignHeadKinds(this.geo.nLayers, this.geo.nHeads, this.rng);
    this.real = o.mode === 'mock' ? 'illustrative' : 'real';
  }

  get currentStep(): number {
    return this.step;
  }

  private push<T extends PipelineEvent['type']>(
    stage: StageId,
    fidelity: Fidelity,
    step: number,
    t: number,
    baseDurationMs: number,
    payload: Payload<T> & { type: T },
  ): void {
    const e = {
      ...(payload as object),
      seq: this.seq++,
      t: Math.round(t),
      baseDurationMs,
      stage,
      fidelity,
      step,
    } as PipelineEvent;
    this.events.push(e);
    this.o.emit?.(e);
  }

  // ── 1. Compose & send ───────────────────────────────────────────────────

  runStart(t: number): void {
    this.push<'run_start'>('compose', this.real, 0, t, DUR.runStart, {
      type: 'run_start',
      runId: this.o.runId,
      mode: this.o.mode,
      prompt: this.o.prompt,
      model: this.o.settings.model,
      settings: this.o.settings,
    });
  }

  requestBuilt(t: number): void {
    const bytes = new TextEncoder().encode(JSON.stringify(this.body)).length;
    this.push<'request_built'>('compose', this.real, 0, t, DUR.requestBuilt, { type: 'request_built', body: this.body, bytes });
  }

  requestSent(t: number, hops: Hop[], fidelity: Fidelity = this.real): void {
    this.push<'request_sent'>('compose', fidelity, 0, t, DUR.requestSent, {
      type: 'request_sent',
      hops,
      totalMs: hops.reduce((s, h) => s + h.ms, 0),
    });
  }

  // ── 2–3. Tokens & embeddings (illustrative for API models) ──────────────

  tokenized(t: number): void {
    this.push<'tokenized'>('tokenize', this.sim, 0, t, DUR.tokenized, {
      type: 'tokenized',
      tokens: this.promptTokens,
      tokenizer: TOKENIZER_NAME,
      vocabSize: VOCAB_SIZE,
      hiddenTokenCount: this.systemTokens + 4,
    });
  }

  embedded(t: number): void {
    const emb = embedTokens(this.promptTokens, { dims: this.geo.dModel, shownDims: this.geo.shownDims, seed: this.o.seed ?? this.o.prompt });
    this.push<'embedded'>('embed', this.sim, 0, t, DUR.embedded, {
      type: 'embedded',
      dims: this.geo.dModel,
      shownDims: this.geo.shownDims,
      vectors: emb.vectors,
      positional: emb.positional,
      projected: emb.projected,
    });
  }

  // ── 4–6. Prefill forward pass ───────────────────────────────────────────

  private ffnFor(layer: number, step: number): { sparsity: number; sample: number[] } {
    const r = this.rng.fork(`ffn:${step}:${layer}`);
    const sparsity = 0.82 + r.next() * 0.12;
    const sample = Array.from({ length: 32 }, () => (r.next() < sparsity ? 0 : Math.abs(r.gaussian()) * 1.6));
    return { sparsity, sample };
  }

  /** All prefill internals; timestamps are spread across [tStart, tEnd]. */
  prefill(tStart: number, tEnd: number): void {
    const g = this.geo;
    const n = this.promptTokens.length;
    const span = Math.max(1, tEnd - tStart);
    const tl = (l: number, frac: number): number => tStart + (span * (l + frac)) / g.nLayers;
    for (let l = 0; l < g.nLayers; l++) {
      const first = l === 0;
      this.push<'layer_start'>('layers', this.sim, 0, tl(l, 0), first ? DUR.layer0Start : DUR.layerStart, {
        type: 'layer_start',
        layer: l,
        nLayers: g.nLayers,
        seqLen: n,
      });
      const f = this.ffnFor(l, 0);
      this.push<'ffn'>('layers', this.sim, 0, tl(l, 0.5), first ? DUR.layer0Ffn : DUR.layerFfn, {
        type: 'ffn',
        layer: l,
        hiddenDim: g.ffnHidden,
        activationSparsity: f.sparsity,
        sample: f.sample,
      });
      this.push<'layer_end'>('layers', this.sim, 0, tl(l, 0.9), first ? DUR.layer0End : DUR.layerEnd, {
        type: 'layer_end',
        layer: l,
        residualNorm: 1 + l * 0.9 + this.rng.next() * 0.4,
      });
    }
    for (let l = 0; l < g.nLayers; l++) {
      const kinds = this.headKinds[l] ?? [];
      this.push<'attention'>('attention', this.sim, 0, tl(l, 0.25), l === 0 ? DUR.attention0 : DUR.attentionN, {
        type: 'attention',
        layer: l,
        nHeads: g.nHeads,
        dHead: g.dHead,
        heads: attentionForLayer(this.promptTokens, kinds, this.rng.fork(`attn:0:${l}`), 'all'),
        seqLen: n,
        headKinds: kinds.map((k) => HEAD_KIND_LABEL[k]),
      });
    }
    for (let l = 0; l < g.nLayers; l++) {
      this.push<'kv_cache_update'>('kvcache', this.sim, 0, tl(l, 0.3), l === g.nLayers - 1 ? DUR.kvLast : DUR.kv, {
        type: 'kv_cache_update',
        layer: l,
        positions: this.promptTokens.map((x) => x.index),
        cachedTokens: n,
        computeSaved: this.computeSaved,
        phase: 'prefill',
      });
    }
  }

  // ── 7–8. One prediction step ────────────────────────────────────────────

  /**
   * Predict `target` as the next token: decode internals (step > 0), logits,
   * sampled. Appends the token to the context unless it is EOS.
   */
  predict(t: number, target: Token, opts: { isEos: boolean; trueRank?: number }): void {
    const g = this.geo;
    const step = this.step;
    const stage: StageId = step === 0 ? 'sample' : 'loop';
    const ctx = this.context;

    if (step > 0) {
      const perLayer = 6;
      for (let l = 0; l < g.nLayers; l++) {
        const tl = t - g.nLayers * perLayer + l * perLayer;
        this.push<'layer_start'>('loop', this.sim, step, tl, DUR.decodeLayerStart, { type: 'layer_start', layer: l, nLayers: g.nLayers, seqLen: ctx.length });
        const kinds = this.headKinds[l] ?? [];
        this.push<'attention'>('loop', this.sim, step, tl + 1, DUR.decodeAttention, {
          type: 'attention',
          layer: l,
          nHeads: g.nHeads,
          dHead: g.dHead,
          heads: attentionForLayer(ctx, kinds, this.rng.fork(`attn:${step}:${l}`), 'last'),
          seqLen: ctx.length,
          headKinds: kinds.map((k) => HEAD_KIND_LABEL[k]),
        });
        this.computeSaved += (ctx.length - 1) * 2;
        this.push<'kv_cache_update'>('loop', this.sim, step, tl + 2, DUR.decodeKv, {
          type: 'kv_cache_update',
          layer: l,
          positions: [ctx.length - 1],
          cachedTokens: ctx.length,
          computeSaved: this.computeSaved,
          phase: 'decode',
        });
        const f = this.ffnFor(l, step);
        this.push<'ffn'>('loop', this.sim, step, tl + 3, DUR.decodeFfn, { type: 'ffn', layer: l, hiddenDim: g.ffnHidden, activationSparsity: f.sparsity, sample: f.sample });
        this.push<'layer_end'>('loop', this.sim, step, tl + 4, DUR.decodeLayerEnd, { type: 'layer_end', layer: l, residualNorm: 1 + l * 0.9 + this.rng.next() * 0.4 });
      }
    }

    const r = this.rng.fork(`logits:${step}`);
    const trueRank = opts.isEos ? 0 : (opts.trueRank ?? (r.next() < 0.82 ? 0 : r.next() < 0.7 ? 1 : 2));
    const params = { temperature: this.o.settings.temperature, topK: this.o.settings.topK, topP: this.o.settings.topP };
    const lg = simulateLogits({ trueToken: target, context: ctx, rng: r, temperature: params.temperature, vocabSize: VOCAB_SIZE, nCandidates: 16, trueRank });
    this.push<'logits'>(stage, this.sim, step, t - 2, step === 0 ? DUR.logits0 : DUR.decodeLogits, {
      type: 'logits',
      candidates: lg.candidates,
      tailMass: lg.tailMass,
      vocabSize: VOCAB_SIZE,
      ...params,
    });
    const dist = sampleDistribution(lg.candidates.map((c) => c.logit), params);
    const rank = lg.trueRank;
    this.push<'sampled'>(stage, this.sim, step, t - 1, step === 0 ? DUR.sampled0 : DUR.decodeSampled, {
      type: 'sampled',
      token: target,
      prob: dist[rank] ?? 0,
      rank,
      roll: rollFor(dist, rank, r.next()),
      isEos: opts.isEos,
    });
    if (!opts.isEos) {
      ctx.push(target);
      this.step += 1;
    }
  }

  /** A chunk on the wire. `token` is the (last) token the chunk carries. */
  streamed(t: number, token: Token, text: string, wire: 'sse' | 'canned' | 'lab', raw?: string): void {
    if (this.firstTokenT === null) this.firstTokenT = t;
    const step = Math.max(0, this.step - 1);
    const payload: Payload<'token_streamed'> & { type: 'token_streamed' } = {
      type: 'token_streamed',
      token,
      text,
      chunkIndex: this.chunkIndex++,
      wire,
    };
    if (raw !== undefined) payload.raw = raw;
    this.push<'token_streamed'>('loop', this.real, step, t, this.chunkIndex === 1 ? DUR.streamed0 : DUR.decodeStreamed, payload);
  }

  // ── 9. Detokenize & done ────────────────────────────────────────────────

  finish(t: number, info: { stopReason: string; usage?: Usage; text?: string }): void {
    const generated = this.context.slice(this.promptTokens.length);
    const text = info.text ?? generated.map((x) => x.text).join('');
    const ttft = this.firstTokenT ?? t;
    const step = Math.max(0, this.step - 1);
    this.push<'detokenized'>('stream', this.real, step, t - 1, DUR.detokenized, { type: 'detokenized', text, tokens: generated });
    const outTokens = info.usage?.output ?? generated.length;
    this.push<'done'>('stream', this.real, step, t, DUR.done, {
      type: 'done',
      stopReason: info.stopReason,
      usage: info.usage ?? { input: this.promptTokens.length + this.systemTokens + 4, output: generated.length },
      ttftMs: ttft,
      totalMs: t,
      tokensPerSec: outTokens > 1 ? (outTokens - 1) / Math.max(0.001, (t - ttft) / 1000) : 0,
    });
  }
}
