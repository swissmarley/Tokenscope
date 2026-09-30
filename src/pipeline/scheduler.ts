import type { PipelineEvent } from './events';

/**
 * Replays an append-only event log on a virtual timeline.
 *
 * Every event i starts at `startsAt[i] = Σ baseDurationMs[0..i-1]`.
 * While playing, `virtualTime` advances at `speed × wall-time`; the cursor is
 * the last event whose start is ≤ virtualTime. Stepping, scrubbing and
 * catching up are all just moves of `virtualTime`, so live streams (which
 * cannot be rewound at the source) become fully scrubbable once logged.
 */

export interface SchedulerState {
  /** Index of the last dispatched event, -1 before the first. */
  cursor: number;
  virtualTime: number;
  /** End of the virtual timeline: last event start + its hold. */
  duration: number;
  /** Start time of the last known event (where a live replay would "catch up" to). */
  knownEnd: number;
  playing: boolean;
  speed: number;
  autoPauseOnStage: boolean;
  eventCount: number;
  sourceDone: boolean;
  /** Virtual ms of events buffered but not yet replayed. */
  liveLagMs: number;
  bufferedEvents: number;
  /** True once everything has been replayed and the source is finished. */
  ended: boolean;
  /** Bumps on every change; cheap dependency key for React. */
  version: number;
}

export type SchedulerListener = (state: SchedulerState) => void;

export interface SchedulerOptions {
  now?: () => number;
  /** Schedules `cb` for the next frame; returns a cancel function. */
  raf?: (cb: () => void) => () => void;
  speed?: number;
  autoPauseOnStage?: boolean;
}

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 4;
export const DEFAULT_SPEED = 0.25;
export const SPEED_PRESETS = [0.1, 0.25, 0.5, 1, 2, 4] as const;

const defaultNow = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

const defaultRaf = (cb: () => void): (() => void) => {
  if (typeof requestAnimationFrame !== 'undefined') {
    const id = requestAnimationFrame(cb);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(cb, 16);
  return () => clearTimeout(id);
};

export function clampSpeed(s: number): number {
  if (!Number.isFinite(s)) return DEFAULT_SPEED;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, s));
}

export class Scheduler {
  readonly events: PipelineEvent[] = [];
  private readonly startsAt: number[] = [];
  private readonly stageStarts: number[] = [];

  private cursor = -1;
  private vt = 0;
  private playing = false;
  private speed: number;
  private autoPause: boolean;
  private sourceDone = false;
  private lastNow: number | null = null;
  private cancelFrame: (() => void) | null = null;
  private listeners = new Set<SchedulerListener>();
  private version = 0;

  private readonly now: () => number;
  private readonly raf: (cb: () => void) => () => void;

  constructor(opts: SchedulerOptions = {}) {
    this.now = opts.now ?? defaultNow;
    this.raf = opts.raf ?? defaultRaf;
    this.speed = clampSpeed(opts.speed ?? DEFAULT_SPEED);
    this.autoPause = opts.autoPauseOnStage ?? false;
  }

  // ─── Log ────────────────────────────────────────────────────────────────

  append(event: PipelineEvent): void {
    const i = this.events.length;
    const prev = this.events[i - 1];
    const prevStart = this.startsAt[i - 1];
    this.startsAt[i] = prev && prevStart !== undefined ? prevStart + prev.baseDurationMs : 0;
    if (!prev || prev.stage !== event.stage) this.stageStarts.push(i);
    this.events.push(event);
    this.emit();
  }

  appendMany(events: readonly PipelineEvent[]): void {
    for (const e of events) this.append(e);
  }

  /** Replace the log wholesale (e.g. loading a saved run). */
  load(events: readonly PipelineEvent[], opts: { done?: boolean } = {}): void {
    this.reset();
    this.appendMany(events);
    this.sourceDone = opts.done ?? true;
    this.emit();
  }

  reset(): void {
    this.stopFrame();
    this.events.length = 0;
    this.startsAt.length = 0;
    this.stageStarts.length = 0;
    this.cursor = -1;
    this.vt = 0;
    this.playing = false;
    this.sourceDone = false;
    this.lastNow = null;
    this.emit();
  }

  markSourceDone(): void {
    this.sourceDone = true;
    if (this.playing && this.vt >= this.duration()) {
      this.playing = false;
      this.stopFrame();
    }
    this.emit();
  }

  // ─── Transport ──────────────────────────────────────────────────────────

  play(): void {
    if (this.playing) return;
    if (this.isEnded()) this.seekTime(0);
    this.playing = true;
    // First tick after resuming measures from itself (dt = 0): no jump.
    this.lastNow = null;
    this.startFrame();
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.stopFrame();
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: number): void {
    this.speed = clampSpeed(speed);
    this.emit();
  }

  setAutoPauseOnStage(on: boolean): void {
    this.autoPause = on;
    this.emit();
  }

  /** Advance the clock. Called by the frame loop, or directly by tests. */
  tick(now: number): void {
    if (!this.playing) {
      this.lastNow = now;
      return;
    }
    const last = this.lastNow ?? now;
    this.lastNow = now;
    const dt = Math.max(0, now - last);
    this.advanceTo(this.vt + dt * this.speed);
  }

  stepEvent(dir: 1 | -1): void {
    this.pause();
    const n = this.events.length;
    const target = Math.max(-1, Math.min(n - 1, this.cursor + dir));
    this.seekEvent(target);
  }

  stepStage(dir: 1 | -1): void {
    this.pause();
    const n = this.events.length;
    if (n === 0) return;
    if (dir > 0) {
      const next = this.stageStarts.find((i) => i > this.cursor);
      this.seekEvent(next ?? n - 1);
    } else {
      // Go to the start of the current stage; if already there, the previous one.
      let prev = -1;
      for (const s of this.stageStarts) {
        if (s < this.cursor) prev = s;
        else break;
      }
      this.seekEvent(prev);
    }
  }

  seekTime(ms: number): void {
    const end = this.duration();
    const t = Math.max(0, Math.min(end, Number.isFinite(ms) ? ms : 0));
    this.vt = t;
    this.cursor = this.findCursor(t);
    this.emit();
  }

  seekEvent(index: number): void {
    const n = this.events.length;
    const i = Math.max(-1, Math.min(n - 1, Math.trunc(index)));
    this.cursor = i;
    this.vt = i < 0 ? 0 : (this.startsAt[i] ?? 0);
    this.emit();
  }

  /** Jump to the newest known event (live replay catch-up). Keeps play state. */
  catchUp(): void {
    this.seekEvent(this.events.length - 1);
  }

  // ─── Queries ────────────────────────────────────────────────────────────

  getState(): SchedulerState {
    const n = this.events.length;
    const knownEnd = n ? (this.startsAt[n - 1] ?? 0) : 0;
    return {
      cursor: this.cursor,
      virtualTime: this.vt,
      duration: this.duration(),
      knownEnd,
      playing: this.playing,
      speed: this.speed,
      autoPauseOnStage: this.autoPause,
      eventCount: n,
      sourceDone: this.sourceDone,
      liveLagMs: Math.max(0, knownEnd - this.vt),
      bufferedEvents: Math.max(0, n - 1 - this.cursor),
      ended: this.isEnded(),
      version: this.version,
    };
  }

  startOf(index: number): number {
    return this.startsAt[index] ?? 0;
  }

  /** Indices where a new stage begins. */
  getStageStarts(): readonly number[] {
    return this.stageStarts;
  }

  duration(): number {
    const n = this.events.length;
    if (n === 0) return 0;
    const last = this.events[n - 1];
    return (this.startsAt[n - 1] ?? 0) + (last ? last.baseDurationMs : 0);
  }

  subscribe(listener: SchedulerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private isEnded(): boolean {
    const n = this.events.length;
    return this.sourceDone && n > 0 && this.cursor === n - 1 && this.vt >= this.duration();
  }

  private advanceTo(target: number): void {
    const n = this.events.length;
    if (n === 0) {
      this.vt = 0;
      this.emit();
      return;
    }
    const end = this.duration();
    const t = Math.min(target, end);
    let c = this.cursor;
    while (c + 1 < n && (this.startsAt[c + 1] ?? Infinity) <= t) {
      const next = c + 1;
      const ev = this.events[next];
      const prev = this.events[next - 1];
      if (this.autoPause && ev && prev && ev.stage !== prev.stage) {
        this.cursor = next;
        this.vt = this.startsAt[next] ?? t;
        this.playing = false;
        this.stopFrame();
        this.emit();
        return;
      }
      c = next;
    }
    this.cursor = c;
    this.vt = t;
    if (t >= end && this.sourceDone) {
      this.playing = false;
      this.stopFrame();
    }
    this.emit();
  }

  private findCursor(t: number): number {
    let lo = 0;
    let hi = this.events.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((this.startsAt[mid] ?? Infinity) <= t) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  private startFrame(): void {
    if (this.cancelFrame) return;
    const loop = (): void => {
      this.cancelFrame = null;
      this.tick(this.now());
      if (this.playing) this.cancelFrame = this.raf(loop);
    };
    this.cancelFrame = this.raf(loop);
  }

  private stopFrame(): void {
    if (this.cancelFrame) {
      this.cancelFrame();
      this.cancelFrame = null;
    }
  }

  private emit(): void {
    this.version += 1;
    if (this.listeners.size === 0) return;
    const state = this.getState();
    for (const l of this.listeners) l(state);
  }
}
