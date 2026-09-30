import { motion } from 'framer-motion';
import { useShallow } from 'zustand/shallow';
import { HEX, withAlpha } from '../../../design/colors';
import { springs } from '../../../design/motion';
import { useCurrentProgress } from '../../../hooks/useCurrentProgress';
import { easeOut } from '../../../hooks/useEventProgress';
import type { LayerPhase } from '../../../pipeline/derive';
import { scheduler, useStore } from '../../../store/useStore';
import type { Scene } from './index';
import { SceneNote, Stat, SummaryRow } from './shared';

// ─── The stack: a tower of identical blocks, data beam climbing through ─────

function Tower({
  nLayers,
  current,
  completed,
  phase,
  p,
  onPick,
}: {
  nLayers: number;
  current: number | null;
  completed: number;
  phase: LayerPhase;
  p: number;
  onPick: (layer: number) => void;
}) {
  const W = 230;
  const H = 380;
  const bottom = H - 22;
  const bh = Math.min(26, (bottom - 30) / Math.max(1, nLayers));
  const blockW = 140;
  const x0 = 62;
  const yOf = (i: number): number => bottom - (i + 1) * bh;
  const activeIdx = current !== null && phase !== 'done' ? current : null;
  // Beam head position: climbs through the active block over its attention (first half) and FFN (second half).
  const sub = phase === 'attention' ? p * 0.5 : phase === 'ffn' ? 0.5 + p * 0.5 : 1;
  const beamTop =
    activeIdx === null
      ? completed > 0
        ? yOf(completed - 1)
        : bottom
      : yOf(activeIdx) + bh - bh * easeOut(sub);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[230px]" role="img" aria-label={`Stack of ${nLayers} transformer blocks`}>
      <defs>
        <linearGradient id="beam" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={HEX.model} />
          <stop offset="1" stopColor={HEX.input} stopOpacity="0.25" />
        </linearGradient>
        <filter id="glow-model" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* residual stream */}
      <line x1={x0 - 22} x2={x0 - 22} y1={bottom + 8} y2={yOf(nLayers - 1) - 10} stroke={HEX.lineStrong} strokeWidth={3} strokeLinecap="round" />
      <line x1={x0 - 22} x2={x0 - 22} y1={bottom + 8} y2={beamTop} stroke="url(#beam)" strokeWidth={3} strokeLinecap="round" />
      {(activeIdx !== null || completed > 0) && (
        <circle cx={x0 - 22} cy={beamTop} r={5} fill={HEX.model} filter="url(#glow-model)" />
      )}
      <text x={x0 - 22} y={bottom + 20} textAnchor="middle" fontSize={9} fill={HEX.textFaint} fontFamily="Inter Variable, Inter, sans-serif">
        x
      </text>
      <text x={x0 - 22} y={yOf(nLayers - 1) - 16} textAnchor="middle" fontSize={9} fill={HEX.textFaint} fontFamily="Inter Variable, Inter, sans-serif">
        h_L
      </text>
      {Array.from({ length: nLayers }, (_, i) => {
        const y = yOf(i);
        const done = i < completed && i !== activeIdx;
        const active = i === activeIdx;
        const fill = active ? withAlpha(HEX.model, 0.55) : done ? withAlpha(HEX.model, 0.22) : HEX.surface2;
        const stroke = active ? HEX.model : done ? withAlpha(HEX.model, 0.6) : HEX.lineStrong;
        return (
          <g key={i} onClick={() => onPick(i)} className="cursor-pointer" transform={active ? `translate(6, 0)` : undefined}>
            {/* side face for depth */}
            <polygon points={`${x0 + blockW},${y + 2} ${x0 + blockW + 10},${y - 4} ${x0 + blockW + 10},${y + bh - 6} ${x0 + blockW},${y + bh - 1}`} fill={withAlpha(stroke, 0.35)} />
            <polygon points={`${x0},${y + 2} ${x0 + 10},${y - 4} ${x0 + blockW + 10},${y - 4} ${x0 + blockW},${y + 2}`} fill={withAlpha(stroke, 0.5)} />
            <rect x={x0} y={y + 2} width={blockW} height={bh - 3} rx={3} fill={fill} stroke={stroke} strokeWidth={active ? 1.5 : 1} filter={active ? 'url(#glow-model)' : undefined} />
            <text x={x0 + 8} y={y + bh / 2 + 4} fontSize={10} fontFamily="JetBrains Mono, monospace" fill={active || done ? HEX.text : HEX.textFaint}>
              L{i + 1}
            </text>
            {active && (
              <text x={x0 + blockW - 8} y={y + bh / 2 + 4} fontSize={9} textAnchor="end" fontFamily="JetBrains Mono, monospace" fill={HEX.text}>
                {phase === 'attention' ? 'attn' : phase === 'ffn' ? 'ffn' : ''}
              </text>
            )}
            {done && (
              <circle cx={x0 + blockW - 10} cy={y + bh / 2 + 0.5} r={2.5} fill={HEX.model} />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Inside one block ───────────────────────────────────────────────────────

function BlockAnatomy({
  phase,
  p,
  sample,
  sparsity,
  residualNorm,
  nHeads,
  seqLen,
  hiddenDim,
  layer,
  active,
}: {
  phase: LayerPhase;
  p: number;
  sample: number[] | null;
  sparsity: number | null;
  residualNorm: number | null;
  nHeads: number;
  seqLen: number;
  hiddenDim: number;
  layer: number | null;
  active: boolean;
}) {
  const W = 560;
  const H = 330;
  const cx = 300;
  // vertical positions, bottom → top
  const yIn = 300;
  const yLN1 = 262;
  const yAttn = 208;
  const yAdd1 = 158;
  const yLN2 = 126;
  const yFfn = 74;
  const yAdd2 = 30;
  const yOut = 10;
  const attnOn = phase === 'attention';
  const ffnOn = phase === 'ffn';
  const doneOn = phase === 'done';
  const flowColor = HEX.model;
  const bypassX = 440;

  // pulse position along the main path for the active phase
  const pulseY = attnOn ? yIn - easeOut(p) * (yIn - yAdd1) : ffnOn ? yAdd1 - easeOut(p) * (yAdd1 - yAdd2) : doneOn ? yAdd2 - p * (yAdd2 - yOut) : null;

  const box = (y: number, label: string, on: boolean, h = 30, w = 150, sub?: string): React.ReactNode => (
    <g>
      <rect x={cx - w / 2} y={y - h / 2} width={w} height={h} rx={6} fill={on ? withAlpha(flowColor, 0.28) : HEX.surface2} stroke={on ? flowColor : HEX.lineStrong} strokeWidth={on ? 1.5 : 1} filter={on ? 'url(#glow-model)' : undefined} />
      <text x={cx} y={y + (sub ? -1 : 4)} textAnchor="middle" fontSize={11} fontWeight={600} fontFamily="Inter Variable, Inter, sans-serif" fill={on ? HEX.text : HEX.textMuted}>
        {label}
      </text>
      {sub && (
        <text x={cx} y={y + 11} textAnchor="middle" fontSize={9} fontFamily="JetBrains Mono, monospace" fill={on ? HEX.text : HEX.textFaint}>
          {sub}
        </text>
      )}
    </g>
  );
  const plus = (y: number, on: boolean): React.ReactNode => (
    <g>
      <circle cx={cx} cy={y} r={9} fill={on ? withAlpha(flowColor, 0.35) : HEX.surface2} stroke={on ? flowColor : HEX.lineStrong} strokeWidth={1.5} filter={on ? 'url(#glow-model)' : undefined} />
      <text x={cx} y={y + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={on ? HEX.text : HEX.textMuted} fontFamily="Inter Variable, Inter, sans-serif">
        +
      </text>
    </g>
  );
  const bypass = (yFrom: number, yTo: number, on: boolean): React.ReactNode => {
    const d = `M ${cx} ${yFrom} C ${bypassX} ${yFrom}, ${bypassX} ${yTo}, ${cx + 9} ${yTo}`;
    return (
      <>
        <path d={d} fill="none" stroke={HEX.lineStrong} strokeWidth={2} />
        {on && <path d={d} fill="none" stroke={HEX.input} strokeWidth={2} strokeDasharray="4 6" className="animate-flow" filter="url(#glow-input)" />}
      </>
    );
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Anatomy of one transformer block">
      <defs>
        <filter id="glow-input" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* main path */}
      <line x1={cx} x2={cx} y1={yIn} y2={yOut} stroke={HEX.lineStrong} strokeWidth={2} />
      {active && (
        <line x1={cx} x2={cx} y1={yIn} y2={pulseY ?? yIn} stroke={flowColor} strokeWidth={2} strokeDasharray="4 6" className="animate-flow" />
      )}
      {/* residual bypasses */}
      {bypass(yIn - 14, yAdd1, attnOn)}
      {bypass(yAdd1 - 12, yAdd2, ffnOn)}
      <text x={bypassX + 8} y={(yIn + yAdd1) / 2 + 4} fontSize={9.5} fill={attnOn ? HEX.input : HEX.textFaint} fontFamily="Inter Variable, Inter, sans-serif">
        residual
      </text>
      <text x={bypassX + 8} y={(yAdd1 + yAdd2) / 2 + 4} fontSize={9.5} fill={ffnOn ? HEX.input : HEX.textFaint} fontFamily="Inter Variable, Inter, sans-serif">
        residual
      </text>

      {box(yLN1, 'LayerNorm', attnOn, 22, 110)}
      {box(yAttn, 'Multi-head attention', attnOn, 40, 190, `${nHeads} heads · ${seqLen} tokens`)}
      {plus(yAdd1, attnOn && p > 0.85)}
      {box(yLN2, 'LayerNorm', ffnOn, 22, 110)}
      {box(yFfn, 'Feed-forward network', ffnOn, 44, 190, `${hiddenDim.toLocaleString()} hidden · GELU`)}
      {plus(yAdd2, ffnOn && p > 0.85)}

      {/* attention heads flicker */}
      {Array.from({ length: nHeads }, (_, h) => (
        <rect
          key={h}
          x={cx - 90 + h * 15.5}
          y={yAttn + 25}
          width={12}
          height={3}
          rx={1}
          fill={attnOn ? withAlpha(HEX.model, 0.35 + 0.65 * Math.max(0, Math.sin(p * 9 + h))) : HEX.line}
        />
      ))}

      {/* FFN activations: mostly zeros */}
      {sample && (
        <g transform={`translate(${cx - 95 - 175}, ${yFfn - 20})`}>
          {sample.map((v, i) => {
            const h = Math.min(38, v * 14);
            const lit = ffnOn ? i < p * sample.length : true;
            return <rect key={i} x={i * 5} y={38 - h} width={3.5} height={Math.max(1, h)} rx={1} fill={v === 0 ? HEX.line : lit ? HEX.model : HEX.lineStrong} />;
          })}
          <text x={0} y={50} fontSize={9} fontFamily="JetBrains Mono, monospace" fill={HEX.textFaint}>
            {sparsity !== null ? `${Math.round(sparsity * 100)}% of units silent` : ''}
          </text>
        </g>
      )}

      {/* pulse */}
      {pulseY !== null && active && <circle cx={cx} cy={pulseY} r={5} fill={flowColor} filter="url(#glow-model)" />}

      {/* labels */}
      <text x={cx + 14} y={yIn + 4} fontSize={10} fontFamily="JetBrains Mono, monospace" fill={HEX.textMuted}>
        {layer !== null ? `h[${layer}]` : 'x'} in
      </text>
      <text x={cx + 14} y={yOut + 8} fontSize={10} fontFamily="JetBrains Mono, monospace" fill={doneOn ? HEX.text : HEX.textMuted}>
        {layer !== null ? `h[${layer + 1}]` : 'out'}
        {residualNorm !== null && doneOn ? `  ‖·‖≈${residualNorm.toFixed(1)}` : ''}
      </text>
    </svg>
  );
}

// ─── Scene ──────────────────────────────────────────────────────────────────

function Summary() {
  const l = useStore((s) => s.view.layers);
  return (
    <SummaryRow>
      <Stat label="blocks" value={l.nLayers || '–'} />
      <Stat label="completed" value={`${l.completed} / ${l.nLayers}`} />
      <Stat label="phase" value={l.phase} />
    </SummaryRow>
  );
}

function Body() {
  const { layers, attention, level, lastEvent, step } = useStore(
    useShallow((s) => ({
      layers: s.view.layers,
      attention: s.view.attention,
      level: s.explainLevel,
      lastEvent: s.view.lastEvent,
      step: s.view.loop.step,
    })),
  );
  const p = useCurrentProgress();
  const activeHere = lastEvent !== null && (lastEvent.type === 'layer_start' || lastEvent.type === 'ffn' || lastEvent.type === 'layer_end');
  const cur = layers.current;
  const ffn = cur !== null ? (layers.ffnByLayer[cur] ?? null) : null;
  const norm = cur !== null ? (layers.residualNorms[cur] ?? null) : null;
  const pick = (layer: number): void => {
    const i = scheduler.events.findIndex((e) => e.type === 'layer_start' && e.layer === layer && e.step === step);
    if (i >= 0) {
      scheduler.pause();
      scheduler.seekEvent(i);
    }
  };
  const dModel = attention.nHeads * attention.dHead || 768;
  const paramsPerBlock = 12 * dModel * dModel;

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h4 className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">The stack</h4>
          <span className="mono text-[10.5px] text-text-faint">click a block to jump</span>
        </div>
        <Tower nLayers={layers.nLayers} current={cur} completed={layers.completed} phase={layers.phase} p={activeHere ? p : 1} onPick={pick} />
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">
            Inside block {cur !== null ? cur + 1 : '–'}
            {step > 0 ? ` · decode step ${step}` : ' · prefill'}
          </h4>
          <motion.span
            key={layers.phase + String(cur)}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springs.snappy}
            className="mono rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-text"
          >
            {layers.phase === 'attention' ? 'tokens exchange information' : layers.phase === 'ffn' ? 'each token thinks alone' : layers.phase === 'done' ? 'block output on the residual stream' : 'waiting'}
          </motion.span>
        </div>
        <BlockAnatomy
          phase={layers.phase}
          p={activeHere ? p : 1}
          sample={ffn?.sample ?? null}
          sparsity={ffn?.activationSparsity ?? null}
          residualNorm={norm}
          nHeads={attention.nHeads || 12}
          seqLen={layers.seqLen}
          hiddenDim={ffn?.hiddenDim ?? 3072}
          layer={cur}
          active={activeHere}
        />
        <div className="flex flex-wrap gap-2">
          <Stat label="d_model" value={dModel} />
          <Stat label="params / block" value={`≈${(paramsPerBlock / 1e6).toFixed(1)} M`} />
          <Stat label="tokens in flight" value={layers.seqLen} />
          {norm !== null && <Stat label="‖residual‖" value={norm.toFixed(2)} />}
        </div>
        <SceneNote>
          {level === 'math'
            ? 'h ← h + Attn(LN(h)); h ← h + FFN(LN(h)). Every block has the same shape and its own weights; the “+” is the residual connection, so each block only learns a correction to the stream.'
            : 'Every block does the same two moves: attention lets tokens look at each other, then the feed-forward network lets each token process what it gathered. The glowing bypass lines carry the input straight through, so a block only needs to learn what to add.'}
        </SceneNote>
      </div>
    </div>
  );
}

export const Layers: Scene = { Summary, Body };
