import { AnimatePresence, motion } from 'framer-motion';
import { useShallow } from 'zustand/shallow';
import { SCENES } from '../components/stages/scenes';
import { FidelityBadge } from '../components/common/Badge';
import { explainEvent } from '../content/explain';
import { springs } from '../design/motion';
import { STAGE_BY_ID, stageColor } from '../pipeline/stages';
import { useStore } from '../store/useStore';
import { HudControls } from './HudControls';

/** DOM overlay on the 3-D stage: where we are, what just happened, key numbers. */
export function Hud() {
  const { stage, lastEvent, view, fidelity, level } = useStore(
    useShallow((s) => ({
      stage: s.focusedStage ?? s.view.currentStage,
      lastEvent: s.view.lastEvent,
      view: s.view,
      fidelity: s.view.currentStage ? s.view.stageFidelity[s.view.currentStage] : null,
      level: s.explainLevel,
    })),
  );
  if (!stage) return null;
  const meta = STAGE_BY_ID[stage];
  const Summary = SCENES[stage].Summary;
  const ex = lastEvent ? explainEvent(lastEvent, view) : null;
  const color = stageColor(stage);

  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute top-3 left-4 text-[10.5px] tracking-[0.12em] text-text-faint uppercase">drag to orbit · scroll to zoom</div>
      <AnimatePresence mode="wait">
        <motion.div
          key={stage}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={springs.snappy}
          className="glass pointer-events-auto absolute bottom-4 left-4 w-[420px] rounded-2xl border border-line p-4 shadow-panel"
          style={{ borderColor: `color-mix(in srgb, ${color} 45%, transparent)` }}
        >
          <div className="flex items-center gap-2">
            <span className="mono grid h-8 w-8 place-items-center rounded-lg text-[14px] font-bold" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}>
              {meta.index}
            </span>
            <span className="text-[16px] font-semibold tracking-tight">{meta.title}</span>
            {fidelity && (
              <span className="ml-auto">
                <FidelityBadge fidelity={fidelity} />
              </span>
            )}
          </div>
          <AnimatePresence mode="wait">
            {ex && (
              <motion.p
                key={lastEvent?.seq}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className={'mt-2 text-[12.5px] leading-relaxed text-text-muted ' + (level === 'math' ? 'mono' : '')}
              >
                <span className="font-medium text-text">{ex.title}. </span>
                {(level === 'math' ? ex.math : ex.simple).split(/(?<=\.)\s/)[0]}
              </motion.p>
            )}
          </AnimatePresence>
          <div className="mt-2.5">
            <Summary />
          </div>
        </motion.div>
      </AnimatePresence>
      <HudControls stage={stage} />
    </div>
  );
}
