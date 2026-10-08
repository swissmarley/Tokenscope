import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { explainEvent } from '../../content/explain';
import { tween } from '../../design/motion';
import type { PipelineEvent } from '../../pipeline/events';
import { STAGE_BY_ID, stageColor } from '../../pipeline/stages';
import { selectInspectedEvent, useStore } from '../../store/useStore';
import { FidelityBadge } from '../common/Badge';
import { IconButton } from '../common/IconButton';
import { CloseIcon, CopyIcon } from '../common/Icons';

const WIDTH = 380;

/** JSON with big numeric arrays abbreviated so the panel stays readable. */
function prettyEvent(e: PipelineEvent): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    e,
    (_k, v: unknown) => {
      if (Array.isArray(v)) {
        if (v.length > 12 && v.every((x) => typeof x === 'number')) {
          return [...v.slice(0, 6).map((x: number) => Number(x.toFixed(4))), `… ${v.length - 6} more`];
        }
        if (v.length > 6 && v.every((x) => Array.isArray(x))) {
          return [...v.slice(0, 3), `… ${v.length - 3} more rows`];
        }
        return v;
      }
      if (typeof v === 'number' && !Number.isInteger(v)) return Number(v.toFixed(4));
      if (v && typeof v === 'object') {
        if (seen.has(v)) return '[circular]';
        seen.add(v);
      }
      return v;
    },
    2,
  );
}

export function Inspector() {
  const { open, toggleInspector, event, level, following } = useStore(
    useShallow((s) => ({
      open: s.inspectorOpen,
      toggleInspector: s.toggleInspector,
      event: selectInspectedEvent(s),
      level: s.explainLevel,
      following: s.selectedSeq === null,
    })),
  );
  const close = (): void => toggleInspector(false);
  const view = useStore((s) => s.view);
  const unpin = useStore((s) => s.select);
  const [tab, setTab] = useState<'explain' | 'json'>('explain');
  const [copied, setCopied] = useState(false);

  const explanation = useMemo(() => (event ? explainEvent(event, view) : null), [event, view]);
  const json = useMemo(() => (event ? prettyEvent(event) : ''), [event]);

  return (
    <motion.aside
      aria-label="Inspector"
      initial={false}
      animate={{ width: open ? WIDTH : 0 }}
      transition={tween(0.35)}
      className="relative z-10 h-full overflow-hidden border-l border-line bg-bg-deep/60"
    >
      <div className="flex h-full flex-col" style={{ width: WIDTH }}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <div className="text-[12px] font-semibold tracking-[0.1em] text-text-muted uppercase">Inspector</div>
          <div className="ml-auto flex items-center gap-1 rounded-lg border border-line bg-surface-2 p-0.5">
            {(['explain', 'json'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={
                  'rounded-md px-2.5 py-1 text-[12px] font-medium capitalize ' +
                  (tab === t ? 'bg-surface-3 text-text' : 'text-text-muted hover:text-text')
                }
              >
                {t === 'json' ? 'Event JSON' : 'Explain'}
              </button>
            ))}
          </div>
          <IconButton label="Close inspector (Esc)" size="sm" onClick={close}>
            <CloseIcon width={15} height={15} />
          </IconButton>
        </div>

        {!event || !explanation ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-[13px] text-text-faint">
            Press Send to start a run, then click any stage or event.
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-line px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.08em] uppercase"
                  style={{ color: stageColor(event.stage), background: 'color-mix(in srgb, currentColor 14%, transparent)' }}
                >
                  {STAGE_BY_ID[event.stage].short}
                </span>
                <FidelityBadge fidelity={event.fidelity} />
                <span className="mono ml-auto text-[10.5px] text-text-faint">
                  #{event.seq} · t={event.t}ms · step {event.step}
                </span>
              </div>
              <h3 className="mt-2 text-[15px] font-semibold tracking-tight">{explanation.title}</h3>
              <div className="mt-1 text-[11px] text-text-faint">
                {following ? (
                  'Following the latest event'
                ) : (
                  <button type="button" onClick={() => unpin(null)} className="underline decoration-dotted underline-offset-2 hover:text-text">
                    Pinned · click to follow latest
                  </button>
                )}
              </div>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {tab === 'explain' ? (
                <motion.div
                  key={`explain-${event.seq}-${level}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={tween(0.25)}
                  className="flex-1 space-y-5 overflow-y-auto px-4 py-4"
                >
                  <section>
                    <h4 className="mb-1.5 text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">
                      What's happening
                    </h4>
                    <p className={'text-[13.5px] leading-relaxed text-text wrap-anywhere ' + (level === 'math' ? 'mono !text-[12.5px]' : '')}>
                      {level === 'math' ? explanation.math : explanation.simple}
                    </p>
                  </section>
                  <section>
                    <h4 className="mb-1.5 text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Go deeper</h4>
                    <p className="text-[13px] leading-relaxed text-text-muted">{explanation.deeper}</p>
                  </section>
                  {event.fidelity === 'illustrative' && (
                    <p className="rounded-lg border border-dashed border-warn/40 bg-warn/5 px-3 py-2 text-[12px] text-warn/90">
                      This data is illustrative: generated by a deterministic simulator to show the shape of the
                      computation, not read from the model you are talking to.
                    </p>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key={`json-${event.seq}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={tween(0.2)}
                  className="relative min-h-0 flex-1"
                >
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(JSON.stringify(event, null, 2));
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1200);
                    }}
                    className="absolute top-2 right-3 z-10 inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] text-text-muted hover:text-text"
                  >
                    <CopyIcon width={12} height={12} /> {copied ? 'Copied' : 'Copy'}
                  </button>
                  <pre className="mono h-full overflow-auto px-4 py-3 text-[11.5px] leading-relaxed text-text-muted">
                    {json}
                  </pre>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.aside>
  );
}
