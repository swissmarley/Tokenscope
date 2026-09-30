import type { ViewState } from './derive';
import type { Token } from './events';

const EMPTY: Token[] = [];

/** Prompt tokens plus everything sampled before decode step `step`. */
export function contextTokens(view: ViewState, step: number): Token[] {
  const prompt = view.tokens?.tokens ?? EMPTY;
  if (step <= 0) return prompt;
  const out = prompt.slice();
  for (let s = 0; s < step; s++) {
    const it = view.loop.iterations[s];
    if (it?.sampled && !it.sampled.isEos) out.push(it.sampled.token);
  }
  return out;
}
