import { describe, expect, it } from 'vitest';
import { buildRun } from '../sim/buildRun';
import { deriveView } from './derive';

const settings = { model: 'm', systemPrompt: 'sys', maxTokens: 64, temperature: 0.7, topK: 40, topP: 0.95 };

describe('deriveView', () => {
  const events = buildRun({ runId: 'r', prompt: 'The trophy did not fit. What was too big?', reply: 'The trophy was.', settings });

  it('incremental forward derivation matches from-scratch derivation', () => {
    let inc = deriveView(events, -1);
    for (let c = 0; c < events.length; c += 7) {
      inc = deriveView(events, c, inc);
      const scratch = deriveView(events, c);
      expect(inc).toEqual(scratch);
    }
  });

  it('recomputes cleanly when the cursor moves backwards', () => {
    const late = deriveView(events, events.length - 1);
    const back = deriveView(events, 10, late);
    expect(back).toEqual(deriveView(events, 10));
    expect(back.cursor).toBe(10);
  });

  it('tracks stages, fidelity and the growing reply', () => {
    const v = deriveView(events, events.length - 1);
    expect(v.currentStage).toBe('stream');
    expect(Object.values(v.reached).every(Boolean)).toBe(true);
    expect(v.stageFidelity.compose).toBe('illustrative');
    expect(v.stream.text).toBe('The trophy was.');
    expect(v.stream.done?.stopReason).toBe('end_turn');
    expect(v.loop.stopped).toBe(true);
    expect(v.kv.cachedTokens).toBeGreaterThan(v.tokens?.tokens.length ?? 0);
    expect(v.layers.completed).toBe(v.layers.nLayers);
  });

  it('is empty before the first event', () => {
    const v = deriveView(events, -1);
    expect(v.currentStage).toBeNull();
    expect(v.lastEvent).toBeNull();
  });
});
