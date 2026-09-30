import type { Token } from '../pipeline/events';
import { softmax } from '../math/softmax';
import { isPronoun, isPunct, isReferentCandidate, stripSpace } from './lexicon';
import type { Rng } from './prng';

/**
 * Illustrative attention with the kinds of structure interpretability work
 * keeps finding in real models: previous-token heads, attention sinks on the
 * first token, punctuation heads, duplicate-token heads and (for the pronoun
 * preset) heads that route a pronoun back to its candidate referents.
 */

export type HeadKind =
  | 'previous'
  | 'self'
  | 'sink'
  | 'coref'
  | 'broad'
  | 'punct'
  | 'sameword';

export const HEAD_KIND_LABEL: Record<HeadKind, string> = {
  previous: 'previous-token head',
  self: 'self / identity head',
  sink: 'attention-sink head (first token)',
  coref: 'pronoun → referent head',
  broad: 'broad context head',
  punct: 'punctuation / boundary head',
  sameword: 'duplicate-token head',
};

const EARLY: HeadKind[] = ['previous', 'previous', 'self', 'punct', 'sink', 'broad'];
const MIDDLE: HeadKind[] = ['coref', 'coref', 'sameword', 'previous', 'punct', 'broad', 'sink'];
const LATE: HeadKind[] = ['broad', 'broad', 'sink', 'coref', 'sameword', 'previous'];

export function assignHeadKinds(nLayers: number, nHeads: number, rng: Rng): HeadKind[][] {
  const out: HeadKind[][] = [];
  for (let l = 0; l < nLayers; l++) {
    const frac = l / Math.max(1, nLayers - 1);
    const pool = frac < 0.3 ? EARLY : frac < 0.7 ? MIDDLE : LATE;
    const r = rng.fork(`heads:${l}`);
    const kinds: HeadKind[] = [];
    for (let h = 0; h < nHeads; h++) kinds.push(r.pick(pool));
    // Guarantee the teaching heads exist somewhere sensible.
    if (l === 0) kinds[0] = 'previous';
    if (frac >= 0.3 && frac < 0.7 && !kinds.includes('coref')) kinds[0] = 'coref';
    out.push(kinds);
  }
  return out;
}

function scoreRow(tokens: readonly Token[], q: number, kind: HeadKind, r: Rng): number[] {
  const scores: number[] = [];
  const qTok = tokens[q];
  const qText = qTok ? stripSpace(qTok.text).toLowerCase() : '';
  const pron = qTok ? isPronoun(qTok.text) : false;
  for (let k = 0; k <= q; k++) {
    const kTok = tokens[k];
    const kText = kTok ? kTok.text : '';
    let s = 0;
    switch (kind) {
      case 'previous':
        s = k === q - 1 ? 4.2 : k === q ? 0.8 : 0;
        break;
      case 'self':
        s = k === q ? 4 : k === q - 1 ? 0.6 : 0;
        break;
      case 'sink':
        s = k === 0 ? 4 : k === q ? 1.2 : 0;
        break;
      case 'punct':
        s = k < q && isPunct(kText) ? 3.4 - 0.05 * (q - k) : k === q ? 0.8 : 0;
        break;
      case 'sameword':
        s =
          k < q && stripSpace(kText).toLowerCase() === qText && qText.length > 1
            ? 4.4
            : k === 0
              ? 1.8
              : 0;
        break;
      case 'coref':
        if (pron) {
          s = k < q && isReferentCandidate(kText) ? 3.8 - 0.12 * (q - k) : k === 0 ? 0.6 : 0;
        } else {
          s = k === q - 1 ? 2.2 : k === q ? 1.4 : 0;
        }
        break;
      case 'broad':
        s = 1.2 - 0.03 * (q - k);
        break;
    }
    scores.push(s + r.gaussian() * 0.35);
  }
  return scores;
}

/** [head][query][key] — causal, every row sums to 1. */
export function attentionForLayer(
  tokens: readonly Token[],
  kinds: readonly HeadKind[],
  rng: Rng,
  queries: 'all' | 'last',
): number[][][] {
  const n = tokens.length;
  const qs = queries === 'all' ? Array.from({ length: n }, (_, i) => i) : [n - 1];
  return kinds.map((kind, h) => {
    const r = rng.fork(`h${h}`);
    return qs.map((q) => {
      const row = softmax(scoreRow(tokens, q, kind, r));
      // Pad to full width so the causal mask is visible as explicit zeros.
      const full = new Array<number>(n).fill(0);
      for (let k = 0; k < row.length; k++) full[k] = row[k] ?? 0;
      return full;
    });
  });
}
