import type { Transition, Variants } from 'framer-motion';

/** Shared motion vocabulary. Springs feel physical; use `quick` for micro-interactions. */
export const springs = {
  soft: { type: 'spring', stiffness: 120, damping: 20, mass: 1 } as Transition,
  snappy: { type: 'spring', stiffness: 380, damping: 30, mass: 0.8 } as Transition,
  quick: { type: 'spring', stiffness: 600, damping: 36, mass: 0.6 } as Transition,
  gentle: { type: 'spring', stiffness: 80, damping: 18, mass: 1.2 } as Transition,
};

export const easeOutQuint = [0.22, 1, 0.36, 1] as const;

export const tween = (duration = 0.4): Transition => ({ duration, ease: easeOutQuint });

export const stagger = (index: number, step = 0.035, base = 0): number => base + index * step;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1 },
  exit: { opacity: 0 },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96 },
};
