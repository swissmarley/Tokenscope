import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { useShallow } from 'zustand/shallow';
import { springs } from '../../design/motion';
import { useStore } from '../../store/useStore';
import { CloseIcon } from '../common/Icons';

export function Notices() {
  const { notice, error, dismiss } = useStore(
    useShallow((s) => ({ notice: s.notice, error: s.error, dismiss: s.dismissNotice })),
  );
  const msg = error ?? notice;
  useEffect(() => {
    if (!notice || error) return;
    const id = setTimeout(dismiss, 6000);
    return () => clearTimeout(id);
  }, [notice, error, dismiss]);
  return (
    <AnimatePresence>
      {msg && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={springs.snappy}
          className={
            'glass fixed bottom-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border px-4 py-2.5 text-[13px] shadow-panel ' +
            (error ? 'border-danger/50 text-danger' : 'border-line text-text')
          }
        >
          {msg}
          <button type="button" onClick={dismiss} aria-label="Dismiss" className="text-text-muted hover:text-text">
            <CloseIcon width={14} height={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
