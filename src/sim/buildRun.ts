import type { Hop, PipelineEvent, Settings } from '../pipeline/events';
import { RunBuilder, type ModelGeometry } from './runBuilder';
import { eosToken, tokenize } from './tokenize';

export { buildRequestBody, DEFAULT_GEOMETRY, DUR, RunBuilder } from './runBuilder';
export type { ModelGeometry } from './runBuilder';

export interface BuildRunOptions {
  runId: string;
  prompt: string;
  reply: string;
  settings: Settings;
  seed?: string;
  geometry?: Partial<ModelGeometry>;
  timing?: Partial<Timing>;
}

export interface Timing {
  ttftMs: number;
  msPerToken: number;
}

/** A complete, deterministic Mock run for a prompt/reply pair with synthetic timing. */
export function buildRun(o: BuildRunOptions): PipelineEvent[] {
  const timing: Timing = { ttftMs: 380, msPerToken: 34, ...o.timing };
  const opts = { runId: o.runId, mode: 'mock' as const, prompt: o.prompt, settings: o.settings };
  const b = new RunBuilder(o.seed ? { ...opts, seed: o.seed, geometry: o.geometry ?? {} } : { ...opts, geometry: o.geometry ?? {} });

  b.runStart(0);
  b.requestBuilt(2);
  const hops: Hop[] = [
    { label: 'Browser → proxy', ms: 3 },
    { label: 'Proxy → API edge (TLS)', ms: 28 },
    { label: 'Edge → model server', ms: 9 },
    { label: 'Queue + prefill', ms: timing.ttftMs - 40 },
  ];
  b.requestSent(5, hops);
  b.tokenized(42);
  b.embedded(44);
  b.prefill(46, timing.ttftMs - 40);

  const replyTokens = tokenize(o.reply, b.promptTokens.length);
  const maxNew = Math.max(1, o.settings.maxTokens);
  const truncated = replyTokens.length >= maxNew;
  const generated = truncated ? replyTokens.slice(0, maxNew) : replyTokens;

  generated.forEach((tok, i) => {
    const t = timing.ttftMs + i * timing.msPerToken;
    b.predict(t - 4, tok, { isEos: false });
    b.streamed(t, tok, tok.text, 'canned');
  });
  const tEnd = timing.ttftMs + generated.length * timing.msPerToken + 8;
  if (!truncated) b.predict(tEnd - 6, eosToken(b.context.length), { isEos: true });
  b.finish(tEnd, { stopReason: truncated ? 'max_tokens' : 'end_turn' });
  return b.events;
}
