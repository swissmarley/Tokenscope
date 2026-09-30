import { animate, useMotionValue, useTransform, motion } from 'framer-motion';
import { useEffect } from 'react';

/** A number that rolls to its new value instead of snapping. */
export function Odometer({ value, className = '', digits = 0 }: { value: number; className?: string; digits?: number }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }));
  useEffect(() => {
    const controls = animate(mv, value, { type: 'spring', stiffness: 120, damping: 24, mass: 0.8 });
    return () => controls.stop();
  }, [value, mv]);
  return <motion.span className={'tabular ' + className}>{text}</motion.span>;
}
