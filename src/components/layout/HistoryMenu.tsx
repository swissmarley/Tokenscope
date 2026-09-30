import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/shallow';
import { springs } from '../../design/motion';
import { MODE_LABEL, useStore } from '../../store/useStore';
import { IconButton } from '../common/IconButton';
import { CloseIcon, HistoryIcon } from '../common/Icons';

function ago(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** Saved runs (IndexedDB): replay any of them without another API call. */
export function HistoryMenu() {
  const { open, setOpen, history, openRun, removeRun } = useStore(
    useShallow((s) => ({ open: s.historyOpen, setOpen: s.setHistoryOpen, history: s.history, openRun: s.openRun, removeRun: s.removeRun })),
  );
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open, setOpen]);

  return (
    <div ref={ref} className="relative">
      <IconButton label="Run history" active={open} onClick={() => setOpen(!open)}>
        <HistoryIcon />
      </IconButton>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={springs.snappy}
            className="panel absolute top-11 right-0 z-40 w-[380px] overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Saved runs</span>
              <span className="text-[10.5px] text-text-faint">kept locally · last 20</span>
            </div>
            <ul className="max-h-[360px] overflow-y-auto">
              {history.length === 0 && <li className="px-3 py-6 text-center text-[12.5px] text-text-faint">No runs saved yet.</li>}
              {history.map((r) => (
                <li key={r.id} className="group flex items-start gap-2 border-b border-line/60 px-3 py-2 last:border-0 hover:bg-surface-2/60">
                  <button type="button" onClick={() => void openRun(r.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2 text-[10.5px] text-text-faint">
                      <span className={'rounded px-1 font-semibold uppercase ' + (r.mode === 'mock' ? 'bg-surface-3 text-text-muted' : r.mode === 'live' ? 'bg-phase-output/20 text-phase-output' : 'bg-phase-model/20 text-phase-model')}>
                        {MODE_LABEL[r.mode]}
                      </span>
                      <span>{r.model}</span>
                      <span className="ml-auto">{ago(r.createdAt)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[12.5px] text-text">{r.prompt}</div>
                    <div className="truncate text-[11.5px] text-text-muted">{r.reply || (r.done ? '(no reply)' : '(incomplete)')}</div>
                  </button>
                  <button type="button" aria-label="Delete run" onClick={() => void removeRun(r.id)} className="mt-1 text-text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger">
                    <CloseIcon width={13} height={13} />
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
