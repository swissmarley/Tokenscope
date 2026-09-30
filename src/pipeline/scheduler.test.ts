import { describe, expect, it } from 'vitest';
import { Scheduler, clampSpeed, MAX_SPEED, MIN_SPEED } from './scheduler';
import type { PipelineEvent, StageId } from './events';

function ev(seq: number, stage: StageId, baseDurationMs: number): PipelineEvent {
  return {
    seq,
    t: seq,
    baseDurationMs,
    stage,
    fidelity: 'illustrative',
    step: 0,
    type: 'layer_end',
    layer: seq,
    residualNorm: 1,
  };
}

function make(opts: { speed?: number; autoPause?: boolean } = {}) {
  const s = new Scheduler({
    now: () => 0,
    raf: () => () => {},
    speed: opts.speed ?? 1,
    autoPauseOnStage: opts.autoPause ?? false,
  });
  return s;
}

/** compose: 0–1000, 1000–2000 | tokenize: 2000–3000 | embed: 3000–4000, 4000–5000 */
function fiveEvents(s: Scheduler) {
  s.load([
    ev(0, 'compose', 1000),
    ev(1, 'compose', 1000),
    ev(2, 'tokenize', 1000),
    ev(3, 'embed', 1000),
    ev(4, 'embed', 1000),
  ]);
}

describe('Scheduler timeline', () => {
  it('computes start times and duration from base durations', () => {
    const s = make();
    fiveEvents(s);
    expect(s.startOf(0)).toBe(0);
    expect(s.startOf(3)).toBe(3000);
    expect(s.duration()).toBe(5000);
    expect(s.getStageStarts()).toEqual([0, 2, 3]);
  });

  it('dispatches events as virtual time passes at 1×', () => {
    const s = make({ speed: 1 });
    fiveEvents(s);
    s.play();
    s.tick(0);
    expect(s.getState().cursor).toBe(0);
    s.tick(999);
    expect(s.getState().cursor).toBe(0);
    s.tick(1000);
    expect(s.getState().cursor).toBe(1);
    s.tick(2500);
    expect(s.getState()).toMatchObject({ cursor: 2, virtualTime: 2500, playing: true });
  });

  it('scales virtual time by speed', () => {
    const s = make({ speed: 2 });
    fiveEvents(s);
    s.play();
    s.tick(0);
    s.tick(500); // 500 wall ms × 2 = 1000 virtual ms
    expect(s.getState().cursor).toBe(1);
    s.setSpeed(0.25);
    s.tick(4500); // +4000 wall × 0.25 = +1000 → 2000
    expect(s.getState()).toMatchObject({ cursor: 2, virtualTime: 2000 });
  });

  it('clamps speed to the supported range', () => {
    expect(clampSpeed(0)).toBe(MIN_SPEED);
    expect(clampSpeed(100)).toBe(MAX_SPEED);
    expect(clampSpeed(Number.NaN)).toBeGreaterThan(0);
  });

  it('does not advance while paused', () => {
    const s = make();
    fiveEvents(s);
    s.play();
    s.tick(0);
    s.tick(1500);
    s.pause();
    s.tick(9000);
    expect(s.getState()).toMatchObject({ cursor: 1, virtualTime: 1500, playing: false });
    s.play(); // resumes without a jump: first tick measures from itself
    s.tick(9000);
    expect(s.getState().virtualTime).toBe(1500);
    s.tick(9100);
    expect(s.getState().virtualTime).toBe(1600);
  });

  it('stops at the end when the source is done, and restarts on play', () => {
    const s = make();
    fiveEvents(s);
    s.play();
    s.tick(0);
    s.tick(10000);
    expect(s.getState()).toMatchObject({ cursor: 4, virtualTime: 5000, playing: false, ended: true });
    s.play();
    expect(s.getState()).toMatchObject({ cursor: 0, virtualTime: 0, playing: true });
  });
});

describe('Scheduler stepping and scrubbing', () => {
  it('steps one event at a time and pauses', () => {
    const s = make();
    fiveEvents(s);
    s.play();
    s.stepEvent(1);
    expect(s.getState()).toMatchObject({ cursor: 0, virtualTime: 0, playing: false });
    s.stepEvent(1);
    s.stepEvent(1);
    expect(s.getState()).toMatchObject({ cursor: 2, virtualTime: 2000 });
    s.stepEvent(-1);
    expect(s.getState()).toMatchObject({ cursor: 1, virtualTime: 1000 });
    s.stepEvent(-1);
    s.stepEvent(-1);
    s.stepEvent(-1);
    expect(s.getState()).toMatchObject({ cursor: -1, virtualTime: 0 });
    for (let i = 0; i < 10; i++) s.stepEvent(1);
    expect(s.getState().cursor).toBe(4);
  });

  it('steps by stage: forward to next start, back to current start then previous', () => {
    const s = make();
    fiveEvents(s);
    s.stepStage(1);
    expect(s.getState().cursor).toBe(0);
    s.stepStage(1);
    expect(s.getState().cursor).toBe(2);
    s.stepStage(1);
    expect(s.getState().cursor).toBe(3);
    s.seekEvent(4); // mid-stage
    s.stepStage(-1);
    expect(s.getState().cursor).toBe(3); // start of current stage
    s.stepStage(-1);
    expect(s.getState().cursor).toBe(2);
    s.stepStage(-1);
    expect(s.getState().cursor).toBe(0);
    s.stepStage(-1);
    expect(s.getState().cursor).toBe(-1);
  });

  it('scrubs to an arbitrary time and resolves the cursor', () => {
    const s = make();
    fiveEvents(s);
    s.seekTime(2999);
    expect(s.getState()).toMatchObject({ cursor: 2, virtualTime: 2999 });
    s.seekTime(3000);
    expect(s.getState().cursor).toBe(3);
    s.seekTime(-50);
    expect(s.getState()).toMatchObject({ cursor: 0, virtualTime: 0 });
    s.seekTime(99999);
    expect(s.getState()).toMatchObject({ cursor: 4, virtualTime: 5000 });
  });

  it('keeps playing from the scrubbed position', () => {
    const s = make();
    fiveEvents(s);
    s.play();
    s.tick(0);
    s.seekTime(3500);
    s.tick(100);
    expect(s.getState()).toMatchObject({ cursor: 3, virtualTime: 3600, playing: true });
  });
});

describe('Scheduler auto-pause', () => {
  it('pauses exactly at the first event of a new stage, then continues past it', () => {
    const s = make({ autoPause: true });
    fiveEvents(s);
    s.play();
    s.tick(0);
    s.tick(5000);
    expect(s.getState()).toMatchObject({ cursor: 2, virtualTime: 2000, playing: false });
    s.play();
    s.tick(5000);
    s.tick(5500);
    expect(s.getState()).toMatchObject({ cursor: 2, virtualTime: 2500, playing: true });
    s.tick(6000);
    expect(s.getState()).toMatchObject({ cursor: 3, virtualTime: 3000, playing: false });
  });
});

describe('Scheduler live buffering', () => {
  it('holds at the known end while the source is still streaming, then continues', () => {
    const s = make();
    s.append(ev(0, 'compose', 1000));
    s.append(ev(1, 'compose', 1000));
    s.play();
    s.tick(0);
    s.tick(5000);
    expect(s.getState()).toMatchObject({ cursor: 1, virtualTime: 2000, playing: true, ended: false });
    s.append(ev(2, 'tokenize', 1000));
    expect(s.getState().liveLagMs).toBe(0);
    s.tick(5001);
    expect(s.getState().cursor).toBe(2);
    s.markSourceDone();
    s.tick(9000);
    expect(s.getState()).toMatchObject({ cursor: 2, virtualTime: 3000, playing: false, ended: true });
  });

  it('reports lag and catches up', () => {
    const s = make({ speed: 0.25 });
    for (let i = 0; i < 4; i++) s.append(ev(i, 'compose', 1000));
    s.play();
    s.tick(0);
    s.tick(400); // 100 virtual ms
    expect(s.getState()).toMatchObject({ cursor: 0, liveLagMs: 2900, bufferedEvents: 3 });
    s.catchUp();
    expect(s.getState()).toMatchObject({ cursor: 3, virtualTime: 3000, liveLagMs: 0, playing: true });
  });
});
