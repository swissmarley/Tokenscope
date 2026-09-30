import { AnimatePresence, motion } from 'framer-motion';
import { useShallow } from 'zustand/shallow';
import { springs, tween } from '../../design/motion';
import { useStore } from '../../store/useStore';
import { IconButton } from '../common/IconButton';
import { CloseIcon } from '../common/Icons';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium text-text">{label}</span>
      {hint && <span className="ml-2 text-[11px] text-text-faint">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputCls =
  'mono h-9 w-full rounded-lg border border-line bg-surface px-3 text-[12.5px] text-text focus:border-phase-input/60 focus:outline-none';

export function SettingsModal() {
  const { open, setOpen, settings, setSettings, proxyUrl, setProxyUrl, cameraFollow, setCameraFollow, soundOn, setSoundOn } =
    useStore(
      useShallow((s) => ({
        open: s.settingsOpen,
        setOpen: s.setSettingsOpen,
        settings: s.settings,
        setSettings: s.setSettings,
        proxyUrl: s.proxyUrl,
        setProxyUrl: s.setProxyUrl,
        cameraFollow: s.cameraFollow,
        setCameraFollow: s.setCameraFollow,
        soundOn: s.soundOn,
        setSoundOn: s.setSoundOn,
      })),
    );
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-bg-deep/70 p-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={tween(0.2)}
          onClick={() => setOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={springs.snappy}
            className="panel w-full max-w-lg"
          >
            <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
              <h2 className="text-[15px] font-semibold tracking-tight">Settings</h2>
              <IconButton label="Close" size="sm" className="ml-auto" onClick={() => setOpen(false)}>
                <CloseIcon width={15} height={15} />
              </IconButton>
            </div>
            <div className="grid gap-4 px-5 py-4">
              <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] text-text-muted">
                The API key is never entered here. Put it in <span className="mono text-text">server/.env</span>; the
                browser only ever talks to the proxy below.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Model" hint="sent as model">
                  <input className={inputCls} value={settings.model} onChange={(e) => setSettings({ model: e.target.value })} />
                </Field>
                <Field label="Proxy URL" hint="/api in dev">
                  <input className={inputCls} value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)} />
                </Field>
              </div>
              <Field label="System prompt">
                <textarea
                  className={inputCls + ' h-20 resize-none py-2'}
                  value={settings.systemPrompt}
                  onChange={(e) => setSettings({ systemPrompt: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-4 gap-3">
                <Field label="max_tokens">
                  <input
                    type="number"
                    min={1}
                    max={4096}
                    className={inputCls}
                    value={settings.maxTokens}
                    onChange={(e) => setSettings({ maxTokens: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </Field>
                <Field label="temperature">
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.05}
                    className={inputCls}
                    value={settings.temperature}
                    onChange={(e) => setSettings({ temperature: Math.min(2, Math.max(0, Number(e.target.value) || 0)) })}
                  />
                </Field>
                <Field label="top_k">
                  <input
                    type="number"
                    min={0}
                    max={500}
                    className={inputCls}
                    value={settings.topK}
                    onChange={(e) => setSettings({ topK: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </Field>
                <Field label="top_p">
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    className={inputCls}
                    value={settings.topP}
                    onChange={(e) => setSettings({ topP: Math.min(1, Math.max(0, Number(e.target.value) || 0)) })}
                  />
                </Field>
              </div>
              <div className="flex gap-6 text-[12.5px]">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={cameraFollow} onChange={(e) => setCameraFollow(e.target.checked)} />
                  Camera follows the pipeline
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={soundOn} onChange={(e) => setSoundOn(e.target.checked)} />
                  Sound cues
                </label>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
