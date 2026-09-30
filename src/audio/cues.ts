/** Subtle Web Audio blips. Off by default; the toggle click satisfies autoplay policy. */

export type Cue = 'stage' | 'token' | 'done' | 'tick';

let ctx: AudioContext | null = null;

function ensure(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

const FREQ: Record<Cue, number> = { stage: 587.33, token: 1174.66, done: 440, tick: 880 };

export function playCue(kind: Cue): void {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  const f = FREQ[kind];
  osc.type = kind === 'token' ? 'triangle' : 'sine';
  osc.frequency.setValueAtTime(f, t);
  if (kind === 'stage') osc.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.14);
  if (kind === 'done') osc.frequency.exponentialRampToValueAtTime(f * 2, t + 0.3);
  const peak = kind === 'token' ? 0.025 : kind === 'tick' ? 0.02 : 0.06;
  const len = kind === 'token' ? 0.07 : kind === 'tick' ? 0.05 : 0.32;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + len + 0.05);
}

/** Warm up on a user gesture so the first cue is not swallowed. */
export function primeAudio(): void {
  ensure();
}
