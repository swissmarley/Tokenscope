import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { HEX, sequentialViolet, withAlpha } from '../../../design/colors';
import { springs } from '../../../design/motion';
import { useCurrentProgress } from '../../../hooks/useCurrentProgress';
import { contextTokens } from '../../../pipeline/context';
import type { Iteration, LoopPhase } from '../../../pipeline/derive';
import type { Token } from '../../../pipeline/events';
import { scheduler, useStore } from '../../../store/useStore';
import { SequenceStrip } from '../../common/SequenceStrip';
import { displayText } from '../../common/TokenChip';
import type { Scene } from './index';
import { SceneNote, Stat, SummaryRow } from './shared';

const NO_TOKENS: Token[] = [];

// ─── The loop diagram ───────────────────────────────────────────────────────

const PHASES: Array<{ id: LoopPhase; label: string; color: string }> = [
  { id: 'layers', label: 'layers', color: HEX.model },
  { id: 'attention', label: 'attention', color: HEX.model },
  { id: 'kv', label: 'KV cache', color: HEX.model },
  { id: 'logits', label: 'logits', color: HEX.model },
  { id: 'sampled', label: 'sample', color: HEX.output },
  { id: 'streamed', label: 'stream', color: HEX.output },
];

function LoopDiagram({
  phase,
  p,
  layersDone,
  nLayers,
  chosen,
  step,
  stopped,
}: {
  phase: LoopPhase;
  p: number;
  layersDone: number;
  nLayers: number;
  chosen: Token | null;
  step: number;
  stopped: boolean;
}) {
  const W = 640;
  const H = 200;
  const phaseIdx = Math.max(0, PHASES.findIndex((x) => x.id === phase));
  // Ring progress: phase index + within-phase progress (layers phase scales by layer count).
  const within = phase === 'layers' || phase === 'attention' || phase === 'kv' ? layersDone / Math.max(1, nLayers) : p;
  const ring = phase === 'idle' ? 0 : (phaseIdx + within) / PHASES.length;
  const cx = 150;
  const cy = 100;
  const R = 62;
  const seqX = 320;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Autoregressive loop">
      <defs>
        <marker id="arrow-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={HEX.output} />
        </marker>
        <filter id="glow-amber" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* the model ring */}
      <circle cx={cx} cy={cy} r={R} fill={withAlpha(HEX.model, 0.06)} stroke={HEX.lineStrong} strokeWidth={10} />
      <circle
        cx={cx}
        cy={cy}
        r={R}
        fill="none"
        stroke={HEX.model}
        strokeWidth={10}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1 1"
        strokeDashoffset={1 - ring}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: 'stroke-dashoffset 120ms linear' }}
      />
      {PHASES.map((ph, i) => {
        const a = -Math.PI / 2 + ((i + 0.5) / PHASES.length) * Math.PI * 2;
        const on = i <= phaseIdx && phase !== 'idle';
        return (
          <text key={ph.id} x={cx + Math.cos(a) * (R + 22)} y={cy + Math.sin(a) * (R + 22) + 3} textAnchor="middle" fontSize={9.5} fill={on ? ph.color : HEX.textFaint} fontFamily="JetBrains Mono, monospace">
            {ph.label}
          </text>
        );
      })}
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={HEX.text} fontFamily="Inter Variable, Inter, sans-serif">
        forward pass
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize={10} fill={HEX.textMuted} fontFamily="JetBrains Mono, monospace">
        {phase === 'layers' || phase === 'attention' || phase === 'kv' ? `layer ${Math.min(nLayers, layersDone + 1)} / ${nLayers}` : phase === 'idle' ? 'waiting' : phase}
      </text>
      <text x={cx} y={cy + 24} textAnchor="middle" fontSize={9.5} fill={HEX.textFaint} fontFamily="JetBrains Mono, monospace">
        step {step}
      </text>

      {/* sampled token exits the ring to the right */}
      <line x1={cx + R + 6} y1={cy} x2={seqX - 14} y2={cy} stroke={HEX.output} strokeWidth={1.5} markerEnd="url(#arrow-amber)" strokeDasharray="4 5" className="animate-flow" opacity={phase === 'sampled' || phase === 'streamed' ? 1 : 0.25} />
      <AnimatePresence>
        {chosen && (phase === 'sampled' || phase === 'streamed') && (
          <motion.g key={`${step}-${chosen.index}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <rect x={seqX} y={cy - 13} width={92} height={26} rx={6} fill={stopped ? withAlpha(HEX.danger, 0.2) : withAlpha(HEX.output, 0.2)} stroke={stopped ? HEX.danger : HEX.output} strokeWidth={1.5} filter="url(#glow-amber)" />
            <text x={seqX + 46} y={cy + 4} textAnchor="middle" fontSize={11} fill={HEX.text} fontFamily="JetBrains Mono, monospace">
              {displayText(chosen.text).slice(0, 12)}
            </text>
          </motion.g>
        )}
      </AnimatePresence>
      {/* feedback arrow: from the sampled slot around the bottom back into the ring's input */}
      <path
        d={`M ${seqX + 46} ${cy + 16} C ${seqX + 46} ${cy + 80}, ${cx - R - 40} ${cy + 80}, ${cx - R - 40} ${cy + 4} L ${cx - R - 12} ${cy + 4}`}
        fill="none"
        stroke={stopped ? HEX.lineStrong : HEX.output}
        strokeWidth={1.5}
        strokeDasharray="4 5"
        className={stopped ? undefined : 'animate-flow'}
        markerEnd={stopped ? undefined : 'url(#arrow-amber)'}
        opacity={phase === 'streamed' ? 1 : 0.35}
      />
      <text x={(seqX + 46 + cx - R - 40) / 2} y={cy + 90} textAnchor="middle" fontSize={10} fill={stopped ? HEX.textFaint : HEX.output} fontFamily="Inter Variable, Inter, sans-serif">
        {stopped ? 'loop closed' : 'append to input, run again'}
      </text>
      {/* stop badge */}
      {stopped && (
        <g transform={`translate(${seqX + 110}, ${cy - 13})`}>
          <rect width={120} height={26} rx={6} fill={withAlpha(HEX.danger, 0.15)} stroke={HEX.danger} />
          <text x={60} y={17} textAnchor="middle" fontSize={11} fill={HEX.danger} fontFamily="JetBrains Mono, monospace">
            stop condition met
          </text>
        </g>
      )}
    </svg>
  );
}

// ─── Iteration strip: one chip per decode step, expandable ──────────────────

function IterationStrip({ iterations, current, expanded, onExpand }: { iterations: Iteration[]; current: number; expanded: number | null; onExpand: (s: number | null) => void }) {
  return (
    <div className="mono flex flex-wrap gap-1">
      {iterations.map((it) => {
        const tok = it.sampled?.token ?? null;
        const isCur = it.step === current;
        const isEos = it.sampled?.isEos ?? false;
        const done = Boolean(it.sampled);
        return (
          <button
            key={it.step}
            type="button"
            onClick={() => onExpand(expanded === it.step ? null : it.step)}
            title={`step ${it.step} · click for detail`}
            className={
              'relative rounded-md border px-1.5 py-0.5 text-[11px] whitespace-pre transition-colors ' +
              (expanded === it.step ? 'ring-2 ring-phase-input/60' : '') +
              (isEos ? ' border-danger/60 bg-danger/15 text-danger' : isCur ? ' border-phase-output bg-phase-output/25 text-text' : done ? ' border-phase-output/40 bg-phase-output/10 text-text' : ' border-line bg-surface-2 text-text-faint')
            }
          >
            {tok ? displayText(tok.text) : `…`}
            {isCur && !done && (
              <span className="absolute -top-1 -right-1 h-2 w-2 animate-pulse-soft rounded-full bg-phase-output" />
            )}
          </button>
        );
      })}
    </div>
  );
}

function IterationDetail({ it, tokens, nHeads }: { it: Iteration; tokens: Token[]; nHeads: number }) {
  const att = useStore((s) => s.view.attention);
  const [head, setHead] = useState(0);
  const lastLayer = Math.max(0, att.nLayers - 1);
  const ev = att.byKey[`${it.step}:${lastLayer}`];
  const row = ev?.heads[head]?.[0] ?? null;
  const cands = it.logits?.candidates.slice(0, 6) ?? [];
  const maxP = cands[0]?.prob ?? 1;
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={springs.soft} className="overflow-hidden">
      <div className="grid gap-3 rounded-lg border border-line bg-bg-deep/60 p-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[10.5px] font-semibold tracking-[0.1em] text-text-muted uppercase">Step {it.step} · top candidates</span>
            {it.sampled && <span className="mono text-[10.5px] text-phase-output">chose “{displayText(it.sampled.token.text)}”</span>}
          </div>
          <div className="mono space-y-[3px] text-[11px]">
            {cands.map((c) => (
              <div key={c.token.id} className="flex items-center gap-2">
                <span className={'w-20 truncate text-right whitespace-pre ' + (it.sampled?.token.id === c.token.id ? 'text-phase-output' : 'text-text-muted')}>{displayText(c.token.text)}</span>
                <div className="h-2.5 flex-1 rounded-sm bg-surface-2">
                  <div className="h-full rounded-sm" style={{ width: `${(c.prob / maxP) * 100}%`, background: it.sampled?.token.id === c.token.id ? HEX.output : HEX.model }} />
                </div>
                <span className="w-12 text-right tabular text-text-faint">{(c.prob * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[10.5px] font-semibold tracking-[0.1em] text-text-muted uppercase">New token's attention · L{lastLayer + 1}</span>
            <span className="flex gap-0.5">
              {Array.from({ length: nHeads }, (_, h) => (
                <button key={h} type="button" onClick={() => setHead(h)} className={'h-4 w-4 rounded text-[9px] ' + (head === h ? 'bg-phase-model text-bg-deep' : 'bg-surface-2 text-text-faint')}>
                  {h + 1}
                </button>
              ))}
            </span>
          </div>
          {row ? (
            <div className="flex flex-wrap gap-[2px]">
              {tokens.map((t, i) => (
                <span key={t.index} className="mono rounded px-1 text-[10px] whitespace-pre" style={{ background: sequentialViolet(Math.pow(row[i] ?? 0, 0.6)), color: (row[i] ?? 0) > 0.35 ? HEX.bgDeep : HEX.textMuted }} title={`${displayText(t.text)} ${(row[i] ?? 0).toFixed(3)}`}>
                  {displayText(t.text)}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-text-faint">attention for this step not reached yet</div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Scene ──────────────────────────────────────────────────────────────────

function Summary() {
  const l = useStore((s) => s.view.loop);
  const nGen = l.iterations.filter((i) => i.sampled && !i.sampled.isEos).length;
  return (
    <SummaryRow>
      <Stat label="step" value={l.step} />
      <Stat label="generated" value={nGen} />
      <Stat label="phase" value={l.phase} />
      {l.stopped && <Stat label="stopped" value="yes" />}
    </SummaryRow>
  );
}

function Body() {
  const { loop, view, nLayers, nHeads, maxTokens, level } = useStore(
    useShallow((s) => ({
      loop: s.view.loop,
      view: s.view,
      nLayers: s.view.layers.nLayers,
      nHeads: s.view.attention.nHeads,
      maxTokens: s.view.runStart?.settings.maxTokens ?? 0,
      level: s.explainLevel,
    })),
  );
  const p = useCurrentProgress();
  const [expanded, setExpanded] = useState<number | null>(null);
  const it = loop.iterations[loop.step] ?? null;
  const prompt = view.tokens?.tokens ?? NO_TOKENS;
  const generated = useMemo(
    () => loop.iterations.filter((x) => x.sampled && !x.sampled.isEos && (x.streamed || x.step < loop.step)).map((x) => x.sampled!.token),
    [loop.iterations, loop.step],
  );
  const chosen = it?.sampled?.token ?? null;
  const expandedIt = expanded !== null ? (loop.iterations[expanded] ?? null) : null;
  const expandedTokens = useMemo(() => (expandedIt ? contextTokens(view, expandedIt.step) : NO_TOKENS), [view, expandedIt]);
  const used = generated.length;
  const eos = loop.iterations.some((x) => x.sampled?.isEos);
  const jumpTo = (step: number): void => {
    const i = scheduler.events.findIndex((e) => e.type === 'logits' && e.step === step);
    if (i >= 0) {
      scheduler.pause();
      scheduler.seekEvent(i);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <div className="rounded-xl border border-line bg-bg-deep/60 p-3">
          <LoopDiagram phase={loop.phase} p={p} layersDone={it?.layersDone ?? 0} nLayers={nLayers} chosen={chosen} step={loop.step} stopped={loop.stopped} />
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-line bg-surface-2/60 p-3">
            <div className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Stop conditions</div>
            <div className="space-y-2 text-[12px]">
              <div className="flex items-center gap-2">
                <span className={'grid h-4 w-4 place-items-center rounded-full border text-[9px] ' + (eos ? 'border-danger bg-danger/20 text-danger' : 'border-line text-text-faint')}>{eos ? '■' : ''}</span>
                <span className={eos ? 'text-text' : 'text-text-muted'}>
                  model samples <span className="mono">&lt;|endoftext|&gt;</span> {eos ? '— it did' : '— not yet'}
                </span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className={'grid h-4 w-4 place-items-center rounded-full border text-[9px] ' + (used >= maxTokens && maxTokens > 0 ? 'border-danger bg-danger/20 text-danger' : 'border-line text-text-faint')} />
                  <span className="text-text-muted">
                    max_tokens reached: <span className="mono text-text">{used} / {maxTokens}</span>
                  </span>
                </div>
                <div className="mt-1 ml-6 h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <motion.div className="h-full bg-phase-output" animate={{ width: `${Math.min(100, (used / Math.max(1, maxTokens)) * 100)}%` }} transition={springs.snappy} />
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Stat label="iterations" value={loop.iterations.length} />
            <Stat label="context length" value={prompt.length + generated.length} />
            <Stat label="per iteration" value={`${nLayers} layers`} />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-bg-deep/60 p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">The growing input</span>
          <span className="mono text-[10.5px] text-text-faint">prompt (cyan) + generated (amber)</span>
        </div>
        <SequenceStrip prompt={prompt} generated={generated} highlightLast />
      </div>

      <div className="rounded-xl border border-line bg-bg-deep/60 p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Iterations · click one to expand</span>
          {expanded !== null && (
            <button type="button" onClick={() => jumpTo(expanded)} className="text-[11px] text-phase-model underline decoration-dotted underline-offset-2">
              jump the timeline to step {expanded}
            </button>
          )}
        </div>
        <IterationStrip iterations={loop.iterations} current={loop.step} expanded={expanded} onExpand={setExpanded} />
        <AnimatePresence>{expandedIt && <div className="mt-3"><IterationDetail it={expandedIt} tokens={expandedTokens} nHeads={nHeads} /></div>}</AnimatePresence>
      </div>

      <SceneNote>
        {level === 'math'
          ? 'x_{t+1} = sample(p_θ(· | x_1..x_t)). Each iteration is one forward pass over the new token only (thanks to the KV cache), then a draw. The loop ends when the EOS token is drawn or max_tokens is hit.'
          : 'This is the whole trick: the model only ever predicts one next token. To write a paragraph it predicts a token, glues it onto the input, and predicts again — dozens of full passes through the network, one per word-piece.'}
      </SceneNote>
    </div>
  );
}

export const Loop: Scene = { Summary, Body };
