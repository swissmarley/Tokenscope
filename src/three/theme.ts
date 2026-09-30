import type { StageId } from '../pipeline/events';
import { STAGE_ORDER } from '../pipeline/stages';
import type { WordClass } from '../sim/lexicon';

/** World layout: one set per stage, spaced along +x. */
export const SET_GAP = 64;

export const STAGE_X: Record<StageId, number> = Object.fromEntries(
  STAGE_ORDER.map((s, i) => [s, i * SET_GAP]),
) as Record<StageId, number>;

export interface Pose {
  position: [number, number, number];
  target: [number, number, number];
}

/** Default camera pose per set, relative to the set origin. */
export const POSES: Record<StageId, Pose> = {
  compose: { position: [2, 7, 30], target: [8, 2.5, -4] },
  tokenize: { position: [0, 8, 26], target: [0, 2, 0] },
  embed: { position: [-10, 12, 24], target: [0, 4, 0] },
  layers: { position: [16, 15, 32], target: [0, 8, 0] },
  attention: { position: [0, 12, 28], target: [0, 3, -3] },
  kvcache: { position: [-5, 12, 20], target: [0, 1, -1] },
  sample: { position: [0, 14, 36], target: [0, 5, 1] },
  loop: { position: [0, 19, 33], target: [0, 1, 4] },
  stream: { position: [0, 8, 28], target: [2, 3, 0] },
};

export const C = {
  bg: '#070b16',
  input: '#22d3ee',
  model: '#a78bfa',
  output: '#fbbf24',
  line: '#2b365e',
  surface: '#151d36',
  text: '#e9edf7',
  muted: '#8f98b6',
  faint: '#5a6488',
  pink: '#f472b6',
  ok: '#34d399',
  danger: '#f87171',
  blue: '#60a5fa',
} as const;

export const CLASS_3D: Record<WordClass, string> = {
  punct: '#94a3b8',
  number: C.output,
  pronoun: C.pink,
  function: C.blue,
  proper: C.ok,
  piece: C.input,
  content: C.model,
  special: C.danger,
};

/** Width of a token tile for a given label. */
export function tileWidth(text: string): number {
  return Math.max(0.9, 0.34 * text.length + 0.5);
}
