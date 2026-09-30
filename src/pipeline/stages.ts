import type { StageId } from './events';

export type Phase = 'input' | 'model' | 'output';

export interface StageMeta {
  id: StageId;
  index: number;
  title: string;
  short: string;
  phase: Phase;
  blurb: string;
}

export const STAGES: StageMeta[] = [
  {
    id: 'compose',
    index: 1,
    title: 'Compose & send',
    short: 'Send',
    phase: 'input',
    blurb: 'Your message is wrapped into a JSON request and shipped to the model server.',
  },
  {
    id: 'tokenize',
    index: 2,
    title: 'Tokenization',
    short: 'Tokens',
    phase: 'input',
    blurb: 'Text becomes a list of integer IDs by splitting into sub-word pieces.',
  },
  {
    id: 'embed',
    index: 3,
    title: 'Embeddings & position',
    short: 'Embed',
    phase: 'input',
    blurb: 'Each ID becomes a vector of numbers; position is mixed in so order matters.',
  },
  {
    id: 'layers',
    index: 4,
    title: 'Transformer layers',
    short: 'Layers',
    phase: 'model',
    blurb: 'The vectors pass through a stack of identical blocks: attention, then a feed-forward network.',
  },
  {
    id: 'attention',
    index: 5,
    title: 'Attention',
    short: 'Attention',
    phase: 'model',
    blurb: 'Every token looks at earlier tokens and decides which ones matter for it.',
  },
  {
    id: 'kvcache',
    index: 6,
    title: 'Prefill, decode & the KV cache',
    short: 'KV cache',
    phase: 'model',
    blurb: 'Keys and values are stored so later tokens can reuse them instead of recomputing.',
  },
  {
    id: 'sample',
    index: 7,
    title: 'Next-token prediction',
    short: 'Predict',
    phase: 'model',
    blurb: 'Scores over the whole vocabulary become probabilities, and one token is drawn.',
  },
  {
    id: 'loop',
    index: 8,
    title: 'The autoregressive loop',
    short: 'Loop',
    phase: 'model',
    blurb: 'The chosen token is appended to the input and the whole thing runs again.',
  },
  {
    id: 'stream',
    index: 9,
    title: 'Streaming & detokenization',
    short: 'Stream',
    phase: 'output',
    blurb: 'Token IDs turn back into text and arrive in your browser chunk by chunk.',
  },
];

export const STAGE_ORDER: StageId[] = STAGES.map((s) => s.id);

export const STAGE_BY_ID: Record<StageId, StageMeta> = Object.fromEntries(
  STAGES.map((s) => [s.id, s]),
) as Record<StageId, StageMeta>;

export function stageIndex(id: StageId): number {
  return STAGE_BY_ID[id].index - 1;
}

/** CSS variable names for each phase's accent. */
export const PHASE_COLOR: Record<Phase, string> = {
  input: 'var(--color-phase-input)',
  model: 'var(--color-phase-model)',
  output: 'var(--color-phase-output)',
};

export const PHASE_COLOR_SOFT: Record<Phase, string> = {
  input: 'var(--color-phase-input-soft)',
  model: 'var(--color-phase-model-soft)',
  output: 'var(--color-phase-output-soft)',
};

export function stageColor(id: StageId): string {
  return PHASE_COLOR[STAGE_BY_ID[id].phase];
}

export function stageColorSoft(id: StageId): string {
  return PHASE_COLOR_SOFT[STAGE_BY_ID[id].phase];
}
