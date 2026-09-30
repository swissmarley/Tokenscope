import { encode } from 'gpt-tokenizer/encoding/r50k_base';
import type { Candidate, Token } from '../pipeline/events';
import { logSumExp, softmax } from '../math/softmax';
import { makeToken } from './tokenize';
import type { Rng } from './prng';

/**
 * Illustrative next-token scores. The "true" continuation (the canned reply)
 * gets the top or near-top logit; distractors come from a pool of common
 * tokens and recently seen context. Logits are what the event carries so the
 * UI can re-run softmax at any temperature / top-k / top-p.
 */

const COMMON_POOL = [
  ' the', ' a', ' an', ' is', ' was', ' and', ' it', ' of', ' to', ' that', ' in', ' not',
  ' very', ' too', ' because', ' so', ' but', ' this', ' which', ' one', ',', '.', '\n',
  ' I', ' you', ' can', ' will', ' would', ' also', ' just', ' really', ' quite', ' about',
];

let poolIds: number[] | null = null;
function commonIds(): number[] {
  if (!poolIds) {
    poolIds = COMMON_POOL.map((w) => encode(w)[0]).filter((x): x is number => x !== undefined);
  }
  return poolIds;
}

export interface LogitsOptions {
  trueToken: Token;
  context: readonly Token[];
  rng: Rng;
  temperature: number;
  vocabSize: number;
  nCandidates: number;
  /** Force the true token to this rank (0 = top). */
  trueRank: number;
}

export interface LogitsResult {
  candidates: Candidate[];
  tailMass: number;
  trueRank: number;
}

export function simulateLogits(o: LogitsOptions): LogitsResult {
  const { rng } = o;
  const ids = new Set<number>();
  const order: number[] = [];
  const push = (id: number): void => {
    if (id === o.trueToken.id || ids.has(id)) return;
    ids.add(id);
    order.push(id);
  };
  // Plausible alternatives first (common function words / punctuation) …
  const pool = commonIds().slice();
  const nCommon = Math.min(pool.length, Math.ceil(o.nCandidates * 0.6));
  while (order.length < nCommon && pool.length) {
    const idx = rng.int(pool.length);
    const [id] = pool.splice(idx, 1);
    if (id !== undefined) push(id);
  }
  // … then copies of earlier context (models love to repeat), skipping the very last token.
  const ctx = o.context.slice(-14, -1).map((t) => t.id);
  for (let i = ctx.length - 1; i >= 0 && order.length < o.nCandidates - 2; i--) {
    const id = ctx[i];
    if (id !== undefined && rng.next() < 0.6) push(id);
  }
  // Random vocabulary entries fill the rest.
  while (order.length < o.nCandidates - 1) push(1000 + rng.int(o.vocabSize - 1200));

  const trueLogit = 8.4 + rng.gaussian() * 0.4;
  // Gentle decay so the top ~8 bars are all visible and top-k / top-p have something to cut.
  const distractorLogits = order.map((_, i) => 7.55 - i * 0.26 + rng.gaussian() * 0.3);
  // A close race, not a runaway: promoted distractors sit just above the true token.
  for (let r = 0; r < o.trueRank && r < distractorLogits.length; r++) {
    distractorLogits[r] = trueLogit + 0.1 + r * 0.12 + Math.abs(rng.gaussian()) * 0.1;
  }

  const entries: Array<{ id: number; logit: number }> = [
    { id: o.trueToken.id, logit: trueLogit },
    ...order.map((id, i) => ({ id, logit: distractorLogits[i] ?? 0 })),
  ];
  entries.sort((a, b) => b.logit - a.logit);

  // The other ~50k vocabulary entries are one aggregate tail holding 5–18 % of the mass at T=1.
  const targetTail = 0.05 + rng.next() * 0.13;
  const lse = logSumExp(entries.map((e) => e.logit));
  const tailLogit = lse + Math.log(targetTail / (1 - targetTail));
  const allLogits = [...entries.map((e) => e.logit), tailLogit];
  const probs = softmax(allLogits, o.temperature);
  const tailMass = probs[probs.length - 1] ?? 0;

  const candidates: Candidate[] = entries.map((e, i) => ({
    token: e.id === o.trueToken.id ? o.trueToken : makeToken(e.id, o.trueToken.index),
    logit: e.logit,
    prob: probs[i] ?? 0,
  }));
  const trueRank = candidates.findIndex((c) => c.token.id === o.trueToken.id);
  return { candidates, tailMass, trueRank };
}

/** Effective tail logit for reconstructing the full distribution in the UI. */
export function tailLogitFor(candidates: readonly Candidate[], tailMass: number, temperature: number): number {
  const logits = candidates.map((c) => c.logit / Math.max(temperature, 1e-6));
  const lse = logSumExp(logits);
  const m = Math.min(Math.max(tailMass, 1e-9), 1 - 1e-9);
  return (lse + Math.log(m / (1 - m))) * Math.max(temperature, 1e-6);
}
