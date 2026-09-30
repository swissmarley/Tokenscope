import type { Mode, Settings } from '../events';
import { buildRun } from '../../sim/buildRun';
import { findPreset, GENERIC_MOCK_REPLY } from '../../sim/presets';
import { sequenced, type Emit, type EventSource } from './EventSource';

/**
 * Canned runs: real BPE tokenization, illustrative everything else.
 * Works with no API key and no model download.
 */
export class MockSource implements EventSource {
  readonly kind: Mode = 'mock';

  async run(prompt: string, settings: Settings, emit: Emit, signal: AbortSignal): Promise<void> {
    const preset = findPreset(prompt);
    const reply = preset?.reply ?? GENERIC_MOCK_REPLY;
    const events = buildRun({
      runId: `mock-${Date.now().toString(36)}`,
      prompt,
      reply,
      settings: { ...settings, model: 'mock-transformer-12L' },
    });
    const out = sequenced(emit);
    // Yield once so the UI can paint the empty timeline before the flood.
    await new Promise((r) => setTimeout(r, 0));
    for (const e of events) {
      if (signal.aborted) return;
      out(e);
    }
  }
}
