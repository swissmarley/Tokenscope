import { useStore } from '../store/useStore';
import { useEventProgress } from './useEventProgress';

/** Progress (0 → 1) through the hold of whatever event the cursor is on. */
export function useCurrentProgress(): number {
  const cursor = useStore((s) => s.transport.cursor);
  return useEventProgress(cursor >= 0 ? cursor : null);
}
