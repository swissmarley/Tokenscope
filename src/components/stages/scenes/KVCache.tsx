import { motion } from 'framer-motion';
import { useShallow } from 'zustand/shallow';
import { HEX, withAlpha } from '../../../design/colors';
import { springs } from '../../../design/motion';
import { useCanvas } from '../../../hooks/useCanvas';
import { useCurrentProgress } from '../../../hooks/useCurrentProgress';
import { easeOut } from '../../../hooks/useEventProgress';
import type { EventOf } from '../../../pipeline/events';
import { useStore } from '../../../store/useStore';
import { Odometer } from '../../common/Odometer';
import type { Scene } from './index';
import { SceneNote, Stat, SummaryRow } from './shared';

// ─── The cache grid: layers × positions, each cell a K tile over a V tile ───

function CacheGrid({
  nLayers,
  perLayer,
  maxPositions,
  latest,
  p,
  isCurrent,
  promptLen,
}: {
  nLayers: number;
  perLayer: Record<number, number>;
  maxPositions: number;
  latest: EventOf<'kv_cache_update'> | null;
  p: number;
  isCurrent: boolean;
  promptLen: number;
}) {
  const ref = useCanvas(
    (ctx, w, h) => {
      const labelW = 34;
      const top = 18;
      const cols = Math.max(maxPositions, promptLen, 1);
      const cell = Math.max(4, Math.min(18, Math.floor((w - labelW) / cols)));
      const rowH = Math.max(6, Math.min(22, Math.floor((h - top - 4) / Math.max(1, nLayers))));
      const tileH = Math.max(2, (rowH - 4) / 2);
      ctx.font = '9px "JetBrains Mono", monospace';
      // position ruler
      ctx.fillStyle = HEX.textFaint;
      for (let c = 0; c < cols; c += Math.max(1, Math.round(cols / 12))) {
        ctx.fillText(String(c), labelW + c * cell + 1, 10);
      }
      // prefill / decode boundary
      if (cols > promptLen) {
        const x = labelW + promptLen * cell - 0.5;
        ctx.strokeStyle = withAlpha(HEX.output, 0.6);
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, top - 4);
        ctx.lineTo(x, h - 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = HEX.output;
        ctx.fillText('decode →', x + 3, top - 6);
      }
      for (let l = 0; l < nLayers; l++) {
        const y = top + l * rowH;
        ctx.fillStyle = HEX.textFaint;
        ctx.fillText(`L${l + 1}`, 2, y + rowH / 2 + 3);
        const filled = perLayer[l] ?? 0;
        const isLatestLayer = isCurrent && latest?.layer === l;
        for (let c = 0; c < cols; c++) {
          const x = labelW + c * cell;
          let scale = 1;
          let on = c < filled;
          if (isLatestLayer && latest) {
            const idx = latest.positions.indexOf(c);
            if (idx >= 0) {
              // tiles flip in left → right over the event's hold
              const local = Math.min(1, Math.max(0, p * (latest.positions.length + 2) - idx));
              scale = easeOut(local);
              on = local > 0;
            }
          }
          if (!on) {
            ctx.fillStyle = withAlpha(HEX.surface2, 0.8);
            ctx.fillRect(x, y + 1, cell - 1, rowH - 3);
            continue;
          }
          const cw = (cell - 1) * scale;
          const ox = x + ((cell - 1) - cw) / 2;
          const decode = c >= promptLen;
          ctx.fillStyle = decode ? withAlpha(HEX.output, 0.85) : HEX.model;
          ctx.fillRect(ox, y + 1, cw, tileH);
          ctx.fillStyle = decode ? withAlpha(HEX.output, 0.5) : withAlpha(HEX.input, 0.8);
          ctx.fillRect(ox, y + 2 + tileH, cw, tileH);
        }
      }
      // legend
      ctx.fillStyle = HEX.model;
      ctx.fillRect(w - 92, h - 10, 8, 4);
      ctx.fillStyle = withAlpha(HEX.input, 0.8);
      ctx.fillRect(w - 92, h - 5, 8, 4);
      ctx.fillStyle = HEX.textFaint;
      ctx.fillText('K over V', w - 80, h - 3);
    },
    [nLayers, perLayer, maxPositions, latest, p, isCurrent, promptLen],
  );
  return <canvas ref={ref} className="h-[290px] w-full" role="img" aria-label="KV cache grid: layers by positions" />;
}

// ─── Prefill vs decode diagrams ─────────────────────────────────────────────

function PhaseDiagram({ mode, active, n }: { mode: 'prefill' | 'decode'; active: boolean; n: number }) {
  const W = 250;
  const H = 120;
  const count = Math.min(n, 9);
  const xs = Array.from({ length: count }, (_, i) => 22 + (i * (W - 44)) / Math.max(1, count - 1));
  const stroke = active ? (mode === 'prefill' ? HEX.model : HEX.output) : HEX.lineStrong;
  return (
    <div className={'rounded-xl border p-3 transition-colors ' + (active ? 'border-line-strong bg-surface-2/60' : 'border-line bg-bg-deep/40')}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className={'text-[11px] font-semibold tracking-[0.1em] uppercase ' + (active ? 'text-text' : 'text-text-faint')}>{mode}</span>
        <span className="mono text-[10px] text-text-faint">{mode === 'prefill' ? `${n} tokens in parallel` : '1 token per step'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-hidden>
        {/* cache bar */}
        <rect x={16} y={16} width={W - 32} height={18} rx={4} fill={withAlpha(HEX.model, active ? 0.2 : 0.08)} stroke={stroke} />
        <text x={W / 2} y={28} textAnchor="middle" fontSize={9.5} fill={active ? HEX.text : HEX.textFaint} fontFamily="JetBrains Mono, monospace">
          K / V cache
        </text>
        {xs.map((x, i) => {
          const isNew = mode === 'decode' ? i === count - 1 : true;
          const c = isNew ? stroke : withAlpha(HEX.textFaint, 0.6);
          return (
            <g key={i}>
              <circle cx={x} cy={90} r={7} fill={withAlpha(c, isNew ? 0.3 : 0.1)} stroke={c} strokeWidth={1.2} />
              {mode === 'prefill' ? (
                <line x1={x} y1={82} x2={x} y2={36} stroke={c} strokeWidth={1.5} strokeDasharray={active ? '3 4' : undefined} className={active ? 'animate-flow' : undefined} markerEnd="url(#arrow)" />
              ) : isNew ? (
                <>
                  <line x1={x} y1={82} x2={x} y2={36} stroke={c} strokeWidth={1.5} strokeDasharray={active ? '3 4' : undefined} className={active ? 'animate-flow' : undefined} />
                  {xs.slice(0, -1).map((x2, j) => (
                    <path key={j} d={`M ${x2} 36 C ${x2} 60, ${x} 60, ${x} 80`} fill="none" stroke={withAlpha(HEX.input, active ? 0.55 : 0.2)} strokeWidth={1} />
                  ))}
                </>
              ) : null}
            </g>
          );
        })}
        <text x={W / 2} y={112} textAnchor="middle" fontSize={9.5} fill={active ? HEX.textMuted : HEX.textFaint} fontFamily="Inter Variable, Inter, sans-serif">
          {mode === 'prefill' ? 'every token writes its K, V at once' : 'new token writes once, reads all cached K, V'}
        </text>
      </svg>
    </div>
  );
}

// ─── Scene ──────────────────────────────────────────────────────────────────

function Summary() {
  const k = useStore((s) => s.view.kv);
  return (
    <SummaryRow>
      <Stat label="cached positions" value={k.cachedTokens} />
      <Stat label="layers" value={Object.keys(k.perLayer).length} />
      <Stat label="computations saved" value={k.computeSaved.toLocaleString()} />
    </SummaryRow>
  );
}

function Body() {
  const { kv, promptLen, dModel, lastEvent, level } = useStore(
    useShallow((s) => ({
      kv: s.view.kv,
      promptLen: s.view.tokens?.tokens.length ?? 0,
      dModel: (s.view.attention.nHeads * s.view.attention.dHead) || 768,
      lastEvent: s.view.lastEvent,
      level: s.explainLevel,
    })),
  );
  const p = useCurrentProgress();
  const isCurrent = lastEvent?.type === 'kv_cache_update';
  const maxPositions = Math.max(0, ...Object.values(kv.perLayer));
  const phase = kv.latest?.phase ?? 'prefill';
  const bytes = kv.nLayers * kv.cachedTokens * 2 * dModel * 2; // fp16 K and V
  const nSteps = Math.max(0, kv.cachedTokens - promptLen);
  const wouldRecompute = nSteps > 0 ? ((promptLen + promptLen + nSteps - 1) * nSteps) / 2 * 2 * kv.nLayers : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h4 className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Cache · {kv.nLayers} layers × {kv.cachedTokens} positions</h4>
          <span className="mono text-[10.5px] text-text-faint">{(bytes / 1024).toFixed(0)} KB at fp16</span>
        </div>
        <div className="rounded-xl border border-line bg-bg-deep/60 p-2">
          <CacheGrid nLayers={kv.nLayers} perLayer={kv.perLayer} maxPositions={maxPositions} latest={kv.latest} p={p} isCurrent={isCurrent} promptLen={promptLen} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <PhaseDiagram mode="prefill" active={phase === 'prefill'} n={promptLen} />
          <PhaseDiagram mode="decode" active={phase === 'decode'} n={kv.cachedTokens} />
        </div>
      </div>
      <div className="space-y-3">
        <motion.div layout className="rounded-xl border border-line bg-surface-2/60 p-4">
          <div className="text-[10.5px] tracking-[0.12em] text-text-faint uppercase">K/V projections skipped thanks to the cache</div>
          <div className="mono mt-1 text-[34px] leading-none font-medium text-text">
            <Odometer value={kv.computeSaved} />
          </div>
          <div className="mt-2 text-[11.5px] leading-relaxed text-text-muted">
            {nSteps === 0
              ? 'Nothing saved yet: prefill computes every key and value once and stores them.'
              : `Without a cache, ${nSteps} decode step${nSteps === 1 ? '' : 's'} would have recomputed ${wouldRecompute.toLocaleString()} projections. With it: ${(nSteps * 2 * kv.nLayers).toLocaleString()}.`}
          </div>
        </motion.div>
        <div className="flex flex-wrap gap-2">
          <Stat label="phase" value={phase} />
          <Stat label="positions" value={`${kv.cachedTokens} (${promptLen} prompt + ${nSteps} generated)`} />
          <Stat label="per position" value={`${(2 * dModel * kv.nLayers).toLocaleString()} numbers`} />
        </div>
        <motion.div
          key={phase}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.soft}
        >
          <SceneNote>
            {level === 'math'
              ? 'Per layer: K = XW_K, V = XW_V for the prompt (prefill, one matmul over all n rows). Each decode step appends k_t, v_t and computes only q_t; cost per step is O(n·d) instead of O(n²·d).'
              : phase === 'prefill'
                ? 'Reading the prompt is one big parallel pass: every token’s keys and values are computed together and parked in the cache. That is why a long prompt costs time before the first token appears.'
                : 'Generating is different: only the newest token does any work. It computes its own query, then reads everyone else’s keys and values straight out of the cache. The cache is why each new token costs about the same no matter how long the context has grown — until memory runs out.'}
          </SceneNote>
        </motion.div>
      </div>
    </div>
  );
}

export const KVCache: Scene = { Summary, Body };
