/**
 * The typed event stream that drives every visual in the app.
 * Nothing in the UI owns a timer: components render whatever the
 * Scheduler's cursor says has happened so far.
 */

export type Mode = 'mock' | 'live' | 'lab';

export type StageId =
  | 'compose'
  | 'tokenize'
  | 'embed'
  | 'layers'
  | 'attention'
  | 'kvcache'
  | 'sample'
  | 'loop'
  | 'stream';

/** `real` = observed from the model/API; `illustrative` = deterministic simulation. */
export type Fidelity = 'real' | 'illustrative';

export interface Token {
  id: number;
  text: string;
  bytes: number[];
  /** Position in the sequence (prompt + generated so far). */
  index: number;
}

export interface Candidate {
  token: Token;
  logit: number;
  /** Probability at the run's sampling settings (softmax over the full vocab). */
  prob: number;
}

export interface Settings {
  model: string;
  systemPrompt: string;
  maxTokens: number;
  temperature: number;
  topK: number;
  topP: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RequestBody {
  model: string;
  max_tokens: number;
  temperature: number;
  system?: string;
  messages: ChatMessage[];
  stream: true;
}

export interface Hop {
  label: string;
  ms: number;
}

export interface Usage {
  input: number;
  output: number;
}

export interface EventBase {
  /** Monotonic index within the run. */
  seq: number;
  /** Wall-clock ms since run start, as observed by the source. */
  t: number;
  /** Slow-motion hold in ms at 1×. The Scheduler multiplies by 1/speed. */
  baseDurationMs: number;
  stage: StageId;
  fidelity: Fidelity;
  /** Decode step: 0 = prefill / first prediction, then 1, 2, … */
  step: number;
}

export type EventPayload =
  | {
      type: 'run_start';
      runId: string;
      mode: Mode;
      prompt: string;
      model: string;
      settings: Settings;
    }
  | { type: 'request_built'; body: RequestBody; bytes: number }
  | { type: 'request_sent'; hops: Hop[]; totalMs: number }
  | {
      type: 'tokenized';
      tokens: Token[];
      tokenizer: string;
      vocabSize: number;
      /** Tokens the model sees that are not shown as chips (system prompt, template). */
      hiddenTokenCount: number;
    }
  | {
      type: 'embedded';
      /** True model width, e.g. 768. */
      dims: number;
      /** How many of those dims are included in `vectors`. */
      shownDims: number;
      vectors: number[][];
      positional: number[][];
      /** 2-D PCA projection of `vectors`, normalised to [-1, 1]. */
      projected: Array<[number, number]>;
    }
  | { type: 'layer_start'; layer: number; nLayers: number; seqLen: number }
  | {
      type: 'attention';
      layer: number;
      nHeads: number;
      dHead: number;
      /** [head][query][key]. In decode steps there is a single query row. */
      heads: number[][][];
      /** Key count (sequence length) the rows attend over. */
      seqLen: number;
      /** Human labels for head behaviour, when known/illustrative. */
      headKinds?: string[];
    }
  | {
      type: 'ffn';
      layer: number;
      hiddenDim: number;
      /** Fraction of hidden units that are (near) zero after the activation. */
      activationSparsity: number;
      /** A small sample of hidden activations for the visual. */
      sample: number[];
    }
  | { type: 'layer_end'; layer: number; residualNorm: number }
  | {
      type: 'kv_cache_update';
      layer: number;
      /** Positions written to the cache in this update. */
      positions: number[];
      /** Total cached positions for this layer after the update. */
      cachedTokens: number;
      /** Cumulative K/V projections skipped thanks to the cache. */
      computeSaved: number;
      phase: 'prefill' | 'decode';
    }
  | {
      type: 'logits';
      candidates: Candidate[];
      /** Probability mass outside the listed candidates. */
      tailMass: number;
      vocabSize: number;
      temperature: number;
      topK: number;
      topP: number;
    }
  | {
      type: 'sampled';
      token: Token;
      prob: number;
      rank: number;
      /** Uniform draw in [0, 1) that selected the token. */
      roll: number;
      isEos: boolean;
    }
  | {
      type: 'token_streamed';
      token: Token;
      text: string;
      chunkIndex: number;
      wire: 'sse' | 'canned' | 'lab';
      /** Raw wire payload when available (SSE line). */
      raw?: string;
    }
  | { type: 'detokenized'; text: string; tokens: Token[] }
  | {
      type: 'done';
      stopReason: string;
      usage: Usage;
      ttftMs: number;
      totalMs: number;
      tokensPerSec: number;
    };

export type PipelineEvent = EventBase & EventPayload;
export type EventType = PipelineEvent['type'];
export type EventOf<T extends EventType> = Extract<PipelineEvent, { type: T }>;

export function isEvent<T extends EventType>(e: PipelineEvent, type: T): e is EventOf<T> {
  return e.type === type;
}

export const EOS_TOKEN_ID = 50256;
