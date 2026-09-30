import { useEffect, useRef } from 'react';
import { LayoutGroup, useReducedMotion } from 'framer-motion';
import { useShallow } from 'zustand/shallow';
import { STAGES, stageIndex } from '../../pipeline/stages';
import { useStore } from '../../store/useStore';
import { Welcome } from '../layout/Welcome';
import { StageFrame, type StageStatus } from './StageFrame';
import { SCENES } from './scenes';

/** The vertical journey: nine stage scenes, camera follows the pipeline. */
export function Journey() {
  const { currentStage, reached, stageFidelity, focusedStage, setFocusedStage, cameraFollow, eventCount } = useStore(
    useShallow((s) => ({
      currentStage: s.view.currentStage,
      reached: s.view.reached,
      stageFidelity: s.view.stageFidelity,
      focusedStage: s.focusedStage,
      setFocusedStage: s.setFocusedStage,
      cameraFollow: s.cameraFollow,
      eventCount: s.transport.eventCount,
    })),
  );
  const reduced = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const cameraTarget = focusedStage ?? currentStage;

  // Camera: track the target section's top while neighbouring stages collapse/expand,
  // so the scroll settles on the section rather than where it *was* when the move began.
  useEffect(() => {
    if (!cameraFollow || !cameraTarget) return;
    const container = scrollRef.current;
    const el = document.getElementById(`stage-${cameraTarget}`);
    if (!container || !el) return;
    const margin = 24;
    if (reduced) {
      container.scrollTop = el.offsetTop - margin;
      const late = setTimeout(() => {
        container.scrollTop = el.offsetTop - margin;
      }, 500);
      return () => clearTimeout(late);
    }
    let frame = 0;
    const start = performance.now();
    const DURATION = 1100;
    const step = (now: number): void => {
      const target = el.offsetTop - margin;
      const maxTop = container.scrollHeight - container.clientHeight;
      const clamped = Math.max(0, Math.min(maxTop, target));
      container.scrollTop += (clamped - container.scrollTop) * 0.16;
      if (now - start < DURATION || Math.abs(clamped - container.scrollTop) > 1) {
        if (now - start < DURATION + 600) frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [cameraTarget, cameraFollow, reduced]);

  const currentIdx = currentStage ? stageIndex(currentStage) : -1;

  return (
    <div ref={scrollRef} className="grid-bg relative min-h-0 overflow-y-auto">
      {eventCount === 0 && (
        <div className="px-4 py-8 lg:px-8">
          <Welcome />
        </div>
      )}
      <LayoutGroup>
      <div className={'mx-auto flex max-w-[1180px] flex-col gap-4 px-4 py-6 pb-[40vh] lg:px-8 ' + (eventCount === 0 ? 'opacity-40' : '')}>
        {STAGES.map((s, i) => {
          const status: StageStatus =
            s.id === currentStage ? 'active' : reached[s.id] && i < currentIdx ? 'done' : reached[s.id] ? 'done' : 'upcoming';
          const expanded = focusedStage ? focusedStage === s.id : status === 'active';
          const Scene = SCENES[s.id];
          return (
            <StageFrame
              key={s.id}
              stage={s}
              status={status}
              expanded={expanded}
              dimmed={cameraTarget !== null && cameraTarget !== s.id}
              fidelity={stageFidelity[s.id]}
              onToggle={() => setFocusedStage(focusedStage === s.id ? null : status === 'active' ? null : s.id)}
              summary={<Scene.Summary />}
            >
              <Scene.Body />
            </StageFrame>
          );
        })}
      </div>
      </LayoutGroup>
    </div>
  );
}
