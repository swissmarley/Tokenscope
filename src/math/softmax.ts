/**
 * Sampling math, written to be read: these are the formulas the
 * "Show the math" toggle points at.
 */

/** softmax(z)_i = exp(z_i / T) / Σ_j exp(z_j / T), computed stably. */
export function softmax(logits: readonly number[], temperature = 1): number[] {
  if (logits.length === 0) return [];
  const T = Math.max(temperature, 1e-6);
  const scaled = logits.map((z) => z / T);
  const max = Math.max(...scaled);
  const exps = scaled.map((z) => Math.exp(z - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/** Keep only the k largest probabilities, renormalised. k ≤ 0 means "all". */
export function applyTopK(probs: readonly number[], k: number): number[] {
  if (k <= 0 || k >= probs.length) return [...probs];
  const order = probs
    .map((p, i) => [p, i] as const)
    .sort((a, b) => b[0] - a[0]);
  const keep = new Set(order.slice(0, k).map(([, i]) => i));
  const kept = probs.map((p, i) => (keep.has(i) ? p : 0));
  const sum = kept.reduce((a, b) => a + b, 0);
  return sum > 0 ? kept.map((p) => p / sum) : kept;
}

/**
 * Nucleus sampling: keep the smallest set of top probabilities whose
 * cumulative mass is ≥ p, renormalised. Always keeps at least one.
 */
export function applyTopP(probs: readonly number[], p: number): number[] {
  if (p >= 1 || probs.length === 0) return [...probs];
  const order = probs
    .map((pr, i) => [pr, i] as const)
    .sort((a, b) => b[0] - a[0]);
  const keep = new Set<number>();
  let cum = 0;
  for (const [pr, i] of order) {
    keep.add(i);
    cum += pr;
    if (cum >= p) break;
  }
  const kept = probs.map((pr, i) => (keep.has(i) ? pr : 0));
  const sum = kept.reduce((a, b) => a + b, 0);
  return sum > 0 ? kept.map((pr) => pr / sum) : kept;
}

export interface SamplingParams {
  temperature: number;
  topK: number;
  topP: number;
}

/** logits → temperature → top-k → top-p, in the order most inference stacks apply them. */
export function sampleDistribution(logits: readonly number[], params: SamplingParams): number[] {
  return applyTopP(applyTopK(softmax(logits, params.temperature), params.topK), params.topP);
}

/** Inverse-CDF draw: returns the index whose cumulative range contains u ∈ [0, 1). */
export function sampleIndex(probs: readonly number[], u: number): number {
  let cum = 0;
  for (let i = 0; i < probs.length; i++) {
    cum += probs[i] ?? 0;
    if (u < cum) return i;
  }
  // Floating point can leave u just above the last boundary.
  for (let i = probs.length - 1; i >= 0; i--) if ((probs[i] ?? 0) > 0) return i;
  return probs.length - 1;
}

/** A uniform value that would select `index`, for reproducible "dice rolls". */
export function rollFor(probs: readonly number[], index: number, fraction = 0.5): number {
  let cum = 0;
  for (let i = 0; i < index; i++) cum += probs[i] ?? 0;
  return cum + (probs[index] ?? 0) * Math.min(0.999, Math.max(0, fraction));
}

/** Shannon entropy in bits. */
export function entropyBits(probs: readonly number[]): number {
  let h = 0;
  for (const p of probs) if (p > 0) h -= p * Math.log2(p);
  return h;
}

/** log Σ exp(z) computed stably. */
export function logSumExp(logits: readonly number[]): number {
  if (logits.length === 0) return -Infinity;
  const max = Math.max(...logits);
  return max + Math.log(logits.reduce((a, z) => a + Math.exp(z - max), 0));
}
