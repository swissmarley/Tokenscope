import { motion } from 'framer-motion';
import { useShallow } from 'zustand/shallow';
import { springs } from '../../design/motion';
import type { Mode } from '../../pipeline/events';
import { PRESETS } from '../../sim/presets';
import { MODE_LABEL, modeAvailability, useStore } from '../../store/useStore';
import { SendIcon } from '../common/Icons';

const MODES: Array<{ id: Mode; tagline: string; body: string; badge: string }> = [
  {
    id: 'mock',
    tagline: 'No key, no download',
    body: 'A canned run for the example prompts. Real BPE tokenization; every other stage is a labelled simulation.',
    badge: 'illustrative internals',
  },
  {
    id: 'live',
    tagline: 'A real reply from the API',
    body: 'Streams a real completion through your proxy. Real request, timing, chunks, stop reason and usage; model internals stay illustrative.',
    badge: 'real stream · illustrative internals',
  },
  {
    id: 'lab',
    tagline: 'A small model, opened up',
    body: 'distilgpt2 running on your machine: real tokens, embedding rows, attention for every layer and head, logits and the actual dice roll.',
    badge: 'everything real',
  },
];

const DOT: Record<string, string> = { ready: 'bg-ok', unavailable: 'bg-danger', unknown: 'bg-warn' };

/** First screen: pick a source and a prompt, then start the journey. */
export function Welcome() {
  const { mode, setMode, health, prompt, setPrompt, send, running, conn, setSettingsOpen } = useStore(
    useShallow((s) => ({
      mode: s.mode,
      setMode: s.setMode,
      health: s.health,
      prompt: s.prompt,
      setPrompt: s.setPrompt,
      send: s.send,
      running: s.running,
      conn: s.connection,
      setSettingsOpen: s.setSettingsOpen,
    })),
  );
  const openSettings = (): void => setSettingsOpen(true);
  const avail = modeAvailability(mode, health, conn);
  const canStart = prompt.trim().length > 0 && avail.state !== 'unavailable' && !running;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.soft} className="mx-auto max-w-[980px] space-y-6 py-4">
      <div className="text-center">
        <h1 className="text-[30px] font-semibold tracking-tight">Watch a language model think, in slow motion.</h1>
        <p className="mx-auto mt-2 max-w-[640px] text-[14px] leading-relaxed text-text-muted">
          Pick where the events come from, choose a prompt, and follow it from the Send button to the last streamed character —
          tokens, embeddings, attention, the KV cache, sampling, the loop. Pause, step and scrub at any point.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {MODES.map((m) => {
          const a = modeAvailability(m.id, health, conn);
          const on = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              aria-pressed={on}
              className={
                'panel relative p-4 text-left transition-[border-color,box-shadow] ' +
                (on ? 'border-phase-input shadow-glow-input' : 'hover:border-line-strong')
              }
            >
              <div className="flex items-center gap-2">
                <span className={'h-2 w-2 rounded-full ' + (DOT[a.state] ?? 'bg-warn')} />
                <span className="text-[15px] font-semibold">{MODE_LABEL[m.id]}</span>
                <span className="ml-auto text-[10.5px] tracking-[0.08em] text-text-faint uppercase">{m.tagline}</span>
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-text-muted">{m.body}</p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className={'mono rounded px-1.5 py-0.5 text-[10px] ' + (m.id === 'lab' ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn')}>{m.badge}</span>
                <span className={'truncate text-[10.5px] ' + (a.state === 'ready' ? 'text-ok' : a.state === 'unavailable' ? 'text-danger' : 'text-warn')} title={a.detail}>
                  {a.detail}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="panel p-4">
        <div className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Example prompts</div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPrompt(p.prompt)}
              title={p.shows}
              className={
                'rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors ' +
                (prompt === p.prompt ? 'border-phase-input/70 bg-phase-input/15 text-text' : 'border-line bg-surface-2 text-text-muted hover:border-line-strong hover:text-text')
              }
            >
              {p.label}
            </button>
          ))}
        </div>
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (canStart) void send();
          }}
        >
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="…or type your own message"
            aria-label="Message"
            className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-[14px] text-text placeholder:text-text-faint focus:border-phase-input/60 focus:shadow-glow-input focus:outline-none"
          />
          <button
            type="submit"
            disabled={!canStart}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-phase-input px-4 text-[13.5px] font-semibold text-bg-deep shadow-glow-input transition-transform hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SendIcon width={15} height={15} /> Start in {MODE_LABEL[mode]}
          </button>
        </form>
        {avail.state === 'unavailable' && (
          <p className="mt-2 flex items-center gap-3 text-[12px] text-danger">
            {avail.detail}
            <button type="button" onClick={openSettings} className="rounded-md border border-line px-2 py-0.5 text-text-muted hover:text-text">
              Open Settings
            </button>
          </p>
        )}
        {mode === 'mock' && !PRESETS.some((p) => p.prompt === prompt.trim()) && prompt.trim() && (
          <p className="mt-2 text-[12px] text-text-faint">Mock mode can only answer the example prompts; your text will get a canned reply. Use Live or Lab for a real answer.</p>
        )}
      </div>
    </motion.div>
  );
}
