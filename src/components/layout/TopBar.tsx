import { motion } from 'framer-motion';
import { useShallow } from 'zustand/shallow';
import { springs } from '../../design/motion';
import type { Mode } from '../../pipeline/events';
import { PRESETS } from '../../sim/presets';
import { MODE_LABEL, modeAvailability, useStore } from '../../store/useStore';
import { playCue, primeAudio } from '../../audio/cues';
import { IconButton } from '../common/IconButton';
import { ChevronDownIcon, FilmIcon, GearIcon, PanelIcon, SendIcon, SoundIcon, SoundOffIcon, StopIcon } from '../common/Icons';
import { HistoryMenu } from './HistoryMenu';

const MODES: Mode[] = ['mock', 'live', 'lab'];

function Logo() {
  return (
    <div className="flex items-center gap-2.5 pr-2">
      <div className="relative h-7 w-7">
        <span className="absolute inset-0 rounded-lg bg-[conic-gradient(from_200deg,var(--color-phase-input),var(--color-phase-model),var(--color-phase-output),var(--color-phase-input))] opacity-90" />
        <span className="absolute inset-[3px] rounded-[6px] bg-bg-deep" />
        <span className="absolute inset-0 grid place-items-center text-[11px] font-black tracking-tight text-text">λ</span>
      </div>
      <div className="leading-tight">
        <div className="text-[13.5px] font-semibold tracking-tight">LLM Under the Hood</div>
        <div className="text-[10.5px] text-text-faint">slow-motion pipeline</div>
      </div>
    </div>
  );
}

const DOT: Record<string, string> = { ready: 'bg-ok', unavailable: 'bg-danger', unknown: 'bg-warn' };

function CinematicButton() {
  const { on, start, stop, viewMode, eventCount } = useStore(
    useShallow((s) => ({ on: s.cinematic, start: s.startCinematic, stop: s.stopCinematic, viewMode: s.viewMode, eventCount: s.transport.eventCount })),
  );
  if (viewMode !== 'cinema') return null;
  return (
    <button
      type="button"
      disabled={eventCount === 0}
      onClick={() => (on ? stop() : start())}
      title={on ? 'Exit the fly-through (Esc)' : 'Play the whole run as a fly-through with automatic camera moves'}
      className={
        'inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium disabled:opacity-40 ' +
        (on ? 'border-phase-output/60 bg-phase-output/15 text-phase-output' : 'border-line bg-surface-2 text-text-muted hover:border-line-strong hover:text-text')
      }
    >
      <FilmIcon width={15} height={15} /> {on ? 'Exit' : 'Fly-through'}
    </button>
  );
}

function ModeToggle() {
  const { mode, setMode, health, conn } = useStore(useShallow((s) => ({ mode: s.mode, setMode: s.setMode, health: s.health, conn: s.connection })));
  return (
    <div data-tour="mode" role="radiogroup" aria-label="Event source" className="relative flex rounded-lg border border-line bg-surface-2 p-0.5">
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          title={modeAvailability(m, health, conn).detail}
          onClick={() => setMode(m)}
          className={
            'relative z-10 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ' +
            (mode === m ? 'text-text' : 'text-text-muted hover:text-text')
          }
        >
          {mode === m && (
            <motion.span
              layoutId="mode-pill"
              transition={springs.snappy}
              className="absolute inset-0 -z-10 rounded-md bg-surface-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]"
            />
          )}
          <span className={'mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ' + (DOT[modeAvailability(m, health, conn).state] ?? 'bg-warn')} />
          {MODE_LABEL[m]}
        </button>
      ))}
    </div>
  );
}

function ViewToggle() {
  const { mode, set } = useStore(useShallow((s) => ({ mode: s.viewMode, set: s.setViewMode })));
  const opts = [
    { id: 'cinema', label: '3D', title: 'Cinematic 3-D world' },
    { id: 'detail', label: 'Detail', title: 'Stage-by-stage 2-D scenes' },
  ] as const;
  return (
    <div role="radiogroup" aria-label="View" className="relative flex rounded-lg border border-line bg-surface-2 p-0.5">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={mode === o.id}
          title={o.title}
          onClick={() => set(o.id)}
          className={'relative z-10 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ' + (mode === o.id ? 'text-text' : 'text-text-muted hover:text-text')}
        >
          {mode === o.id && <motion.span layoutId="view-pill" transition={springs.snappy} className="absolute inset-0 -z-10 rounded-md bg-phase-output/20 shadow-[inset_0_0_0_1px_rgb(251_191_36/0.4)]" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ExplainToggle() {
  const { level, set } = useStore(useShallow((s) => ({ level: s.explainLevel, set: s.setExplainLevel })));
  const opts = [
    { id: 'simple', label: "I'm new", title: 'Explain like I’m new: plain-language annotations' },
    { id: 'math', label: 'Math', title: 'Show the math: formulas and shapes' },
  ] as const;
  return (
    <div data-tour="explain" role="radiogroup" aria-label="Annotation depth" className="relative flex rounded-lg border border-line bg-surface-2 p-0.5">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={level === o.id}
          title={o.title}
          onClick={() => set(o.id)}
          className={
            'relative z-10 rounded-md px-2.5 py-1 text-[12px] font-medium whitespace-nowrap transition-colors ' +
            (level === o.id ? 'text-text' : 'text-text-muted hover:text-text')
          }
        >
          {level === o.id && (
            <motion.span
              layoutId="explain-pill"
              transition={springs.snappy}
              className="absolute inset-0 -z-10 rounded-md bg-phase-model/20 shadow-[inset_0_0_0_1px_rgb(167_139_250/0.4)]"
            />
          )}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SoundToggle() {
  const { on, set } = useStore(useShallow((s) => ({ on: s.soundOn, set: s.setSoundOn })));
  return (
    <IconButton
      label={on ? 'Sound cues on' : 'Sound cues off'}
      active={on}
      onClick={() => {
        primeAudio();
        set(!on);
        if (!on) playCue('tick');
      }}
    >
      {on ? <SoundIcon /> : <SoundOffIcon />}
    </IconButton>
  );
}

function SpeedChip() {
  const { speed, bump } = useStore(useShallow((s) => ({ speed: s.transport.speed, bump: s.bumpSpeed })));
  return (
    <button
      type="button"
      onClick={() => bump(1)}
      onContextMenu={(e) => {
        e.preventDefault();
        bump(-1);
      }}
      title="Playback speed — click to increase, right-click to decrease ( [ and ] keys )"
      className="mono tabular rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-text-muted hover:border-line-strong hover:text-text"
    >
      {speed}×
    </button>
  );
}

export function TopBar() {
  const { prompt, setPrompt, send, stop, running, inspectorOpen, toggleInspector, setSettingsOpen } = useStore(
    useShallow((s) => ({
      prompt: s.prompt,
      setPrompt: s.setPrompt,
      send: s.send,
      stop: s.stop,
      running: s.running,
      inspectorOpen: s.inspectorOpen,
      toggleInspector: s.toggleInspector,
      setSettingsOpen: s.setSettingsOpen,
    })),
  );
  const activePreset = PRESETS.find((p) => p.prompt === prompt)?.id ?? '';

  return (
    <header className="glass z-20 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2 lg:flex-nowrap lg:py-0">
      <Logo />
      <form
        data-tour="prompt"
        className="order-3 flex min-w-0 basis-full items-center gap-2 lg:order-none lg:flex-1 lg:basis-auto"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="relative shrink-0">
          <select
            aria-label="Example prompts"
            value={activePreset}
            onChange={(e) => {
              const p = PRESETS.find((x) => x.id === e.target.value);
              if (p) setPrompt(p.prompt);
            }}
            className="h-9 appearance-none rounded-lg border border-line bg-surface-2 pr-7 pl-3 text-[12.5px] text-text-muted hover:border-line-strong hover:text-text focus:outline-none"
          >
            <option value="" disabled>
              Examples…
            </option>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-text-faint" width={14} height={14} />
        </label>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Type a message to the model…"
          aria-label="Message"
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-[13.5px] text-text placeholder:text-text-faint focus:border-phase-input/60 focus:shadow-glow-input focus:outline-none"
        />
        {running ? (
          <button
            type="button"
            onClick={stop}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-3 text-[13px] font-medium text-danger hover:bg-danger/20"
          >
            <StopIcon width={14} height={14} /> Stop
          </button>
        ) : (
          <button
            type="submit"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-phase-input px-3.5 text-[13px] font-semibold text-bg-deep shadow-glow-input transition-transform active:scale-95 hover:brightness-110"
          >
            <SendIcon width={15} height={15} /> Send
          </button>
        )}
      </form>
      <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
        <ModeToggle />
        <ViewToggle />
        <CinematicButton />
        <span className="hidden xl:inline-flex">
          <SpeedChip />
        </span>
        <ExplainToggle />
        <SoundToggle />
        <HistoryMenu />
        <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
          <GearIcon />
        </IconButton>
        <span data-tour="inspector" className="inline-flex">
          <IconButton label="Inspector (I)" active={inspectorOpen} onClick={() => toggleInspector()}>
            <PanelIcon />
          </IconButton>
        </span>
      </div>
    </header>
  );
}
