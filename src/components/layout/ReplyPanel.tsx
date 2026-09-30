import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { springs } from '../../design/motion';
import { MODE_LABEL, scheduler, useStore } from '../../store/useStore';
import { ChevronDownIcon } from '../common/Icons';

function fmt(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The model's reply as it really arrives — read from the whole event log,
 * not the replay cursor — so the answer is visible even while the slow-motion
 * replay is still on the first stages.
 */
export function ReplyPanel({ className = '' }: { className?: string }) {
  const { eventCount, mode, model, running, lag, cursorText } = useStore(
    useShallow((s) => ({
      eventCount: s.transport.eventCount,
      mode: s.view.runStart?.mode ?? s.mode,
      model: s.view.runStart?.model ?? '',
      running: s.running,
      lag: s.transport.liveLagMs,
      cursorText: s.view.stream.text,
    })),
  );
  const [open, setOpen] = useState(true);
  const reply = useMemo(() => {
    void eventCount;
    let text = '';
    let stop: string | null = null;
    let out = 0;
    for (const e of scheduler.events) {
      if (e.type === 'token_streamed') text += e.text;
      else if (e.type === 'done') {
        stop = e.stopReason;
        out = e.usage.output;
      }
    }
    return { text, stop, out };
  }, [eventCount]);
  if (eventCount === 0) return null;
  const behind = reply.text.length > cursorText.length;

  return (
    <div className={'glass pointer-events-auto rounded-2xl border border-line shadow-panel ' + className}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span className="h-2 w-2 rounded-full" style={{ background: running ? 'var(--color-danger)' : reply.stop ? 'var(--color-ok)' : 'var(--color-warn)' }} />
        <span className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Reply · {MODE_LABEL[mode]}</span>
        <span className="mono ml-auto text-[10.5px] text-text-faint">
          {running ? 'streaming…' : reply.stop ? `${reply.out} tokens · ${reply.stop}` : ''}
        </span>
        <motion.span animate={{ rotate: open ? 0 : -90 }} className="inline-flex text-text-faint">
          <ChevronDownIcon width={14} height={14} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={springs.soft} className="overflow-hidden">
            <div className="max-h-[32vh] overflow-y-auto px-3 pb-3">
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-text">
                {reply.text || <span className="text-text-faint">{running ? 'waiting for the first token…' : 'no text received'}</span>}
                {running && <span className="animate-pulse-soft text-phase-output">▍</span>}
              </p>
              {model && <div className="mt-1.5 text-[10.5px] text-text-faint">{model}</div>}
              {behind && !running && (
                <div className="mt-1.5 text-[10.5px] text-text-faint">
                  This is the real reply, already complete. The slow-motion replay is {fmt(lag)} behind and will show it token by token.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
