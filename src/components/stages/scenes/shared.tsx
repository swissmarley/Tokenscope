import type { ReactNode } from 'react';
import { useShallow } from 'zustand/shallow';
import type { PipelineEvent, StageId } from '../../../pipeline/events';
import { scheduler, useStore } from '../../../store/useStore';

/** Small numeric readout used in collapsed summaries and scene headers. */
export function Stat({ label, value, mono = true }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-[12px]">
      <span className="text-text-faint">{label}</span>
      <span className={(mono ? 'mono tabular ' : '') + 'text-text'}>{value}</span>
    </span>
  );
}

export function SummaryRow({ children }: { children: ReactNode }) {
  return <span className="flex flex-wrap gap-1.5">{children}</span>;
}

/** Recent events belonging to a stage, up to the cursor. Clicking pins one in the inspector. */
export function EventFeed({ stage, limit = 8 }: { stage: StageId; limit?: number }) {
  const { cursor, select, selected } = useStore(
    useShallow((s) => ({ cursor: s.transport.cursor, select: s.select, selected: s.selectedSeq })),
  );
  const items: PipelineEvent[] = [];
  for (let i = cursor; i >= 0 && items.length < limit; i--) {
    const e = scheduler.events[i];
    if (e && e.stage === stage) items.push(e);
  }
  if (items.length === 0) return <div className="text-[12.5px] text-text-faint">No events yet.</div>;
  return (
    <ol className="mono flex flex-col gap-1 text-[11.5px]">
      {items.map((e) => (
        <li key={e.seq}>
          <button
            type="button"
            onClick={() => select(e.seq)}
            className={
              'flex w-full items-center gap-3 rounded-md border px-2.5 py-1.5 text-left transition-colors ' +
              (selected === e.seq
                ? 'border-phase-model/50 bg-phase-model/10'
                : 'border-line bg-surface-2/60 hover:border-line-strong')
            }
          >
            <span className="w-10 text-text-faint">#{e.seq}</span>
            <span className="text-text">{e.type}</span>
            <span className="ml-auto text-text-faint">
              {'layer' in e ? `L${e.layer + 1} · ` : ''}step {e.step} · t={e.t}ms
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function SceneNote({ children }: { children: ReactNode }) {
  return <p className="max-w-prose text-[13px] leading-relaxed text-text-muted">{children}</p>;
}
