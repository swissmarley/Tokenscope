import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { CLASS_COLORS, HEX, sequentialViolet, withAlpha } from '../../../design/colors';
import { springs } from '../../../design/motion';
import { useCanvas } from '../../../hooks/useCanvas';
import { useCurrentProgress } from '../../../hooks/useCurrentProgress';
import { easeOut, window01 } from '../../../hooks/useEventProgress';
import { contextTokens } from '../../../pipeline/context';
import type { EventOf, Token } from '../../../pipeline/events';
import { classify, isPronoun, isReferentCandidate } from '../../../sim/lexicon';
import { useStore } from '../../../store/useStore';
import { displayText } from '../../common/TokenChip';
import type { Scene } from './index';
import { SceneNote, Stat, SummaryRow } from './shared';

// ─── Heatmap ────────────────────────────────────────────────────────────────

interface Cell {
  q: number;
  k: number;
}

function Heatmap({
  tokens,
  rows,
  rowOffset,
  revealed,
  hover,
  onHover,
  showMask,
}: {
  tokens: readonly Token[];
  /** [query][key] */
  rows: number[][];
  /** Index of the first query row (decode rows start at n-1). */
  rowOffset: number;
  revealed: number;
  hover: Cell | null;
  onHover: (c: Cell | null) => void;
  showMask: boolean;
}) {
  const n = tokens.length;
  const labelW = 74;
  const labelH = 56;
  const [geom, setGeom] = useState({ cell: 20, w: 0, h: 0 });
  const ref = useCanvas(
    (ctx, w, h) => {
      const cell = Math.max(8, Math.min(26, Math.floor((w - labelW) / Math.max(1, n))));
      setGeom((g) => (g.cell === cell && g.w === w && g.h === h ? g : { cell, w, h }));
      ctx.font = '10px "JetBrains Mono", monospace';
      // key labels (columns), rotated
      for (let k = 0; k < n; k++) {
        const t = tokens[k];
        if (!t) continue;
        const x = labelW + k * cell + cell / 2;
        const hot = hover && (hover.k === k || hover.q === k);
        ctx.save();
        ctx.translate(x + 3, labelH - 6);
        ctx.rotate(-Math.PI / 3);
        ctx.fillStyle = hot ? HEX.text : HEX.textMuted;
        ctx.fillText(displayText(t.text).slice(0, 9), 0, 0);
        ctx.restore();
      }
      // grid
      for (let r = 0; r < rows.length; r++) {
        const q = rowOffset + r;
        const row = rows[r] ?? [];
        const y = labelH + r * cell;
        const t = tokens[q];
        const visible = r < revealed;
        // query label
        ctx.fillStyle = hover && hover.q === q ? HEX.text : visible ? HEX.textMuted : HEX.textFaint;
        ctx.textAlign = 'right';
        ctx.fillText(t ? displayText(t.text).slice(0, 9) : '', labelW - 6, y + cell / 2 + 3.5);
        ctx.textAlign = 'left';
        for (let k = 0; k < n; k++) {
          const x = labelW + k * cell;
          const masked = k > q;
          if (masked) {
            if (showMask) {
              ctx.fillStyle = withAlpha(HEX.surface2, 0.6);
              ctx.fillRect(x, y, cell - 1, cell - 1);
              ctx.strokeStyle = withAlpha(HEX.lineStrong, 0.7);
              ctx.beginPath();
              ctx.moveTo(x, y + cell - 1);
              ctx.lineTo(x + cell - 1, y);
              ctx.stroke();
            }
            continue;
          }
          const v = visible ? (row[k] ?? 0) : 0;
          ctx.fillStyle = visible ? sequentialViolet(Math.pow(v, 0.6)) : HEX.surface;
          ctx.fillRect(x, y, cell - 1, cell - 1);
        }
        if (hover && hover.q === q) {
          ctx.strokeStyle = withAlpha(HEX.text, 0.5);
          ctx.strokeRect(labelW - 0.5, y - 0.5, n * cell, cell);
        }
      }
      if (hover) {
        const r = hover.q - rowOffset;
        if (r >= 0 && r < rows.length) {
          ctx.strokeStyle = HEX.text;
          ctx.lineWidth = 2;
          ctx.strokeRect(labelW + hover.k * cell - 1, labelH + r * cell - 1, cell + 1, cell + 1);
          ctx.lineWidth = 1;
        }
        ctx.strokeStyle = withAlpha(HEX.text, 0.35);
        ctx.strokeRect(labelW + hover.k * cell - 0.5, labelH - 0.5, cell, rows.length * cell);
      }
    },
    [tokens, rows, rowOffset, revealed, hover, showMask, n],
  );
  const height = labelH + rows.length * geom.cell + 6;
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - labelW;
    const y = e.clientY - rect.top - labelH;
    const k = Math.floor(x / geom.cell);
    const r = Math.floor(y / geom.cell);
    if (k < 0 || k >= n || r < 0 || r >= rows.length) return onHover(null);
    onHover({ q: rowOffset + r, k });
  };
  return (
    <canvas
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={() => onHover(null)}
      className="w-full cursor-crosshair"
      style={{ height }}
      role="img"
      aria-label="Attention weights: rows are query tokens, columns are key tokens"
    />
  );
}

// ─── Arc diagram ────────────────────────────────────────────────────────────

function Arcs({
  tokens,
  rows,
  rowOffset,
  focusQ,
  onHover,
  revealed,
}: {
  tokens: readonly Token[];
  rows: number[][];
  rowOffset: number;
  focusQ: number | null;
  onHover: (i: number | null) => void;
  revealed: number;
}) {
  const n = tokens.length;
  const W = Math.max(560, n * 46);
  const H = 190;
  const base = H - 38;
  const xAt = (i: number): number => 24 + (i * (W - 48)) / Math.max(1, n - 1);
  const arcs: Array<{ q: number; k: number; w: number }> = [];
  for (let r = 0; r < Math.min(rows.length, revealed); r++) {
    const q = rowOffset + r;
    const row = rows[r] ?? [];
    for (let k = 0; k < q; k++) {
      const w = row[k] ?? 0;
      if (w > 0.06) arcs.push({ q, k, w });
    }
  }
  const focused = focusQ !== null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Arc diagram of attention from each token to earlier tokens">
      {arcs.map(({ q, k, w }) => {
        const x1 = xAt(q);
        const x2 = xAt(k);
        const lift = Math.min(base - 8, 14 + (x1 - x2) * 0.42);
        const d = `M ${x1} ${base} C ${x1} ${base - lift}, ${x2} ${base - lift}, ${x2} ${base}`;
        const isFocus = focused && q === focusQ;
        const alpha = focused ? (isFocus ? 0.35 + 0.65 * w : 0.06) : 0.15 + 0.6 * w;
        return (
          <path
            key={`${q}-${k}`}
            d={d}
            fill="none"
            stroke={isFocus ? HEX.model : withAlpha(HEX.model, 1)}
            strokeOpacity={alpha}
            strokeWidth={0.8 + w * (isFocus ? 6 : 4)}
            strokeLinecap="round"
          />
        );
      })}
      {tokens.map((t, i) => {
        const x = xAt(i);
        const c = CLASS_COLORS[classify(t.text)];
        const hot = focusQ === i;
        const attendedW = focusQ !== null ? (rows[focusQ - rowOffset]?.[i] ?? 0) : 0;
        return (
          <g key={t.index} onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(null)} className="cursor-pointer">
            <circle cx={x} cy={base} r={hot ? 7 : 5} fill={hot ? c : withAlpha(c, 0.35 + 0.65 * attendedW)} stroke={c} strokeWidth={1} />
            {focusQ !== null && attendedW > 0.08 && i !== focusQ && (
              <text x={x} y={base - 12} textAnchor="middle" fontSize={9} fill={HEX.text} fontFamily="JetBrains Mono, monospace">
                {attendedW.toFixed(2)}
              </text>
            )}
            <text x={x} y={base + 22} textAnchor="middle" fontSize={10} fill={hot ? HEX.text : HEX.textMuted} fontFamily="JetBrains Mono, monospace" transform={n > 22 ? `rotate(-35 ${x} ${base + 22})` : undefined}>
              {displayText(t.text).slice(0, 8)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Q · K → softmax strip for one query ────────────────────────────────────

function QKPanel({ tokens, row, q, dHead }: { tokens: readonly Token[]; row: number[]; q: number; dHead: number }) {
  const keys = tokens.slice(0, q + 1);
  // Recover scores up to a constant from the weights: score_j = log w_j (softmax⁻¹).
  const scores = keys.map((_, j) => Math.log(Math.max(1e-6, row[j] ?? 0)));
  const maxS = Math.max(...scores);
  const minS = Math.min(...scores);
  const span = Math.max(1e-6, maxS - minS);
  return (
    <div className="mono rounded-lg border border-line bg-bg-deep/60 p-3 text-[11px]">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-text-muted">
        <span>
          query <span className="text-text">{displayText(tokens[q]?.text ?? '')}</span>
        </span>
        <span>
          q = x<sub>{q}</sub>W<sub>Q</sub>, k<sub>j</sub> = x<sub>j</sub>W<sub>K</sub>, d<sub>head</sub> = {dHead}
        </span>
      </div>
      <div className="mb-1 text-text-faint">scores = q·kⱼ / √{dHead}</div>
      <div className="flex items-end gap-px" style={{ height: 30 }}>
        {scores.map((s, j) => (
          <span key={j} className="flex-1 rounded-t-sm" style={{ height: 3 + ((s - minS) / span) * 26, background: withAlpha(HEX.input, 0.75) }} title={displayText(keys[j]?.text ?? '')} />
        ))}
      </div>
      <div className="my-1 text-center text-[12px] text-text-faint">↓ softmax ↓</div>
      <div className="flex items-end gap-px" style={{ height: 30 }}>
        {keys.map((_, j) => (
          <span key={j} className="flex-1 rounded-t-sm" style={{ height: 3 + (row[j] ?? 0) * 27, background: HEX.model }} title={`${displayText(keys[j]?.text ?? '')} ${(row[j] ?? 0).toFixed(3)}`} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-text-faint">
        <span>weights sum to 1</span>
        <span>keys 0 → {q}</span>
      </div>
    </div>
  );
}

// ─── "Why this matters" ─────────────────────────────────────────────────────

interface Insight {
  q: number;
  k: number;
  w: number;
  kind: 'coref' | 'copy' | 'generic';
}

function findInsight(tokens: readonly Token[], rows: number[][], rowOffset: number): Insight | null {
  let best: Insight | null = null;
  for (let r = 0; r < rows.length; r++) {
    const q = rowOffset + r;
    const qt = tokens[q];
    if (!qt) continue;
    const row = rows[r] ?? [];
    for (let k = 0; k < q - 1; k++) {
      const w = row[k] ?? 0;
      if (k === 0 && w < 0.5) continue; // ignore the usual attention-sink unless dominant
      const kt = tokens[k];
      if (!kt) continue;
      let kind: Insight['kind'] = 'generic';
      let score = w;
      if (isPronoun(qt.text) && isReferentCandidate(kt.text)) {
        kind = 'coref';
        score = w + 0.5;
      } else if (qt.text.toLowerCase() === kt.text.toLowerCase()) {
        kind = 'copy';
        score = w + 0.2;
      }
      if (!best || score > best.w + (best.kind === 'coref' ? 0.5 : best.kind === 'copy' ? 0.2 : 0)) best = { q, k, w, kind };
    }
  }
  return best && best.w > 0.12 ? best : null;
}

// ─── Scene ──────────────────────────────────────────────────────────────────

function Summary() {
  const a = useStore((s) => s.view.attention);
  return (
    <SummaryRow>
      <Stat label="heads" value={a.nHeads || '–'} />
      <Stat label="layers" value={a.nLayers || '–'} />
      <Stat label="latest" value={a.latest ? `layer ${a.latest.layer + 1} · step ${a.latest.step}` : '–'} />
    </SummaryRow>
  );
}

function Body() {
  const { attention, view, lastEvent, level } = useStore(
    useShallow((s) => ({ attention: s.view.attention, view: s.view, lastEvent: s.view.lastEvent, level: s.explainLevel })),
  );
  const p = useCurrentProgress();
  const latest = attention.latest;
  const [sel, setSel] = useState<{ layer: number; head: number; step: number }>({ layer: 0, head: 0, step: 0 });
  const [follow, setFollow] = useState(true);
  const [cellHover, setCellHover] = useState<Cell | null>(null);
  const [tokenHover, setTokenHover] = useState<number | null>(null);
  const [showMask, setShowMask] = useState(true);

  // Follow the pipeline's latest attention event unless the user picked a layer/head.
  useEffect(() => {
    if (follow && latest) setSel((s) => ({ ...s, layer: latest.layer, step: latest.step }));
  }, [follow, latest]);

  const ev: EventOf<'attention'> | undefined = attention.byKey[`${sel.step}:${sel.layer}`];
  const tokens = useMemo(() => contextTokens(view, sel.step), [view, sel.step]);
  const n = tokens.length;
  const headRows = ev?.heads[sel.head] ?? [];
  const rowOffset = headRows.length === n ? 0 : Math.max(0, n - headRows.length);
  const isCurrent = lastEvent?.type === 'attention' && lastEvent.layer === sel.layer && lastEvent.step === sel.step;
  const reveal = isCurrent ? easeOut(window01(p, 0.12, 0.85)) : 1;
  const revealed = Math.ceil(reveal * headRows.length);
  const insight = useMemo(() => (ev ? findInsight(tokens, headRows, rowOffset) : null), [ev, tokens, headRows, rowOffset]);
  const focusQ = tokenHover ?? cellHover?.q ?? insight?.q ?? (headRows.length ? rowOffset + headRows.length - 1 : null);
  const focusRow = focusQ !== null ? (headRows[focusQ - rowOffset] ?? null) : null;
  const headKind = ev?.headKinds?.[sel.head];

  if (!ev) return <SceneNote>Waiting for the first attention pass…</SceneNote>;

  const layers = Array.from({ length: attention.nLayers || 12 }, (_, i) => i);
  const heads = Array.from({ length: ev.nHeads }, (_, i) => i);

  return (
    <div className="space-y-4">
      {/* pickers */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Layer</span>
          <div className="flex gap-0.5">
            {layers.map((l) => {
              const has = Boolean(attention.byKey[`${sel.step}:${l}`]);
              return (
                <button
                  key={l}
                  type="button"
                  disabled={!has}
                  onClick={() => {
                    setFollow(false);
                    setSel((s) => ({ ...s, layer: l }));
                  }}
                  className={
                    'mono h-6 w-6 rounded text-[10.5px] transition-colors disabled:opacity-30 ' +
                    (sel.layer === l ? 'bg-phase-model text-bg-deep' : 'bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text')
                  }
                >
                  {l + 1}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Head</span>
          <div className="flex gap-0.5">
            {heads.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setSel((s) => ({ ...s, head: h }))}
                className={
                  'mono h-6 w-6 rounded text-[10.5px] transition-colors ' +
                  (sel.head === h ? 'bg-phase-model text-bg-deep' : 'bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text')
                }
              >
                {h + 1}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-[11.5px] text-text-muted">
          <input type="checkbox" checked={showMask} onChange={(e) => setShowMask(e.target.checked)} /> causal mask
        </label>
        {!follow && (
          <button type="button" onClick={() => setFollow(true)} className="text-[11.5px] text-phase-model underline decoration-dotted underline-offset-2">
            follow pipeline
          </button>
        )}
        {headKind && (
          <span className="mono ml-auto rounded-md border border-dashed border-warn/50 bg-warn/10 px-2 py-0.5 text-[10.5px] text-warn">
            illustrative pattern: {headKind}
          </span>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div className="relative rounded-xl border border-line bg-bg-deep/60 p-3">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">
              {rowOffset > 0 ? 'Decode: one new query row' : 'Who looks at whom'}
            </span>
            <span className="mono text-[10.5px] text-text-faint">
              rows = queries · cols = keys · L{sel.layer + 1} H{sel.head + 1}
            </span>
          </div>
          <Heatmap tokens={tokens} rows={headRows} rowOffset={rowOffset} revealed={revealed} hover={cellHover} onHover={setCellHover} showMask={showMask} />
          <AnimatePresence>
            {cellHover && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={springs.quick}
                className="mono absolute right-3 bottom-3 rounded-md border border-line bg-bg-deep px-2.5 py-1.5 text-[11px] text-text"
              >
                {displayText(tokens[cellHover.q]?.text ?? '')} → {displayText(tokens[cellHover.k]?.text ?? '')}
                {cellHover.k > cellHover.q ? (
                  <span className="text-text-faint"> · masked (future)</span>
                ) : (
                  <span className="text-phase-model"> · {(headRows[cellHover.q - rowOffset]?.[cellHover.k] ?? 0).toFixed(3)}</span>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-line bg-bg-deep/60 p-3">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Arcs · hover a token</span>
              {focusQ !== null && (
                <span className="mono text-[10.5px] text-text-faint">
                  showing “{displayText(tokens[focusQ]?.text ?? '')}”
                </span>
              )}
            </div>
            <Arcs tokens={tokens} rows={headRows} rowOffset={rowOffset} focusQ={focusQ} onHover={setTokenHover} revealed={revealed} />
          </div>
          {focusRow && focusQ !== null && <QKPanel tokens={tokens} row={focusRow} q={focusQ} dHead={ev.dHead} />}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <AnimatePresence mode="wait">
          {insight && revealed >= headRows.length && (
            <motion.div
              key={`${sel.layer}-${sel.head}-${insight.q}-${insight.k}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={springs.soft}
              onMouseEnter={() => setTokenHover(insight.q)}
              onMouseLeave={() => setTokenHover(null)}
              className="rounded-lg border border-line bg-surface-2/70 p-3"
              style={{ borderLeftColor: HEX.model, borderLeftWidth: 3 }}
            >
              <div className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Why this matters</div>
              <div className="mt-1 text-[13px] leading-relaxed text-text">
                {insight.kind === 'coref' ? (
                  <>
                    “{displayText(tokens[insight.q]?.text ?? '')}” puts {(insight.w * 100).toFixed(0)}% of its attention on “{displayText(tokens[insight.k]?.text ?? '')}”. That is a pronoun reaching back for its referent — the model resolving <em>what</em> “it” means, right here in this head.
                  </>
                ) : insight.kind === 'copy' ? (
                  <>
                    “{displayText(tokens[insight.q]?.text ?? '')}” attends to its earlier copy ({(insight.w * 100).toFixed(0)}%). Duplicate-token heads let the model notice repetition and predict what followed last time.
                  </>
                ) : (
                  <>
                    “{displayText(tokens[insight.q]?.text ?? '')}” attends most to “{displayText(tokens[insight.k]?.text ?? '')}” ({(insight.w * 100).toFixed(0)}%), several tokens back. Attention is how information jumps across distance in a single step.
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <SceneNote>
          {level === 'math'
            ? `A = softmax(QKᵀ/√${ev.dHead} + M), M_ij = −∞ for j > i. Each of the ${ev.nHeads} heads has its own W_Q, W_K, W_V ∈ ℝ^{d×${ev.dHead}}; outputs are concatenated and projected by W_O. Rows sum to 1.`
            : 'Each row is one token asking “which earlier tokens matter for me?” Brighter cells mean more weight; the hatched triangle is the future, which a token is never allowed to see. Different heads learn different habits: some watch the previous word, some the punctuation, some resolve pronouns.'}
        </SceneNote>
      </div>
    </div>
  );
}

export const Attention: Scene = { Summary, Body };
