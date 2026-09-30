import type { Token } from '../pipeline/events';
import { classify, stripSpace, type WordClass } from './lexicon';
import { pca2d } from './pca';
import { rngFor, type Rng } from './prng';

export interface EmbedOptions {
  /** True model width reported to the UI. */
  dims: number;
  /** How many dims are actually generated and shown. */
  shownDims: number;
  seed: string;
}

export interface EmbedResult {
  vectors: number[][];
  positional: number[][];
  projected: Array<[number, number]>;
}

const CLASS_ORDER: WordClass[] = [
  'punct', 'number', 'pronoun', 'function', 'proper', 'piece', 'content', 'special',
];

function classCenters(dims: number, rng: Rng): Record<WordClass, number[]> {
  const out = {} as Record<WordClass, number[]>;
  for (const c of CLASS_ORDER) {
    const r = rng.fork(`class:${c}`);
    out[c] = Array.from({ length: dims }, () => r.gaussian() * 1.4);
  }
  return out;
}

/**
 * Sinusoidal positional encoding from "Attention Is All You Need":
 *   PE(pos, 2i)   = sin(pos / 10000^(2i/d))
 *   PE(pos, 2i+1) = cos(pos / 10000^(2i/d))
 * GPT-2 actually learns its position vectors; this one is illustrative but the
 * shape (a wave whose frequency falls with the dimension index) is the classic.
 */
export function sinusoidalPosition(pos: number, dims: number, shownDims: number): number[] {
  const out: number[] = [];
  // The shown dims sample the full width so the classic fast→slow wave bands are visible.
  const stride = dims / shownDims;
  for (let i = 0; i < shownDims; i++) {
    const pair = Math.floor((Math.floor(i / 2) * 2 * stride) / 2);
    const freq = 1 / Math.pow(10000, (2 * pair) / dims);
    out.push(i % 2 === 0 ? Math.sin(pos * freq) : Math.cos(pos * freq));
  }
  return out;
}

/** Frequency of shown dim `i`, for labelling. */
export function positionFrequency(i: number, dims: number, shownDims: number): number {
  const stride = dims / shownDims;
  const pair = Math.floor((Math.floor(i / 2) * 2 * stride) / 2);
  return 1 / Math.pow(10000, (2 * pair) / dims);
}

export function embedTokens(tokens: readonly Token[], opts: EmbedOptions): EmbedResult {
  const rng = rngFor(`embed:${opts.seed}`);
  const centers = classCenters(opts.shownDims, rng);
  const vectors = tokens.map((tok) => {
    const cls = classify(tok.text);
    const center = centers[cls];
    // Same token id → identical vector, exactly like a real lookup table.
    const r = rngFor(`tok:${tok.id}`);
    // Tokens sharing a stem drift towards each other.
    const stem = stripSpace(tok.text).toLowerCase().slice(0, 4);
    const s = rngFor(`stem:${stem}`);
    return Array.from({ length: opts.shownDims }, (_, j) => {
      const base = (center[j] ?? 0) * 0.9;
      return base + s.gaussian() * 0.55 + r.gaussian() * 0.45;
    });
  });
  const positional = tokens.map((tok) => sinusoidalPosition(tok.index, opts.dims, opts.shownDims));
  const projected = pca2d(vectors).points;
  return { vectors, positional, projected };
}
