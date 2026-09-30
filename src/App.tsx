import { useEffect } from 'react';
import { useKeyboard } from './hooks/useKeyboard';
import { useSoundCues } from './hooks/useSoundCues';
import { STAGE_BY_ID } from './pipeline/stages';
import { useStore } from './store/useStore';
import { Inspector } from './components/layout/Inspector';
import { Notices } from './components/layout/Notices';
import { ProgressRail } from './components/layout/ProgressRail';
import { SettingsModal } from './components/layout/SettingsModal';
import { TopBar } from './components/layout/TopBar';
import { Tour } from './components/layout/Tour';
import { TransportBar } from './components/layout/TransportBar';
import { Journey } from './components/stages/Journey';

function LiveRegion() {
  const stage = useStore((s) => s.view.currentStage);
  const meta = stage ? STAGE_BY_ID[stage] : null;
  return (
    <div aria-live="polite" className="sr-only">
      {meta ? `Stage ${meta.index}: ${meta.title}` : ''}
    </div>
  );
}

export default function App() {
  useKeyboard();
  useSoundCues();

  // First load: run the canned Mock example so the app is never empty.
  useEffect(() => {
    const s = useStore.getState();
    if (s.transport.eventCount === 0) void s.send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-bg text-text">
      <TopBar />
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[236px_minmax(0,1fr)_auto]">
        <ProgressRail />
        <Journey />
        <Inspector />
      </div>
      <TransportBar />
      <LiveRegion />
      <Notices />
      <SettingsModal />
      <Tour />
    </div>
  );
}
