import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { springs } from '../../design/motion';
import { useStore } from '../../store/useStore';
import { Kbd } from '../common/Badge';

interface Step {
  target: string;
  title: string;
  body: React.ReactNode;
  placement: 'top' | 'bottom' | 'right' | 'left';
}

const STEPS: Step[] = [
  {
    target: 'prompt',
    title: 'Ask the model something',
    body: 'Type a message or pick an example — each one shows off a different behaviour: an ambiguous pronoun, a rare word, arithmetic, a one-word greeting. Then press Send.',
    placement: 'bottom',
  },
  {
    target: 'mode',
    title: 'Three sources of truth',
    body: (
      <>
        <b>Mock</b> replays a canned run — no key, no download. <b>Live API</b> streams a real reply through your own proxy. <b>Lab model</b> runs a small open model locally and exposes its real attention and logits. Dashed borders and an amber badge always mark data that is illustrative rather than measured.
      </>
    ),
    placement: 'bottom',
  },
  {
    target: 'rail',
    title: 'Nine stages, one journey',
    body: 'The pipeline runs top to bottom: input, model internals, output. The camera follows it; click any reached stage to jump the timeline there.',
    placement: 'right',
  },
  {
    target: 'transport',
    title: 'Slow-motion controls',
    body: (
      <>
        <Kbd>Space</Kbd> play/pause · <Kbd>←</Kbd> <Kbd>→</Kbd> step one event · <Kbd>Shift</Kbd>+arrows step a stage · <Kbd>[</Kbd> <Kbd>]</Kbd> speed. Drag the timeline to scrub. “Pause at each stage” turns it into a guided walk.
      </>
    ),
    placement: 'top',
  },
  {
    target: 'inspector',
    title: 'Look under the hood',
    body: (
      <>
        The Inspector (<Kbd>I</Kbd>) explains what is happening in plain language, adds a “go deeper” paragraph, and shows the raw event JSON for anything you click.
      </>
    ),
    placement: 'bottom',
  },
  {
    target: 'explain',
    title: 'Pick your depth',
    body: '“I’m new” keeps annotations plain; “Math” swaps in the formulas and tensor shapes. Switch any time — and every run is saved locally, so you can replay it from the history menu.',
    placement: 'bottom',
  },
];

const CARD_W = 360;

function useTargetRect(target: string, step: number): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
    const update = (): void => setRect(el ? el.getBoundingClientRect() : null);
    update();
    window.addEventListener('resize', update);
    const id = setInterval(update, 400); // layout shifts while the run plays
    return () => {
      window.removeEventListener('resize', update);
      clearInterval(id);
    };
  }, [target, step]);
  return rect;
}

export function Tour() {
  const { step, setStep } = useStore(useShallow((s) => ({ step: s.tourStep, setStep: s.setTourStep })));
  const current = step !== null ? STEPS[step] : undefined;
  const rect = useTargetRect(current?.target ?? '', step ?? -1);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setStep(null);
      if (e.key === 'Enter') setStep(step + 1 < STEPS.length ? step + 1 : null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, setStep]);

  if (step === null || !current) return null;
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampLeft = (x: number): number => Math.max(12, Math.min(vw - CARD_W - 12, x));
  let card: React.CSSProperties = { top: vh / 2 - 90, left: vw / 2 - CARD_W / 2, width: CARD_W };
  if (rect) {
    const cx = rect.left + rect.width / 2;
    if (current.placement === 'bottom') card = { top: Math.min(vh - 240, rect.bottom + 14), left: clampLeft(cx - CARD_W / 2), width: CARD_W };
    else if (current.placement === 'top') card = { bottom: Math.min(vh - 40, vh - rect.top + 14), left: clampLeft(cx - CARD_W / 2), width: CARD_W };
    else if (current.placement === 'right') card = { top: Math.max(12, Math.min(vh - 240, rect.top)), left: clampLeft(rect.right + 14), width: CARD_W };
    else card = { top: Math.max(12, Math.min(vh - 240, rect.top)), left: clampLeft(rect.left - 14 - CARD_W), width: CARD_W };
  }
  const spot = rect
    ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : { top: vh / 2, left: vw / 2, width: 0, height: 0 };
  const last = step === STEPS.length - 1;

  return (
    <AnimatePresence>
      <motion.div key="tour" className="fixed inset-0 z-[60]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        {/* spotlight: the box-shadow is the dimmed backdrop, the hole is the target */}
        <motion.div
          initial={false}
          animate={spot}
          transition={springs.snappy}
          className="pointer-events-none absolute rounded-xl"
          style={{ boxShadow: '0 0 0 9999px rgb(6 9 18 / 0.72), 0 0 0 2px var(--color-phase-input), 0 0 32px rgb(34 211 238 / 0.35)' }}
        />
        <div className="absolute inset-0" onClick={() => setStep(null)} aria-hidden />
        <motion.div
          key={step}
          role="dialog"
          aria-label={`Tour step ${step + 1} of ${STEPS.length}`}
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={springs.snappy}
          className="panel absolute p-4"
          style={card}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1 flex items-center justify-between text-[10.5px] tracking-[0.12em] text-text-faint uppercase">
            <span>Guided tour</span>
            <span className="mono">
              {step + 1} / {STEPS.length}
            </span>
          </div>
          <h3 className="text-[15px] font-semibold tracking-tight">{current.title}</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">{current.body}</p>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex gap-1">
              {STEPS.map((_, i) => (
                <span key={i} className={'h-1.5 w-1.5 rounded-full ' + (i === step ? 'bg-phase-input' : i < step ? 'bg-phase-input/40' : 'bg-line-strong')} />
              ))}
            </div>
            <button type="button" onClick={() => setStep(null)} className="ml-auto text-[12px] text-text-muted hover:text-text">
              Skip
            </button>
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} className="rounded-md border border-line px-2.5 py-1 text-[12px] text-text-muted hover:text-text">
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => setStep(last ? null : step + 1)}
              className="rounded-md bg-phase-input px-3 py-1 text-[12px] font-semibold text-bg-deep hover:brightness-110"
            >
              {last ? 'Start exploring' : 'Next'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
