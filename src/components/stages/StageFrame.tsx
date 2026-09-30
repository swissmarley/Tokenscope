import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { springs, tween } from '../../design/motion';
import type { Fidelity } from '../../pipeline/events';
import { stageColor, stageColorSoft, type StageMeta } from '../../pipeline/stages';
import { FidelityBadge } from '../common/Badge';

export type StageStatus = 'upcoming' | 'active' | 'done';

interface Props {
  stage: StageMeta;
  status: StageStatus;
  /** Expanded scene visible (active, or user-focused). */
  expanded: boolean;
  /** Dimmed because the camera is on another stage. */
  dimmed: boolean;
  fidelity: Fidelity | null;
  onToggle: () => void;
  summary: ReactNode;
  children: ReactNode;
}

export function StageFrame({ stage, status, expanded, dimmed, fidelity, onToggle, summary, children }: Props) {
  const color = stageColor(stage.id);
  const soft = stageColorSoft(stage.id);
  const upcoming = status === 'upcoming';
  return (
    <motion.section
      id={`stage-${stage.id}`}
      layout="position"
      animate={{ opacity: upcoming ? 0.42 : dimmed ? 0.55 : 1, scale: dimmed && !expanded ? 0.995 : 1 }}
      transition={tween(0.5)}
      className="scroll-mt-6"
      aria-current={status === 'active' ? 'step' : undefined}
    >
      <div
        className={
          'panel relative overflow-hidden transition-[border-color,box-shadow] duration-500 ' +
          (fidelity === 'illustrative' && !upcoming ? 'border-dashed' : '')
        }
        style={
          status === 'active' && expanded
            ? { borderColor: color, boxShadow: `0 0 0 1px ${soft}, 0 0 48px ${soft}, var(--shadow-panel)` }
            : undefined
        }
      >
        {/* accent edge */}
        <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: upcoming ? 'var(--color-line)' : color }} />

        <button
          type="button"
          onClick={onToggle}
          disabled={upcoming}
          className="flex w-full items-start gap-4 px-6 py-4 text-left disabled:cursor-default"
        >
          <span
            className="mono grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[13px] font-bold"
            style={{ background: upcoming ? 'var(--color-surface-2)' : soft, color: upcoming ? 'var(--color-text-faint)' : color }}
          >
            {stage.index}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[17px] font-semibold tracking-tight">{stage.title}</span>
              {fidelity && !upcoming && <FidelityBadge fidelity={fidelity} />}
              {status === 'done' && !expanded && (
                <span className="ml-auto text-[11px] text-text-faint">click to expand</span>
              )}
            </span>
            <span className="mt-0.5 block text-[13px] text-text-muted">{stage.blurb}</span>
            {!expanded && !upcoming && <span className="mt-2 block">{summary}</span>}
          </span>
        </button>

        <AnimatePresence initial={false}>
          {expanded && !upcoming && (
            <motion.div
              key="body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1, transition: springs.soft }}
              exit={{ height: 0, opacity: 0, transition: tween(0.32) }}
              className="overflow-hidden"
            >
              <div className="border-t border-line px-6 py-5">{children}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
