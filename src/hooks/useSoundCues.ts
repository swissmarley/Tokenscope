import { useEffect } from 'react';
import { playCue } from '../audio/cues';
import { useStore } from '../store/useStore';

/** Plays cues on stage changes and streamed tokens when sound is enabled. */
export function useSoundCues(): void {
  useEffect(() => {
    const unsubStage = useStore.subscribe(
      (s) => s.view.currentStage,
      (stage, prev) => {
        if (!stage || stage === prev) return;
        if (useStore.getState().soundOn) playCue('stage');
      },
    );
    const unsubEvent = useStore.subscribe(
      (s) => s.view.lastEvent,
      (e, prev) => {
        if (!e || e === prev || !useStore.getState().soundOn) return;
        if (e.type === 'token_streamed') playCue('token');
        else if (e.type === 'done') playCue('done');
      },
    );
    return () => {
      unsubStage();
      unsubEvent();
    };
  }, []);
}
