import { scheduler, useStore } from '../store/useStore';

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * 0 → 1 progress through the slow-motion hold of event `seq`, derived from the
 * scheduler's virtual clock. 0 before the cursor reaches it, 1 once it has
 * passed. Scene animations gate on this so pause / step / scrub stay in sync.
 */
export function useEventProgress(seq: number | null | undefined): number {
  return useStore((s) => {
    if (seq === null || seq === undefined) return 0;
    const { cursor, virtualTime } = s.transport;
    if (cursor < seq) return 0;
    if (cursor > seq) return 1;
    const ev = scheduler.events[seq];
    if (!ev || ev.baseDurationMs <= 0) return 1;
    return clamp01((virtualTime - scheduler.startOf(seq)) / ev.baseDurationMs);
  });
}

/** Same as the hook, but imperative — for per-frame reads inside useFrame. */
export function progressOf(seq: number | null | undefined): number {
  if (seq === null || seq === undefined) return 0;
  const { cursor, virtualTime } = useStore.getState().transport;
  if (cursor < seq) return 0;
  if (cursor > seq) return 1;
  const ev = scheduler.events[seq];
  if (!ev || ev.baseDurationMs <= 0) return 1;
  return clamp01((virtualTime - scheduler.startOf(seq)) / ev.baseDurationMs);
}

/** Progress of whatever event the cursor is on, imperatively. */
export function currentProgress(): number {
  return progressOf(useStore.getState().transport.cursor);
}

/** First event index of a type (optionally step), or null. */
export function findSeq(type: string, step?: number): number | null {
  const i = scheduler.events.findIndex((e) => e.type === type && (step === undefined || e.step === step));
  return i >= 0 ? i : null;
}

/** Map progress onto a sub-window [a, b] of the hold. */
export function window01(p: number, a: number, b: number): number {
  return clamp01((p - a) / Math.max(1e-6, b - a));
}

/** Ease-out for progress-driven motion (matches the design's out-quint feel). */
export function easeOut(p: number): number {
  return 1 - Math.pow(1 - clamp01(p), 4);
}
