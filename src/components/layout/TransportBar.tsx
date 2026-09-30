import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useShallow } from 'zustand/shallow';
import { MAX_SPEED, MIN_SPEED, SPEED_PRESETS } from '../../pipeline/scheduler';
import { STAGE_BY_ID, STAGE_ORDER, stageColor } from '../../pipeline/stages';
import { scheduler, useStore } from '../../store/useStore';
import { Kbd } from '../common/Badge';
import { IconButton } from '../common/IconButton';
import {
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
  StepBackIcon,
  StepForwardIcon,
} from '../common/Icons';

function fmtTime(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
}

// Log-scale slider for 0.1×–4×.
const toSlider = (speed: number): number =>
  (Math.log(speed) - Math.log(MIN_SPEED)) / (Math.log(MAX_SPEED) - Math.log(MIN_SPEED));
const fromSlider = (x: number): number =>
  Math.exp(Math.log(MIN_SPEED) + x * (Math.log(MAX_SPEED) - Math.log(MIN_SPEED)));

interface Segment {
  stage: (typeof STAGE_ORDER)[number];
  start: number;
  end: number;
}

function Timeline() {
  const { duration, virtualTime, cursor, eventCount, version, seekTime, pause, playing, play } = useStore(
    useShallow((s) => ({
      duration: s.transport.duration,
      virtualTime: s.transport.virtualTime,
      cursor: s.transport.cursor,
      eventCount: s.transport.eventCount,
      version: s.transport.version,
      seekTime: s.seekTime,
      pause: s.pause,
      playing: s.transport.playing,
      play: s.play,
    })),
  );
  const ref = useRef<HTMLDivElement>(null);
  const wasPlaying = useRef(false);
  const [hover, setHover] = useState<{ x: number; ms: number } | null>(null);

  // Stage segments only change when events are appended, not every frame.
  const segments = useMemo<Segment[]>(() => {
    void version;
    const starts = scheduler.getStageStarts();
    const out: Segment[] = [];
    for (let i = 0; i < starts.length; i++) {
      const si = starts[i];
      if (si === undefined) continue;
      const ev = scheduler.events[si];
      if (!ev) continue;
      const next = starts[i + 1];
      const end = next === undefined ? scheduler.duration() : scheduler.startOf(next);
      out.push({ stage: ev.stage, start: scheduler.startOf(si), end });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventCount, duration]);

  const msAt = useCallback(
    (clientX: number): number => {
      const el = ref.current;
      if (!el || duration <= 0) return 0;
      const r = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      return x * duration;
    },
    [duration],
  );

  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    wasPlaying.current = playing;
    pause();
    seekTime(msAt(e.clientX));
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setHover({ x: e.clientX - r.left, ms: msAt(e.clientX) });
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) seekTime(msAt(e.clientX));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (wasPlaying.current) play();
  };

  const pct = duration > 0 ? (virtualTime / duration) * 100 : 0;
  const hoverSeg = hover ? segments.find((s) => hover.ms >= s.start && hover.ms < s.end) : undefined;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex items-center justify-between text-[11px] text-text-muted">
        <span className="mono tabular">
          {fmtTime(virtualTime)} <span className="text-text-faint">/ {fmtTime(duration)}</span>
        </span>
        <span className="mono tabular text-text-faint">
          event {Math.max(0, cursor + 1)} / {eventCount}
        </span>
      </div>
      <div
        ref={ref}
        role="slider"
        aria-label="Timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(virtualTime)}
        tabIndex={0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => setHover(null)}
        className="group relative h-6 cursor-pointer touch-none select-none"
      >
        <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 overflow-hidden rounded-full bg-surface-3">
          {segments.map((s, i) => {
            const left = duration > 0 ? (s.start / duration) * 100 : 0;
            const width = duration > 0 ? ((s.end - s.start) / duration) * 100 : 0;
            return (
              <div
                key={`${s.stage}-${i}`}
                className="absolute top-0 h-full opacity-40 transition-opacity group-hover:opacity-60"
                style={{ left: `${left}%`, width: `${width}%`, background: stageColor(s.stage) }}
              />
            );
          })}
          <div className="absolute top-0 h-full bg-white/25" style={{ width: `${pct}%` }} />
        </div>
        {/* stage boundary ticks */}
        {segments.map((s, i) =>
          i === 0 ? null : (
            <div
              key={`tick-${i}`}
              className="absolute top-1/2 h-3.5 w-px -translate-y-1/2 bg-bg-deep"
              style={{ left: `${duration > 0 ? (s.start / duration) * 100 : 0}%` }}
            />
          ),
        )}
        <div
          className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text shadow-[0_0_0_2px_var(--color-bg-deep),0_0_12px_rgb(255_255_255/0.5)]"
          style={{ left: `${pct}%` }}
        />
        {hover && hoverSeg && (
          <div
            className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded-md border border-line bg-bg-deep px-2 py-0.5 text-[11px] whitespace-nowrap text-text"
            style={{ left: hover.x }}
          >
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: stageColor(hoverSeg.stage) }} />
            {STAGE_BY_ID[hoverSeg.stage].title} · {fmtTime(hover.ms)}
          </div>
        )}
      </div>
    </div>
  );
}

function SpeedControl() {
  const { speed, setSpeed } = useStore(useShallow((s) => ({ speed: s.transport.speed, setSpeed: s.setSpeed })));
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[11px] text-text-muted">
          <span>Speed</span>
          <span className="mono tabular text-text">{speed}×</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={toSlider(speed)}
          aria-label="Playback speed"
          onChange={(e) => setSpeed(Math.round(fromSlider(Number(e.target.value)) * 100) / 100)}
          className="w-32"
        />
      </div>
      <div className="hidden flex-col gap-0.5 lg:flex">
        {[SPEED_PRESETS.slice(0, 3), SPEED_PRESETS.slice(3)].map((row, ri) => (
          <div key={ri} className="flex gap-0.5">
            {row.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setSpeed(p)}
                className={
                  'mono tabular h-5 w-9 rounded border text-[10.5px] transition-colors ' +
                  (Math.abs(speed - p) < 1e-6
                    ? 'border-phase-model/60 bg-phase-model/20 text-text'
                    : 'border-line bg-surface-2 text-text-muted hover:text-text')
                }
              >
                {p}×
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveLag() {
  const { lag, buffered, sourceDone, mode, catchUp } = useStore(
    useShallow((s) => ({
      lag: s.transport.liveLagMs,
      buffered: s.transport.bufferedEvents,
      sourceDone: s.transport.sourceDone,
      mode: s.mode,
      catchUp: s.catchUp,
    })),
  );
  if (mode === 'mock' && sourceDone) return null;
  if (buffered === 0) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[11px]">
      <span className={'h-1.5 w-1.5 rounded-full ' + (sourceDone ? 'bg-text-faint' : 'animate-pulse-soft bg-danger')} />
      <span className="text-text-muted">
        replay <span className="mono tabular text-text">{fmtTime(lag)}</span> behind · {buffered} queued
      </span>
      <button type="button" onClick={catchUp} className="rounded bg-surface-3 px-1.5 py-0.5 text-text hover:bg-line-strong">
        Catch up
      </button>
    </div>
  );
}

export function TransportBar() {
  const { playing, toggle, stepEvent, stepStage, autoPause, setAutoPause, eventCount } = useStore(
    useShallow((s) => ({
      playing: s.transport.playing,
      toggle: s.toggle,
      stepEvent: s.stepEvent,
      stepStage: s.stepStage,
      autoPause: s.transport.autoPauseOnStage,
      setAutoPause: s.setAutoPause,
      eventCount: s.transport.eventCount,
    })),
  );
  const disabled = eventCount === 0;
  return (
    <footer data-tour="transport" className="glass z-20 flex h-[84px] items-center gap-5 border-t border-line px-4">
      <div className="flex items-center gap-1.5">
        <IconButton label="Previous stage (Shift+←)" disabled={disabled} onClick={() => stepStage(-1)}>
          <SkipBackIcon />
        </IconButton>
        <IconButton label="Previous event (←)" disabled={disabled} onClick={() => stepEvent(-1)}>
          <StepBackIcon />
        </IconButton>
        <IconButton
          label={playing ? 'Pause (Space)' : 'Play (Space)'}
          size="lg"
          disabled={disabled}
          onClick={toggle}
          className="!border-phase-model/50 !bg-phase-model/15 !text-text shadow-glow-model"
        >
          {playing ? <PauseIcon width={22} height={22} /> : <PlayIcon width={22} height={22} />}
        </IconButton>
        <IconButton label="Next event (→)" disabled={disabled} onClick={() => stepEvent(1)}>
          <StepForwardIcon />
        </IconButton>
        <IconButton label="Next stage (Shift+→)" disabled={disabled} onClick={() => stepStage(1)}>
          <SkipForwardIcon />
        </IconButton>
      </div>
      <Timeline />
      <LiveLag />
      <SpeedControl />
      <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-text-muted select-none" title="Pause at the start of each stage">
        <input
          type="checkbox"
          checked={autoPause}
          onChange={(e) => setAutoPause(e.target.checked)}
          className="h-3.5 w-3.5 accent-[var(--color-phase-model)]"
        />
        <span className="hidden lg:inline">Pause at each stage</span>
        <span className="lg:hidden">Auto-pause</span>
      </label>
      <div className="hidden items-center gap-1 text-[10.5px] text-text-faint 2xl:flex">
        <Kbd>Space</Kbd> play · <Kbd>←</Kbd>
        <Kbd>→</Kbd> step · <Kbd>[</Kbd>
        <Kbd>]</Kbd> speed
      </div>
    </footer>
  );
}
