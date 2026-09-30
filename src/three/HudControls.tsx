import { useShallow } from 'zustand/shallow';
import { useStore } from '../store/useStore';

/** Contextual controls for the 3-D sets that have knobs. */
export function HudControls({ stage }: { stage: string }) {
  if (stage === 'attention') return <AttentionControls />;
  if (stage === 'sample') return <SamplingControls />;
  return null;
}

function AttentionControls() {
  const { attention, attnLayer, attnHead, setAttn } = useStore(
    useShallow((s) => ({ attention: s.view.attention, attnLayer: s.attnLayer, attnHead: s.attnHead, setAttn: s.setAttn })),
  );
  const step = attention.latest?.step ?? 0;
  const layer = attnLayer ?? attention.latest?.layer ?? 0;
  const ev = attention.byKey[`${step}:${layer}`];
  const nLayers = attention.nLayers || 12;
  const kind = ev?.headKinds?.[attnHead];
  return (
    <div className="glass pointer-events-auto absolute right-4 bottom-4 w-[300px] rounded-2xl border border-line p-3 shadow-panel">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Layer</span>
        {attnLayer !== null && (
          <button type="button" onClick={() => setAttn({ layer: null })} className="text-[11px] text-phase-model underline decoration-dotted underline-offset-2">
            follow pipeline
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-0.5">
        {Array.from({ length: nLayers }, (_, l) => (
          <button
            key={l}
            type="button"
            disabled={!attention.byKey[`${step}:${l}`]}
            onClick={() => setAttn({ layer: l })}
            className={'mono h-6 w-6 rounded text-[10.5px] disabled:opacity-30 ' + (layer === l ? 'bg-phase-model text-bg-deep' : 'bg-surface-2 text-text-muted hover:text-text')}
          >
            {l + 1}
          </button>
        ))}
      </div>
      <div className="mt-2 mb-1.5 text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Head</div>
      <div className="flex flex-wrap gap-0.5">
        {Array.from({ length: ev?.nHeads ?? 12 }, (_, h) => (
          <button key={h} type="button" onClick={() => setAttn({ head: h })} className={'mono h-6 w-6 rounded text-[10.5px] ' + (attnHead === h ? 'bg-phase-model text-bg-deep' : 'bg-surface-2 text-text-muted hover:text-text')}>
            {h + 1}
          </button>
        ))}
      </div>
      {kind && <div className="mono mt-2 rounded-md border border-dashed border-warn/50 bg-warn/10 px-2 py-0.5 text-[10.5px] text-warn">illustrative pattern: {kind}</div>}
    </div>
  );
}

function SamplingControls() {
  const { it, override, setOverride } = useStore(
    useShallow((s) => ({ it: s.view.loop.iterations[s.view.loop.step] ?? null, override: s.samplingOverride, setOverride: s.setSamplingOverride })),
  );
  const ev = it?.logits;
  if (!ev) return null;
  const params = override ?? { temperature: ev.temperature, topK: ev.topK, topP: ev.topP };
  const sliders = [
    { key: 'temperature', label: 'temperature', min: 0.05, max: 2, step: 0.05, fmt: (v: number) => v.toFixed(2) },
    { key: 'topK', label: 'top-k', min: 0, max: ev.candidates.length, step: 1, fmt: (v: number) => (v === 0 ? 'off' : String(v)) },
    { key: 'topP', label: 'top-p', min: 0.05, max: 1, step: 0.01, fmt: (v: number) => (v >= 1 ? 'off' : v.toFixed(2)) },
  ] as const;
  return (
    <div className="glass pointer-events-auto absolute right-4 bottom-4 w-[280px] rounded-2xl border border-line p-3 shadow-panel">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Reshape the distribution</span>
        {override && (
          <button type="button" onClick={() => setOverride(null)} className="text-[11px] text-phase-model underline decoration-dotted underline-offset-2">
            reset
          </button>
        )}
      </div>
      {sliders.map((s) => (
        <label key={s.key} className="mb-1.5 block">
          <div className="mono flex justify-between text-[11px]">
            <span className="text-text-muted">{s.label}</span>
            <span className="text-text">{s.fmt(params[s.key])}</span>
          </div>
          <input type="range" min={s.min} max={s.max} step={s.step} value={params[s.key]} onChange={(e) => setOverride({ ...params, [s.key]: Number(e.target.value) })} className="w-full" />
        </label>
      ))}
      <div className="text-[10.5px] text-text-faint">The bars and the roll track reshape live; the cyan bar is where the same roll would land.</div>
    </div>
  );
}
