import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { CLASS_COLORS, diverging, HEX, withAlpha } from '../../../design/colors';
import { springs } from '../../../design/motion';
import { useCanvas } from '../../../hooks/useCanvas';
import { easeOut, useEventProgress, window01 } from '../../../hooks/useEventProgress';
import type { EventOf, Token } from '../../../pipeline/events';
import { positionFrequency } from '../../../sim/embed';
import { classify } from '../../../sim/lexicon';
import { scheduler, useStore } from '../../../store/useStore';
import { displayText, TokenChip } from '../../common/TokenChip';
import type { Scene } from './index';
import { SceneNote, Stat, SummaryRow } from './shared';

const NO_TOKENS: Token[] = [];
const SHOWN_COLS = 10;

function useEmbeddedSeq(): number | null {
  return useStore((s) => {
    if (!s.view.embedding) return null;
    const i = scheduler.events.findIndex((e) => e.type === 'embedded');
    return i >= 0 ? i : null;
  });
}

// ─── Number matrix: token → row of numbers rolling in ───────────────────────

function Matrix({
  tokens,
  emb,
  rows,
  hovered,
  onHover,
}: {
  tokens: readonly Token[];
  emb: EventOf<'embedded'>;
  rows: number;
  hovered: number | null;
  onHover: (i: number | null) => void;
}) {
  const max = useMemo(() => Math.max(1e-6, ...emb.vectors.flatMap((v) => v.slice(0, SHOWN_COLS).map(Math.abs))), [emb]);
  return (
    <div className="mono max-h-[340px] overflow-auto rounded-lg border border-line bg-bg-deep/60">
      <table className="border-separate border-spacing-0 text-[11px]">
        <thead className="sticky top-0 z-10 bg-bg-deep">
          <tr>
            <th className="px-2 py-1.5 text-left font-normal text-text-faint">token</th>
            {Array.from({ length: SHOWN_COLS }, (_, j) => (
              <th key={j} className="px-1 py-1.5 text-right font-normal text-text-faint tabular">
                d{j}
              </th>
            ))}
            <th className="px-2 py-1.5 text-left font-normal text-text-faint">…{emb.dims}</th>
          </tr>
        </thead>
        <tbody>
          {tokens.slice(0, rows).map((t, i) => {
            const v = emb.vectors[i] ?? [];
            const hot = hovered === i;
            return (
              <motion.tr
                key={t.index}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={springs.snappy}
                onMouseEnter={() => onHover(i)}
                onMouseLeave={() => onHover(null)}
                className={hot ? 'bg-surface-2' : ''}
              >
                <td className="px-2 py-0.5">
                  <TokenChip token={t} size="xs" tooltip={false} layoutId={`tok-${t.index}`} active={hot} />
                </td>
                {v.slice(0, SHOWN_COLS).map((x, j) => (
                  <td key={j} className="px-0.5 py-0.5">
                    <motion.span
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ ...springs.quick, delay: j * 0.02 }}
                      className="block rounded px-1 text-right tabular"
                      style={{ background: diverging(x, max), color: Math.abs(x) / max > 0.55 ? HEX.bgDeep : HEX.textMuted }}
                    >
                      {x.toFixed(2)}
                    </motion.span>
                  </td>
                ))}
                <td className="px-2 text-text-faint">…</td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Strips: E[id] + P[pos] = x, drawn on canvas ────────────────────────────

function Strips({
  emb,
  rows,
  phase,
  hovered,
}: {
  emb: EventOf<'embedded'>;
  rows: number;
  /** 0 → only E, 1 → P fully added. */
  phase: number;
  hovered: number | null;
}) {
  const n = emb.vectors.length;
  const d = emb.shownDims;
  const ref = useCanvas(
    (ctx, w, h) => {
      const gap = 14;
      const stripW = (w - gap * 2) / 3;
      const cellH = Math.max(2, Math.min(8, (h - 16) / Math.max(1, n)));
      const cellW = stripW / d;
      const maxE = Math.max(1e-6, ...emb.vectors.flat().map(Math.abs));
      const labels = ['E[id]', '+ P[pos]', '= x'];
      ctx.font = '10px "JetBrains Mono", monospace';
      for (let s = 0; s < 3; s++) {
        const x0 = s * (stripW + gap);
        ctx.fillStyle = HEX.textFaint;
        ctx.fillText(labels[s] ?? '', x0, 10);
        for (let i = 0; i < Math.min(rows, n); i++) {
          const e = emb.vectors[i] ?? [];
          const pe = emb.positional[i] ?? [];
          for (let j = 0; j < d; j++) {
            let v = 0;
            if (s === 0) v = e[j] ?? 0;
            else if (s === 1) v = (pe[j] ?? 0) * phase * maxE * 0.9;
            else v = (e[j] ?? 0) + (pe[j] ?? 0) * phase * maxE * 0.9;
            ctx.fillStyle = diverging(v, maxE);
            ctx.fillRect(x0 + j * cellW, 16 + i * cellH, Math.ceil(cellW), Math.ceil(cellH) - 1);
          }
          if (hovered === i) {
            ctx.strokeStyle = HEX.text;
            ctx.lineWidth = 1;
            ctx.strokeRect(x0 + 0.5, 16 + i * cellH - 0.5, stripW - 1, cellH);
          }
        }
        if (s === 1 && phase < 1) {
          ctx.fillStyle = withAlpha(HEX.bgDeep, 0.55 * (1 - phase));
          ctx.fillRect(x0, 16, stripW, cellH * Math.min(rows, n));
        }
      }
      ctx.fillStyle = HEX.textFaint;
      ctx.fillText('rows = tokens · columns = dims', 0, h - 3);
    },
    [emb, rows, phase, hovered, n, d],
  );
  return <canvas ref={ref} className="h-[150px] w-full" role="img" aria-label="Token embedding plus positional encoding heat strips" />;
}

// ─── Positional wave ────────────────────────────────────────────────────────

/** A few dims of the position signal traced across positions: fast waves on the left, slow on the right. */
function PositionWave({ emb, hovered, phase }: { emb: EventOf<'embedded'>; hovered: number | null; phase: number }) {
  const n = emb.positional.length;
  const ref = useCanvas(
    (ctx, w, h) => {
      const dims = emb.shownDims;
      const picks = [0, Math.floor(dims * 0.25), Math.floor(dims * 0.5), dims - 2].filter((d, i, a) => a.indexOf(d) === i);
      const colors = [HEX.input, HEX.blue, HEX.model, HEX.pink];
      const pad = 8;
      const top = 16;
      const mid = top + (h - top - pad) / 2;
      const amp = (h - top - pad) / 2 - 2;
      const xAt = (pos: number): number => pad + (pos / Math.max(1, n - 1)) * (w - pad * 2);
      ctx.strokeStyle = HEX.line;
      ctx.beginPath();
      ctx.moveTo(pad, mid);
      ctx.lineTo(w - pad, mid);
      ctx.stroke();
      // Fine curve between integer positions so the waves read as waves.
      const steps = 6;
      picks.forEach((d, k) => {
        const f = positionFrequency(d, emb.dims, dims);
        ctx.strokeStyle = withAlpha(colors[k] ?? HEX.input, 0.35 + 0.65 * phase);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let s = 0; s <= (n - 1) * steps; s++) {
          const pos = s / steps;
          const y = mid - Math.sin(pos * f) * amp * phase;
          if (s === 0) ctx.moveTo(xAt(pos), y);
          else ctx.lineTo(xAt(pos), y);
        }
        ctx.stroke();
      });
      // Position ticks + the hovered token's column.
      for (let pos = 0; pos < n; pos++) {
        const hot = hovered === pos;
        ctx.fillStyle = hot ? HEX.text : HEX.lineStrong;
        ctx.fillRect(xAt(pos) - 0.5, mid - (hot ? amp + 2 : 2), 1, hot ? (amp + 2) * 2 : 4);
      }
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = HEX.textFaint;
      ctx.fillText(`P[pos, d] = sin(pos / 10000^(d/${emb.dims}))  ·  d = ${picks.join(', ')}  ·  pos 0 → ${n - 1}`, pad, 10);
    },
    [emb, hovered, phase, n],
  );
  return <canvas ref={ref} className="h-[84px] w-full" role="img" aria-label="Positional encoding waves across positions" />;
}

// ─── Scatter: PCA of the vectors ────────────────────────────────────────────

function Scatter({
  tokens,
  emb,
  reveal,
  hovered,
  onHover,
}: {
  tokens: readonly Token[];
  emb: EventOf<'embedded'>;
  reveal: number;
  hovered: number | null;
  onHover: (i: number | null) => void;
}) {
  const pts = emb.projected;
  const [size, setSize] = useState({ w: 1, h: 1 });
  const ref = useCanvas(
    (ctx, w, h) => {
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
      const pad = 26;
      const toX = (x: number): number => pad + ((x + 1) / 2) * (w - pad * 2);
      const toY = (y: number): number => pad + ((1 - y) / 2) * (h - pad * 2);
      ctx.strokeStyle = HEX.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(toX(0), pad);
      ctx.lineTo(toX(0), h - pad);
      ctx.moveTo(pad, toY(0));
      ctx.lineTo(w - pad, toY(0));
      ctx.stroke();
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = HEX.textFaint;
      ctx.fillText('PC1 →', w - pad - 34, toY(0) - 4);
      ctx.fillText('PC2 ↑', toX(0) + 4, pad + 10);
      const n = Math.min(pts.length, Math.ceil(reveal * pts.length));
      const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
      const labels: Array<{ x: number; y: number; text: string; hot: boolean; alpha: number }> = [];
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const t = tokens[i];
        if (!p || !t) continue;
        const local = Math.min(1, Math.max(0, reveal * pts.length - i));
        const color = CLASS_COLORS[classify(t.text)];
        const hot = hovered === i;
        const r = (hot ? 6 : 4) * local;
        const cx = toX(p[0]);
        const cy = toY(p[1]);
        ctx.beginPath();
        ctx.arc(cx, cy, r + (hot ? 7 : 3), 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(color, hot ? 0.35 : 0.14);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        labels.push({ x: cx + r + 4, y: cy + 3.5, text: displayText(t.text), hot, alpha: local });
      }
      // Greedy label placement: the hovered label always wins, others skip on overlap.
      labels.sort((a, b) => Number(b.hot) - Number(a.hot));
      for (const l of labels) {
        ctx.font = `${l.hot ? 'bold ' : ''}10.5px "JetBrains Mono", monospace`;
        const tw = ctx.measureText(l.text).width;
        const box = { x: l.x, y: l.y - 9, w: tw, h: 11 };
        const collides = placed.some((b) => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y);
        if (collides && !l.hot) continue;
        placed.push(box);
        if (l.hot) {
          ctx.fillStyle = withAlpha(HEX.bgDeep, 0.85);
          ctx.fillRect(box.x - 2, box.y - 1, box.w + 4, box.h + 2);
        }
        ctx.fillStyle = l.hot ? HEX.text : withAlpha(HEX.text, 0.75 * l.alpha);
        ctx.fillText(l.text, l.x, l.y);
      }
    },
    [pts, tokens, reveal, hovered],
  );
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pad = 26;
    let best = -1;
    let bestD = 14;
    pts.forEach((p, i) => {
      const x = pad + ((p[0] + 1) / 2) * (size.w - pad * 2);
      const y = pad + ((1 - p[1]) / 2) * (size.h - pad * 2);
      const d = Math.hypot(x - mx, y - my);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    onHover(best >= 0 ? best : null);
  };
  return (
    <canvas
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={() => onHover(null)}
      className="h-[300px] w-full cursor-crosshair rounded-lg border border-line bg-bg-deep/60"
      role="img"
      aria-label="2-D projection of token embeddings"
    />
  );
}

// ─── Scene ──────────────────────────────────────────────────────────────────

function Summary() {
  const e = useStore((s) => s.view.embedding);
  return (
    <SummaryRow>
      <Stat label="vectors" value={e?.vectors.length ?? 0} />
      <Stat label="dims" value={e ? `${e.dims} (showing ${e.shownDims})` : '–'} />
      <Stat label="position" value={e?.fidelity === 'real' ? 'learned table' : 'sinusoidal'} />
    </SummaryRow>
  );
}

function Body() {
  const { emb, tokens, level } = useStore(
    useShallow((s) => ({ emb: s.view.embedding, tokens: s.view.tokens?.tokens ?? NO_TOKENS, level: s.explainLevel })),
  );
  const seq = useEmbeddedSeq();
  const p = useEventProgress(seq);
  const [hovered, setHovered] = useState<number | null>(null);
  if (!emb) return <SceneNote>Waiting for the embedding lookup…</SceneNote>;
  const n = tokens.length;
  const rows = Math.min(n, Math.ceil(easeOut(window01(p, 0, 0.45)) * n));
  const phase = easeOut(window01(p, 0.45, 0.7));
  const reveal = easeOut(window01(p, 0.3, 0.95));

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
      <div className="min-w-0 space-y-3">
        <div className="flex items-baseline justify-between">
          <h4 className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Lookup table → vectors</h4>
          <span className="mono text-[10.5px] text-text-faint">
            E ∈ ℝ<sup>{emb.dims.toLocaleString()}×{'V'}</sup> · showing {SHOWN_COLS} of {emb.dims} dims
          </span>
        </div>
        <Matrix tokens={tokens} emb={emb} rows={rows} hovered={hovered} onHover={setHovered} />
        <div className="flex flex-wrap gap-2">
          <Stat label="rows" value={`${rows} / ${n}`} />
          <Stat label="parameters in E" value={`${((emb.dims * 50257) / 1e6).toFixed(1)} M`} />
          <Stat label="position added" value={`${Math.round(phase * 100)}%`} />
        </div>
      </div>
      <div className="space-y-3">
        <h4 className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Add position, then look at the geometry</h4>
        <Strips emb={emb} rows={rows} phase={phase} hovered={hovered} />
        <PositionWave emb={emb} hovered={hovered} phase={phase} />
        <Scatter tokens={tokens} emb={emb} reveal={reveal} hovered={hovered} onHover={setHovered} />
        <SceneNote>
          {level === 'math'
            ? 'x_i = E[id_i] + P[i]. The scatter is a 2-component PCA of the E rows: distances are only roughly preserved, but tokens of the same kind land together.'
            : 'Similar tokens get similar vectors, so they cluster (colours are word classes). The wave is the position signal: it makes the same word look slightly different at position 3 than at position 12, which is how the model knows word order.'}
        </SceneNote>
      </div>
    </div>
  );
}

export const Embeddings: Scene = { Summary, Body };
