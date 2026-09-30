import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { HEX, withAlpha } from '../../../design/colors';
import { springs } from '../../../design/motion';
import { useCanvas } from '../../../hooks/useCanvas';
import { useCurrentProgress } from '../../../hooks/useCurrentProgress';
import { easeOut, window01 } from '../../../hooks/useEventProgress';
import { entropyBits, sampleDistribution, sampleIndex, softmax } from '../../../math/softmax';
import type { EventOf } from '../../../pipeline/events';
import { tailLogitFor } from '../../../sim/logits';
import { hashString } from '../../../sim/prng';
import { useStore } from '../../../store/useStore';
import { displayText } from '../../common/TokenChip';
import type { Scene } from './index';
import { SceneNote, Stat, SummaryRow } from './shared';

// ─── Vocabulary spectrum: 50k logits, spikes where the candidates sit ───────

function Spectrum({ ev, p }: { ev: EventOf<'logits'>; p: number }) {
  const ref = useCanvas(
    (ctx, w, h) => {
      const base = h - 14;
      const V = ev.vocabSize;
      // Deterministic low-level noise for the ~50k uninteresting entries.
      const cols = Math.floor(w);
      // √ scale: common (low-id) tokens get room, the long tail compresses.
      const xOf = (id: number): number => Math.sqrt(id / V) * w;
      ctx.fillStyle = withAlpha(HEX.model, 0.28);
      for (let x = 0; x < cols; x++) {
        const id = Math.floor(Math.pow(x / cols, 2) * V);
        const nz = (hashString(`spec:${id}`) % 1000) / 1000;
        const hh = 2 + nz * 10 * p;
        ctx.fillRect(x, base - hh, 1, hh);
      }
      const maxL = Math.max(...ev.candidates.map((c) => c.logit));
      const minL = Math.min(...ev.candidates.map((c) => c.logit)) - 2;
      ev.candidates.forEach((c, i) => {
        const x = xOf(c.token.id);
        const hh = 12 + ((c.logit - minL) / Math.max(1e-6, maxL - minL)) * (base - 26) * easeOut(Math.min(1, Math.max(0, p * 2 - i * 0.05)));
        ctx.strokeStyle = i === 0 ? HEX.output : HEX.model;
        ctx.lineWidth = i === 0 ? 2 : 1.2;
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.lineTo(x, base - hh);
        ctx.stroke();
        if (i < 5) {
          ctx.fillStyle = i === 0 ? HEX.output : HEX.textMuted;
          ctx.font = '9.5px "JetBrains Mono", monospace';
          ctx.fillText(displayText(c.token.text), Math.min(w - 40, x + 3), base - hh - 2);
        }
      });
      ctx.fillStyle = HEX.textFaint;
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillText('id 0', 2, h - 3);
      ctx.textAlign = 'right';
      ctx.fillText(`id ${(V - 1).toLocaleString()}`, w - 2, h - 3);
      ctx.textAlign = 'left';
    },
    [ev, p],
  );
  return <canvas ref={ref} className="h-[84px] w-full" role="img" aria-label="Logits across the whole vocabulary" />;
}

// ─── Bars ───────────────────────────────────────────────────────────────────

interface Row {
  key: string;
  label: string;
  id: number | null;
  logit: number;
  prob: number;
  /** After top-k / top-p filtering. */
  kept: boolean;
  isTail: boolean;
}

function Bars({
  rows,
  mode,
  chosenKey,
  wouldKey,
  reveal,
}: {
  rows: Row[];
  mode: 'logits' | 'probs';
  chosenKey: string | null;
  wouldKey: string | null;
  reveal: number;
}) {
  const maxProb = Math.max(1e-6, ...rows.map((r) => r.prob));
  const logits = rows.filter((r) => !r.isTail).map((r) => r.logit);
  const minL = Math.min(...logits);
  const maxL = Math.max(...logits);
  return (
    <div className="mono space-y-[3px] text-[11.5px]">
      {rows.map((r, i) => {
        const frac = mode === 'logits' ? (r.isTail ? 0 : (r.logit - minL + 0.5) / Math.max(1e-6, maxL - minL + 0.5)) : r.prob / maxProb;
        const shown = i < reveal * rows.length + 0.5;
        const chosen = r.key === chosenKey;
        const would = r.key === wouldKey && !chosen;
        const color = chosen ? HEX.output : r.isTail ? HEX.textFaint : would ? HEX.input : HEX.model;
        return (
          <motion.div layout key={r.key} transition={springs.snappy} className="flex items-center gap-2">
            <span className={'w-24 truncate text-right whitespace-pre ' + (chosen ? 'text-phase-output' : r.kept ? 'text-text' : 'text-text-faint line-through')}>
              {r.label}
            </span>
            <div className="relative h-4 flex-1 overflow-hidden rounded-sm bg-surface-2/60">
              <motion.div
                initial={false}
                animate={{ width: shown ? `${Math.max(0.5, frac * 100)}%` : '0%', opacity: r.kept ? 1 : 0.3 }}
                transition={springs.snappy}
                className="h-full rounded-sm"
                style={{
                  background: r.kept ? withAlpha(color, chosen ? 1 : 0.8) : `repeating-linear-gradient(135deg, ${withAlpha(color, 0.5)} 0 3px, transparent 3px 6px)`,
                  boxShadow: chosen ? `0 0 14px ${withAlpha(HEX.output, 0.6)}` : undefined,
                }}
              />
            </div>
            <span className={'w-16 text-right tabular ' + (chosen ? 'text-phase-output' : 'text-text-muted')}>
              {mode === 'logits' ? (r.isTail ? '…' : r.logit.toFixed(2)) : `${(r.prob * 100).toFixed(r.prob < 0.01 ? 2 : 1)}%`}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

// ─── Cumulative strip + needle (the dice roll) ──────────────────────────────

function Roll({ rows, u, sweep, chosenKey }: { rows: Row[]; u: number; sweep: number; chosenKey: string | null }) {
  let acc = 0;
  const segs = rows.map((r) => {
    const s = { key: r.key, from: acc, to: acc + r.prob, label: r.label, chosen: r.key === chosenKey, tail: r.isTail };
    acc += r.prob;
    return s;
  });
  const needle = easeOut(sweep) * u;
  return (
    <div className="mono">
      <div className="mb-1 flex justify-between text-[10.5px] text-text-faint">
        <span>0</span>
        <span>u ~ Uniform[0, 1) → {(u).toFixed(4)}</span>
        <span>1</span>
      </div>
      <div className="relative h-7 w-full overflow-hidden rounded-md border border-line bg-surface-2">
        {segs.map((s) => (
          <div
            key={s.key}
            className="absolute inset-y-0"
            style={{
              left: `${s.from * 100}%`,
              width: `${(s.to - s.from) * 100}%`,
              background: s.chosen ? withAlpha(HEX.output, 0.85) : s.tail ? withAlpha(HEX.textFaint, 0.3) : withAlpha(HEX.model, 0.35 + 0.4 * ((s.to - s.from) / Math.max(1e-6, segs[0]?.to ?? 1))),
              borderRight: `1px solid ${HEX.bgDeep}`,
            }}
            title={`${s.label}: ${(s.from * 100).toFixed(1)}–${(s.to * 100).toFixed(1)}%`}
          >
            {s.to - s.from > 0.07 && (
              <span className="absolute inset-0 flex items-center justify-center truncate px-1 text-[10px] whitespace-pre text-bg-deep">{s.label}</span>
            )}
          </div>
        ))}
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-text shadow-[0_0_8px_rgb(255_255_255/0.8)]"
          style={{ left: `calc(${needle * 100}% - 1px)` }}
        />
      </div>
    </div>
  );
}

// ─── Scene ──────────────────────────────────────────────────────────────────

function useIteration() {
  return useStore((s) => s.view.loop.iterations[s.view.loop.step] ?? null);
}

function Summary() {
  const it = useIteration();
  const top = it?.logits?.candidates[0];
  return (
    <SummaryRow>
      <Stat label="top" value={top ? `“${displayText(top.token.text)}” ${(top.prob * 100).toFixed(1)}%` : '–'} />
      <Stat label="chosen" value={it?.sampled ? `“${displayText(it.sampled.token.text)}” (rank ${it.sampled.rank + 1})` : '–'} />
    </SummaryRow>
  );
}

function Body() {
  const { it, lastEvent, level } = useStore(
    useShallow((s) => ({ it: s.view.loop.iterations[s.view.loop.step] ?? null, lastEvent: s.view.lastEvent, level: s.explainLevel })),
  );
  const p = useCurrentProgress();
  const ev = it?.logits ?? null;
  const sampled = it?.sampled ?? null;
  const [params, setParams] = useState({ temperature: 1, topK: 0, topP: 1 });
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (ev && !touched) setParams({ temperature: ev.temperature, topK: ev.topK, topP: ev.topP });
  }, [ev, touched]);

  const onLogits = lastEvent?.type === 'logits';
  const onSampled = lastEvent?.type === 'sampled';
  const logitsP = onLogits ? p : 1;
  const mode: 'logits' | 'probs' = onLogits && p < 0.4 ? 'logits' : 'probs';
  const reveal = onLogits ? easeOut(window01(p, 0, 0.35)) : 1;
  const sweep = onSampled ? window01(p, 0.05, 0.7) : sampled ? 1 : 0;
  const showChosen = sampled !== null && (!onSampled || p > 0.7);

  const rows = useMemo<Row[]>(() => {
    if (!ev) return [];
    const tailLogit = tailLogitFor(ev.candidates, ev.tailMass, ev.temperature);
    const logits = [...ev.candidates.map((c) => c.logit), tailLogit];
    // Top-k over a list where the tail stands for ~50k entries: any k ≤ candidates drops the tail.
    const k = params.topK > 0 && params.topK <= ev.candidates.length ? params.topK : 0;
    const dist = sampleDistribution(logits, { temperature: params.temperature, topK: k, topP: params.topP });
    const soft = softmax(logits, params.temperature);
    return logits.map((l, i) => {
      const c = ev.candidates[i];
      const isTail = i === ev.candidates.length;
      return {
        key: isTail ? 'tail' : `c${c?.token.id ?? i}`,
        label: isTail ? `other ${(ev.vocabSize - ev.candidates.length).toLocaleString()}` : displayText(c?.token.text ?? ''),
        id: c?.token.id ?? null,
        logit: l,
        prob: (dist[i] ?? 0) > 0 ? (dist[i] ?? 0) : 0,
        kept: (dist[i] ?? 0) > 0,
        isTail,
      };
    }).map((r, i) => ({ ...r, prob: r.kept ? r.prob : 0, softProb: soft[i] ?? 0 }));
  }, [ev, params]);

  if (!ev) return <SceneNote>Waiting for the first prediction…</SceneNote>;

  const chosenKey = sampled ? `c${sampled.token.id}` : null;
  const u = sampled?.roll ?? 0;
  const wouldIdx = rows.length ? sampleIndex(rows.map((r) => r.prob), u) : -1;
  const wouldKey = wouldIdx >= 0 ? (rows[wouldIdx]?.key ?? null) : null;
  const differs = touched && wouldKey !== null && wouldKey !== chosenKey;
  const H = entropyBits(rows.map((r) => r.prob));
  const runH = entropyBits(ev.candidates.map((c) => c.prob).concat(ev.tailMass));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-bg-deep/60 p-3">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">
            h<sub>L</sub> · W<sub>U</sub>ᵀ → one score per vocabulary entry
          </span>
          <span className="mono text-[10.5px] text-text-faint">{ev.vocabSize.toLocaleString()} logits · top {ev.candidates.length} shown below</span>
        </div>
        <Spectrum ev={ev} p={logitsP} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-xl border border-line bg-bg-deep/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">
              {mode === 'logits' ? 'Raw logits' : 'Probabilities after softmax'}
            </span>
            <AnimatePresence mode="wait">
              <motion.span key={mode} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="mono text-[10.5px] text-text-faint">
                {mode === 'logits' ? 'scores can be negative' : `entropy ${H.toFixed(2)} bits`}
              </motion.span>
            </AnimatePresence>
          </div>
          <Bars rows={rows} mode={mode} chosenKey={showChosen ? chosenKey : null} wouldKey={differs ? wouldKey : null} reveal={reveal} />
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-line bg-surface-2/60 p-3">
            <div className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Reshape the distribution</div>
            {(
              [
                { key: 'temperature', label: 'temperature', min: 0.05, max: 2, step: 0.05, fmt: (v: number) => v.toFixed(2) },
                { key: 'topK', label: 'top-k', min: 0, max: ev.candidates.length, step: 1, fmt: (v: number) => (v === 0 ? 'off' : String(v)) },
                { key: 'topP', label: 'top-p', min: 0.05, max: 1, step: 0.01, fmt: (v: number) => (v >= 1 ? 'off' : v.toFixed(2)) },
              ] as const
            ).map((s) => (
              <label key={s.key} className="mb-2 block">
                <div className="mono flex justify-between text-[11px]">
                  <span className="text-text-muted">{s.label}</span>
                  <span className="text-text">{s.fmt(params[s.key])}</span>
                </div>
                <input
                  type="range"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={params[s.key]}
                  onChange={(e) => {
                    setTouched(true);
                    setParams((prev) => ({ ...prev, [s.key]: Number(e.target.value) }));
                  }}
                  className="w-full"
                />
              </label>
            ))}
            <div className="flex items-center justify-between">
              <span className="mono text-[10.5px] text-text-faint">
                run: T={ev.temperature} k={ev.topK} p={ev.topP} · H={runH.toFixed(2)} bits
              </span>
              {touched && (
                <button
                  type="button"
                  onClick={() => {
                    setTouched(false);
                    setParams({ temperature: ev.temperature, topK: ev.topK, topP: ev.topP });
                  }}
                  className="text-[11px] text-phase-model underline decoration-dotted underline-offset-2"
                >
                  reset to run
                </button>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-line bg-bg-deep/60 p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">The dice roll</span>
              {sampled && showChosen && (
                <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={springs.snappy} className="mono rounded-md bg-phase-output/20 px-2 py-0.5 text-[11px] text-phase-output">
                  chose “{displayText(sampled.token.text)}” · rank {sampled.rank + 1} · {(sampled.prob * 100).toFixed(1)}%
                </motion.span>
              )}
            </div>
            <Roll rows={rows} u={u} sweep={sweep} chosenKey={showChosen ? chosenKey : null} />
            <AnimatePresence>
              {differs && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-2 text-[11.5px] text-phase-input">
                  With these settings the same roll would have picked “{rows[wouldIdx]?.label}” instead.
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <SceneNote>
        {level === 'math'
          ? `p_i = exp(z_i/T) / Σ_j exp(z_j/T); then zero everything outside the top-k and outside the smallest set with cumulative mass ≥ p, renormalise, and draw u ~ U[0,1). Lower T sharpens (T→0 is argmax), higher T flattens; entropy is the tidy summary.`
          : 'Temperature stretches or squashes the scores before they become probabilities; top-k and top-p cut off the long tail. Then a single random number decides. The model does not “pick the best word” — it rolls dice loaded by its own predictions. Drag the sliders to see how the same roll could land elsewhere.'}
      </SceneNote>
    </div>
  );
}

export const Sampling: Scene = { Summary, Body };
