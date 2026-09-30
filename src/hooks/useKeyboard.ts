import { useEffect } from 'react';
import { useStore } from '../store/useStore';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Space play/pause · ←/→ step event · Shift+←/→ step stage · [ ] speed ·
 * I inspector · Esc close.
 */
export function useKeyboard(): void {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      const s = useStore.getState();
      if (ev.key === 'Escape') {
        if (s.settingsOpen) s.setSettingsOpen(false);
        else if (s.cinematic) s.stopCinematic();
        else if (s.inspectorOpen) s.toggleInspector(false);
        return;
      }
      if (isTyping(ev.target) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      switch (ev.key) {
        case ' ':
          ev.preventDefault();
          s.toggle();
          break;
        case 'ArrowRight':
          ev.preventDefault();
          if (ev.shiftKey) s.stepStage(1);
          else s.stepEvent(1);
          break;
        case 'ArrowLeft':
          ev.preventDefault();
          if (ev.shiftKey) s.stepStage(-1);
          else s.stepEvent(-1);
          break;
        case '[':
          s.bumpSpeed(-1);
          break;
        case ']':
          s.bumpSpeed(1);
          break;
        case 'i':
        case 'I':
          s.toggleInspector();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
