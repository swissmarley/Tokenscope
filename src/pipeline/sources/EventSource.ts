import type { Mode, PipelineEvent, Settings } from '../events';

export type Emit = (event: PipelineEvent) => void;

export interface EventSource {
  readonly kind: Mode;
  /**
   * Produce events for one run. Resolves when the run is complete; rejects on
   * failure. Must stop promptly when `signal` aborts.
   */
  run(prompt: string, settings: Settings, emit: Emit, signal: AbortSignal): Promise<void>;
}

/** Assigns sequence numbers so sources never have to. */
export function sequenced(emit: Emit): Emit {
  let seq = 0;
  return (e) => emit({ ...e, seq: seq++ });
}
