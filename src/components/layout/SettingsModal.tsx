import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
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

function ConnectionSection() {
  const { conn, setConn, proxyUrl, setProxyUrl } = useStore(
    useShallow((s) => ({ conn: s.connection, setConn: s.setConnection, proxyUrl: s.proxyUrl, setProxyUrl: s.setProxyUrl })),
  );
  const [showKey, setShowKey] = useState(false);
  const direct = conn.mode === 'direct';
  return (
    <div className="rounded-lg border border-line bg-surface-2/60 p-3">
      <div className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Connection</div>
      <div role="radiogroup" aria-label="Connection mode" className="mb-3 grid grid-cols-2 gap-2">
        {(
          [
            { id: 'proxy', label: 'Through the proxy', hint: 'Key lives in server/.env. Best for local dev.' },
            { id: 'direct', label: 'Direct from this browser', hint: 'Your key stays in this browser. Works on static hosting.' },
          ] as const
        ).map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={conn.mode === o.id}
            onClick={() => setConn({ mode: o.id })}
            className={'rounded-lg border p-2.5 text-left ' + (conn.mode === o.id ? 'border-phase-input/70 bg-phase-input/10' : 'border-line hover:border-line-strong')}
          >
            <div className="text-[12.5px] font-medium text-text">{o.label}</div>
            <div className="mt-0.5 text-[11px] text-text-muted">{o.hint}</div>
          </button>
        ))}
      </div>
      {direct ? (
        <div className="grid gap-3">
          <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[11.5px] leading-relaxed text-warn">
            The key is stored only in this browser's localStorage and sent only to the provider you choose. Anyone who can open this browser profile can read it — use a key you can rotate, and never on a shared machine.
          </p>
          <div className="grid grid-cols-[130px_1fr] gap-3">
            <Field label="Provider">
              <select className={inputCls} value={conn.provider} onChange={(e) => setConn({ provider: e.target.value as 'anthropic' | 'openai' })}>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI-compatible</option>
              </select>
            </Field>
            <Field label="API key" hint={conn.provider === 'openai' ? 'optional for local servers' : 'sk-ant-…'}>
              <div className="flex gap-1">
                <input
                  type={showKey ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  className={inputCls}
                  value={conn.apiKey}
                  onChange={(e) => setConn({ apiKey: e.target.value.trim() })}
                  placeholder="paste your key"
                />
                <button type="button" onClick={() => setShowKey((v) => !v)} className="shrink-0 rounded-lg border border-line px-2 text-[11px] text-text-muted hover:text-text">
                  {showKey ? 'hide' : 'show'}
                </button>
                {conn.apiKey && (
                  <button type="button" onClick={() => setConn({ apiKey: '' })} className="shrink-0 rounded-lg border border-danger/40 px-2 text-[11px] text-danger hover:bg-danger/10">
                    forget
                  </button>
                )}
              </div>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Base URL" hint={conn.provider === 'openai' ? 'e.g. http://localhost:11434/v1' : 'leave empty for api.anthropic.com'}>
              <input className={inputCls} value={conn.baseUrl} onChange={(e) => setConn({ baseUrl: e.target.value.trim() })} placeholder="default" />
            </Field>
            <Field label="Lab server URL" hint="python server, called directly">
              <input className={inputCls} value={conn.labUrl} onChange={(e) => setConn({ labUrl: e.target.value.trim() })} />
            </Field>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Proxy URL" hint="/api in dev">
            <input className={inputCls} value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)} />
          </Field>
          <p className="self-end text-[11px] leading-relaxed text-text-muted">
            The browser never sees the key: put it in <span className="mono text-text">server/.env</span> and the proxy adds it.
          </p>
        </div>
      )}
    </div>
  );
}

export function SettingsModal() {
  const { open, setOpen, settings, setSettings, cameraFollow, setCameraFollow, soundOn, setSoundOn } = useStore(
    useShallow((s) => ({
      open: s.settingsOpen,
      setOpen: s.setSettingsOpen,
      settings: s.settings,
      setSettings: s.setSettings,
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
            className="panel w-full max-w-xl"
          >
            <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
              <h2 className="text-[15px] font-semibold tracking-tight">Settings</h2>
              <IconButton label="Close" size="sm" className="ml-auto" onClick={() => setOpen(false)}>
                <CloseIcon width={15} height={15} />
              </IconButton>
            </div>
            <div className="grid max-h-[75vh] gap-4 overflow-y-auto px-5 py-4">
              <ConnectionSection />
              <Field label="Model" hint="sent as model">
                <input className={inputCls} value={settings.model} onChange={(e) => setSettings({ model: e.target.value })} />
              </Field>
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
