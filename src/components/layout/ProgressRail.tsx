import { motion } from 'framer-motion';
import { useShallow } from 'zustand/shallow';
import { springs } from '../../design/motion';
import { STAGES, stageColor, stageColorSoft, stageIndex, type Phase } from '../../pipeline/stages';
import { useStore } from '../../store/useStore';
import { CheckIcon } from '../common/Icons';

const PHASE_LABEL: Record<Phase, string> = { input: 'Input', model: 'Model internals', output: 'Output' };

export function ProgressRail() {
  const { currentStage, reached, loop, seekStage, focusedStage, setFocusedStage } = useStore(
    useShallow((s) => ({
      currentStage: s.view.currentStage,
      reached: s.view.reached,
      loop: s.view.loop,
      seekStage: s.seekStage,
      focusedStage: s.focusedStage,
      setFocusedStage: s.setFocusedStage,
    })),
  );
  const currentIdx = currentStage ? stageIndex(currentStage) : -1;

  return (
    <nav data-tour="rail" aria-label="Pipeline stages" className="relative hidden flex-col gap-1 overflow-y-auto border-r border-line bg-bg-deep/40 px-3 py-4 lg:flex">
      {STAGES.map((s, i) => {
        const isCurrent = s.id === currentStage;
        const isReached = reached[s.id];
        const isFocused = focusedStage === s.id;
        const prevPhase = STAGES[i - 1]?.phase;
        const color = stageColor(s.id);
        return (
          <div key={s.id}>
            {prevPhase !== s.phase && (
              <div className="mt-2 mb-1.5 px-1 text-[10px] font-semibold tracking-[0.12em] uppercase" style={{ color }}>
                {PHASE_LABEL[s.phase]}
              </div>
            )}
            <button
              type="button"
              disabled={!isReached}
              onClick={() => {
                if (isCurrent) setFocusedStage(isFocused ? null : s.id);
                else seekStage(s.id);
              }}
              aria-current={isCurrent ? 'step' : undefined}
              className={
                'group relative flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors disabled:cursor-default ' +
                (isCurrent ? 'bg-surface-2' : isReached ? 'hover:bg-surface-2/70' : '')
              }
            >
              {isCurrent && (
                <motion.span
                  layoutId="rail-active"
                  transition={springs.snappy}
                  className="absolute inset-0 rounded-lg border"
                  style={{ borderColor: color, boxShadow: `0 0 18px ${stageColorSoft(s.id)}` }}
                />
              )}
              <span
                className={
                  'relative grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold transition-colors ' +
                  (isReached ? 'text-bg-deep' : 'border-line text-text-faint')
                }
                style={
                  isReached
                    ? { background: color, borderColor: color }
                    : undefined
                }
              >
                {isReached && !isCurrent && i < currentIdx ? <CheckIcon width={13} height={13} strokeWidth={3} /> : s.index}
                {isCurrent && (
                  <span className="absolute inset-0 animate-pulse-soft rounded-full" style={{ boxShadow: `0 0 0 4px ${stageColorSoft(s.id)}` }} />
                )}
              </span>
              <span className="min-w-0">
                <span className={'block truncate text-[12.5px] font-medium ' + (isReached ? 'text-text' : 'text-text-faint')}>{s.title}</span>
                {isCurrent && s.id === 'loop' && loop.iterations.length > 0 && (
                  <span className="mono tabular block text-[10.5px] text-text-muted">
                    step {loop.step}
                    {loop.stopped ? ' · stopped' : ''}
                  </span>
                )}
              </span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
