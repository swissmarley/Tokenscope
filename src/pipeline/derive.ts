import type {
  EventOf,
  Fidelity,
  Hop,
  PipelineEvent,
  RequestBody,
  StageId,
} from './events';
import { STAGE_ORDER } from './stages';

/**
 * UI state is a pure function of (events, cursor). This module folds the
 * dispatched prefix of the log into per-stage view models. `deriveView` is
 * incremental when the cursor moves forward and recomputes from scratch when
 * it moves backward.
 */

export type LayerPhase = 'idle' | 'attention' | 'ffn' | 'done';
export type LoopPhase = 'idle' | 'layers' | 'attention' | 'kv' | 'logits' | 'sampled' | 'streamed';

export interface ComposeView {
  body: RequestBody | null;
  bytes: number;
  hops: Hop[] | null;
  totalMs: number;
  sent: boolean;
}

export interface LayerView {
  nLayers: number;
  current: number | null;
  phase: LayerPhase;
  /** Layers fully finished in the current step. */
  completed: number;
  residualNorms: number[];
  ffnByLayer: Record<number, EventOf<'ffn'>>;
  seqLen: number;
}

export interface AttentionView {
  nHeads: number;
  dHead: number;
  nLayers: number;
  latest: { layer: number; step: number } | null;
  /** keyed `${step}:${layer}` */
  byKey: Record<string, EventOf<'attention'>>;
}

export interface KVView {
  nLayers: number;
  /** Cached positions per layer. */
  perLayer: Record<number, number>;
  cachedTokens: number;
  computeSaved: number;
  updates: number;
  latest: EventOf<'kv_cache_update'> | null;
  prefillDone: boolean;
}

export interface Iteration {
  step: number;
  logits: EventOf<'logits'> | null;
  sampled: EventOf<'sampled'> | null;
  streamed: EventOf<'token_streamed'> | null;
  layersDone: number;
}

export interface LoopView {
  step: number;
  phase: LoopPhase;
  iterations: Iteration[];
  stopped: boolean;
}

export interface StreamView {
  chunks: EventOf<'token_streamed'>[];
  text: string;
  detokenized: EventOf<'detokenized'> | null;
  done: EventOf<'done'> | null;
}

export interface ViewState {
  cursor: number;
  runStart: EventOf<'run_start'> | null;
  currentStage: StageId | null;
  reached: Record<StageId, boolean>;
  /** Number of dispatched events per stage. */
  stageCounts: Record<StageId, number>;
  /** Fidelity of the latest event seen in each stage. */
  stageFidelity: Record<StageId, Fidelity | null>;
  compose: ComposeView;
  tokens: EventOf<'tokenized'> | null;
  embedding: EventOf<'embedded'> | null;
  layers: LayerView;
  attention: AttentionView;
  kv: KVView;
  loop: LoopView;
  stream: StreamView;
  lastEvent: PipelineEvent | null;
}

function stageRecord<T>(v: T): Record<StageId, T> {
  return Object.fromEntries(STAGE_ORDER.map((s) => [s, v])) as Record<StageId, T>;
}

export function emptyView(): ViewState {
  return {
    cursor: -1,
    runStart: null,
    currentStage: null,
    reached: stageRecord(false),
    stageCounts: stageRecord(0),
    stageFidelity: stageRecord<Fidelity | null>(null),
    compose: { body: null, bytes: 0, hops: null, totalMs: 0, sent: false },
    tokens: null,
    embedding: null,
    layers: {
      nLayers: 0,
      current: null,
      phase: 'idle',
      completed: 0,
      residualNorms: [],
      ffnByLayer: {},
      seqLen: 0,
    },
    attention: { nHeads: 0, dHead: 0, nLayers: 0, latest: null, byKey: {} },
    kv: {
      nLayers: 0,
      perLayer: {},
      cachedTokens: 0,
      computeSaved: 0,
      updates: 0,
      latest: null,
      prefillDone: false,
    },
    loop: { step: 0, phase: 'idle', iterations: [], stopped: false },
    stream: { chunks: [], text: '', detokenized: null, done: null },
    lastEvent: null,
  };
}

function iterationAt(loop: LoopView, step: number): { loop: LoopView; it: Iteration } {
  const iterations = loop.iterations.slice();
  let it = iterations[step];
  if (!it) {
    it = { step, logits: null, sampled: null, streamed: null, layersDone: 0 };
    for (let i = iterations.length; i < step; i++) {
      iterations[i] = { step: i, logits: null, sampled: null, streamed: null, layersDone: 0 };
    }
  } else {
    it = { ...it };
  }
  iterations[step] = it;
  return { loop: { ...loop, iterations, step }, it };
}

export function applyEvent(prev: ViewState, e: PipelineEvent): ViewState {
  const v: ViewState = {
    ...prev,
    currentStage: e.stage,
    reached: prev.reached[e.stage] ? prev.reached : { ...prev.reached, [e.stage]: true },
    stageCounts: { ...prev.stageCounts, [e.stage]: prev.stageCounts[e.stage] + 1 },
    stageFidelity:
      prev.stageFidelity[e.stage] === e.fidelity
        ? prev.stageFidelity
        : { ...prev.stageFidelity, [e.stage]: e.fidelity },
    lastEvent: e,
  };

  switch (e.type) {
    case 'run_start':
      v.runStart = e;
      break;
    case 'request_built':
      v.compose = { ...v.compose, body: e.body, bytes: e.bytes };
      break;
    case 'request_sent':
      v.compose = { ...v.compose, hops: e.hops, totalMs: e.totalMs, sent: true };
      break;
    case 'tokenized':
      v.tokens = e;
      break;
    case 'embedded':
      v.embedding = e;
      break;
    case 'layer_start': {
      const isNewStep = e.step !== (prev.lastEvent?.step ?? 0) || e.layer === 0;
      v.layers = {
        ...v.layers,
        nLayers: e.nLayers,
        current: e.layer,
        phase: 'attention',
        completed: isNewStep && e.layer === 0 ? 0 : v.layers.completed,
        seqLen: e.seqLen,
      };
      if (e.step > 0) {
        const { loop, it } = iterationAt(v.loop, e.step);
        it.layersDone = e.layer;
        v.loop = { ...loop, phase: 'layers' };
      }
      break;
    }
    case 'attention': {
      const key = `${e.step}:${e.layer}`;
      v.attention = {
        nHeads: e.nHeads,
        dHead: e.dHead,
        nLayers: Math.max(v.attention.nLayers, v.layers.nLayers, e.layer + 1),
        latest: { layer: e.layer, step: e.step },
        byKey: { ...v.attention.byKey, [key]: e },
      };
      if (e.step > 0) v.loop = { ...v.loop, phase: 'attention' };
      break;
    }
    case 'ffn':
      v.layers = {
        ...v.layers,
        current: e.layer,
        phase: 'ffn',
        ffnByLayer: { ...v.layers.ffnByLayer, [e.layer]: e },
      };
      break;
    case 'layer_end': {
      const residualNorms = v.layers.residualNorms.slice();
      residualNorms[e.layer] = e.residualNorm;
      const completed = e.layer + 1;
      v.layers = {
        ...v.layers,
        current: e.layer,
        phase: completed >= v.layers.nLayers && v.layers.nLayers > 0 ? 'done' : 'attention',
        completed,
        residualNorms,
      };
      if (e.step > 0) {
        const { loop, it } = iterationAt(v.loop, e.step);
        it.layersDone = completed;
        v.loop = loop;
      }
      break;
    }
    case 'kv_cache_update':
      v.kv = {
        nLayers: Math.max(v.kv.nLayers, e.layer + 1, v.layers.nLayers),
        perLayer: { ...v.kv.perLayer, [e.layer]: e.cachedTokens },
        cachedTokens: e.cachedTokens,
        computeSaved: e.computeSaved,
        updates: v.kv.updates + 1,
        latest: e,
        prefillDone: v.kv.prefillDone || e.phase === 'decode',
      };
      if (e.step > 0) v.loop = { ...v.loop, phase: 'kv' };
      break;
    case 'logits': {
      const { loop, it } = iterationAt(v.loop, e.step);
      it.logits = e;
      v.loop = { ...loop, phase: 'logits' };
      break;
    }
    case 'sampled': {
      const { loop, it } = iterationAt(v.loop, e.step);
      it.sampled = e;
      v.loop = { ...loop, phase: 'sampled', stopped: e.isEos };
      break;
    }
    case 'token_streamed': {
      const { loop, it } = iterationAt(v.loop, e.step);
      it.streamed = e;
      v.loop = { ...loop, phase: 'streamed' };
      v.stream = {
        ...v.stream,
        chunks: [...v.stream.chunks, e],
        text: v.stream.text + e.text,
      };
      break;
    }
    case 'detokenized':
      v.stream = { ...v.stream, detokenized: e, text: e.text };
      break;
    case 'done':
      v.stream = { ...v.stream, done: e };
      v.loop = { ...v.loop, stopped: true };
      break;
  }
  v.cursor = e.seq;
  return v;
}

/**
 * Fold events[0..cursor]. Pass the previous ViewState to make forward moves
 * O(Δ) instead of O(n).
 */
export function deriveView(
  events: readonly PipelineEvent[],
  cursor: number,
  prev?: ViewState,
): ViewState {
  let state: ViewState;
  let from: number;
  if (prev && prev.cursor <= cursor && prev.cursor < events.length) {
    state = prev;
    from = prev.cursor + 1;
  } else {
    state = emptyView();
    from = 0;
  }
  const to = Math.min(cursor, events.length - 1);
  for (let i = from; i <= to; i++) {
    const e = events[i];
    if (e) state = applyEvent(state, e);
  }
  return state;
}
