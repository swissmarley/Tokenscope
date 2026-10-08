import { AnimatePresence, motion } from 'framer-motion';
import { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import { HEX, withAlpha } from '../../../design/colors';
import { springs } from '../../../design/motion';
import { useCurrentProgress } from '../../../hooks/useCurrentProgress';
import { easeOut, window01 } from '../../../hooks/useEventProgress';
import type { EventOf } from '../../../pipeline/events';
import { wireFrame, wireLabel } from '../../../pipeline/wireFrame';
import { useStore } from '../../../store/useStore';
import { Odometer } from '../../common/Odometer';
import { displayText } from '../../common/TokenChip';
import type { Scene } from './index';
import { SceneNote, Stat, SummaryRow } from './shared';

// ─── The wire: SSE chunks as pulses on a real-time axis ─────────────────────

function Wire({ chunks, done, nowT }: { chunks: EventOf<'token_streamed'>[]; done: EventOf<'done'> | null; nowT: number }) {
  const W = 760;
  const H = 96;
  const y = 48;
  const tEnd = Math.max(done?.totalMs ?? 0, chunks[chunks.length - 1]?.t ?? 0, nowT, 500) * 1.04;
  const xAt = (t: number): number => 16 + (t / tEnd) * (W - 32);
  const first = chunks[0];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Server-sent events arriving over time">
      <defs>
        <filter id="glow-out" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <line x1={16} x2={W - 16} y1={y} y2={y} stroke={HEX.lineStrong} strokeWidth={2} />
      {/* TTFT span */}
      {first && (
        <>
          <line x1={16} x2={xAt(first.t)} y1={y} y2={y} stroke={withAlpha(HEX.input, 0.7)} strokeWidth={4} strokeLinecap="round" />
          <text x={(16 + xAt(first.t)) / 2} y={y - 12} textAnchor="middle" fontSize={9.5} fill={HEX.input} fontFamily="JetBrains Mono, monospace">
            waiting {first.t} ms
          </text>
        </>
      )}
      {chunks.map((c, i) => {
        const x = xAt(c.t);
        const last = i === chunks.length - 1;
        return (
          <g key={c.seq}>
            <circle cx={x} cy={y} r={last ? 5 : 3} fill={HEX.output} filter={last ? 'url(#glow-out)' : undefined} />
            {(last || i % Math.max(1, Math.ceil(chunks.length / 14)) === 0) && (
              <text x={x} y={y + 20} textAnchor="middle" fontSize={9} fill={last ? HEX.text : HEX.textMuted} fontFamily="JetBrains Mono, monospace">
                {displayText(c.text).slice(0, 7)}
              </text>
            )}
          </g>
        );
      })}
      {/* ticks */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <text key={f} x={xAt(f * tEnd)} y={H - 4} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} fontSize={9} fill={HEX.textFaint} fontFamily="JetBrains Mono, monospace">
          {Math.round(f * tEnd)} ms
        </text>
      ))}
      {done && (
        <text x={xAt(done.totalMs)} y={y - 12} textAnchor="end" fontSize={9.5} fill={HEX.ok} fontFamily="JetBrains Mono, monospace">
          {done.stopReason} ✓
        </text>
      )}
    </svg>
  );
}

// ─── Scene ──────────────────────────────────────────────────────────────────

function Summary() {
  const st = useStore((s) => s.view.stream);
  return (
    <SummaryRow>
      <Stat label="chunks" value={st.chunks.length} />
      {st.done && <Stat label="TTFT" value={`${st.done.ttftMs} ms`} />}
      {st.done && <Stat label="tok/s" value={st.done.tokensPerSec.toFixed(1)} />}
      {st.done && <Stat label="stop" value={st.done.stopReason} />}
    </SummaryRow>
  );
}

function Body() {
  const { stream, lastEvent, level, usageIn } = useStore(
    useShallow((s) => ({ stream: s.view.stream, lastEvent: s.view.lastEvent, level: s.explainLevel, usageIn: s.view.tokens?.tokens.length ?? 0 })),
  );
  const p = useCurrentProgress();
  const gluing = lastEvent?.type === 'detokenized';
  const glue = gluing ? easeOut(window01(p, 0.1, 0.8)) : stream.detokenized ? 1 : 0;
  const lastChunk = stream.chunks[stream.chunks.length - 1] ?? null;
  const nowT = lastEvent?.t ?? 0;
  const done = stream.done;
  const elapsed = done ? done.totalMs : nowT;
  const tokPerSec = useMemo(() => {
    const first = stream.chunks[0];
    if (!first || stream.chunks.length < 2) return 0;
    const span = (lastChunk?.t ?? first.t) - first.t;
    return span > 0 ? ((stream.chunks.length - 1) / span) * 1000 : 0;
  }, [stream.chunks, lastChunk]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-bg-deep/60 p-3">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Over the wire · server-sent events</span>
          <span className="mono text-[10.5px] text-text-faint">
            {stream.chunks.length} chunks · real time{lastChunk && ` · ${wireLabel(lastChunk)}`}
          </span>
        </div>
        <Wire chunks={stream.chunks} done={done} nowT={nowT} />
        <AnimatePresence mode="wait">
          {lastChunk && (
            <motion.pre
              key={lastChunk.seq}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={springs.quick}
              className="mono mt-1 overflow-x-auto rounded-md bg-surface-2/70 px-2.5 py-1.5 text-[11px] text-text-muted"
            >
              {wireFrame(lastChunk).map(([field, value], i) => (
                <span key={i}>
                  {i > 0 && '\n'}
                  {field && <span className="text-phase-output">{field}:</span>} {value}
                </span>
              ))}
            </motion.pre>
          )}
        </AnimatePresence>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-3">
          <div className="rounded-xl border border-line bg-bg-deep/60 p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase">Token IDs → text</span>
              <span className="mono text-[10.5px] text-text-faint">{glue >= 1 ? 'joined' : glue > 0 ? 'joining…' : 'chunk by chunk'}</span>
            </div>
            <div className="mono flex flex-wrap text-[12.5px] leading-relaxed" style={{ gap: `${2 + (1 - glue) * 5}px` }}>
              {stream.chunks.map((c, i) => (
                <motion.span
                  key={c.seq}
                  layout
                  initial={{ opacity: 0, y: -8, scale: 0.7 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={springs.snappy}
                  className="whitespace-pre"
                  style={{
                    padding: `${1 + (1 - glue) * 2}px ${(1 - glue) * 5}px`,
                    borderRadius: 4,
                    border: `1px solid ${withAlpha(HEX.output, (1 - glue) * 0.5)}`,
                    background: withAlpha(HEX.output, (1 - glue) * 0.12),
                    color: HEX.text,
                  }}
                  title={`id ${c.token.id}`}
                >
                  {glue < 0.5 ? displayText(c.text) : c.text}
                  {glue < 0.5 && <span className="ml-1 text-[9px] text-text-faint">{c.token.id}</span>}
                  {i === stream.chunks.length - 1 && !done && <span className="animate-pulse-soft text-phase-output">▍</span>}
                </motion.span>
              ))}
              {stream.chunks.length === 0 && <span className="text-text-faint">no chunks yet</span>}
            </div>
          </div>

          <div className="flex justify-end">
            <motion.div layout className="max-w-[560px] rounded-2xl rounded-tl-sm border border-phase-output/40 bg-phase-output/10 px-4 py-3 text-[14px] leading-relaxed text-text shadow-glow-output">
              <span className="mr-2 text-[10.5px] tracking-[0.1em] text-phase-output uppercase">assistant</span>
              {stream.text || <span className="text-text-faint">…</span>}
              {!done && stream.chunks.length > 0 && <span className="animate-pulse-soft text-phase-output">▍</span>}
            </motion.div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'time to first token', value: stream.chunks[0]?.t ?? 0, unit: 'ms', digits: 0 },
              { label: 'tokens / second', value: done ? done.tokensPerSec : tokPerSec, unit: 'tok/s', digits: 1 },
              { label: 'tokens in', value: done ? done.usage.input : usageIn, unit: '', digits: 0 },
              { label: 'tokens out', value: done ? done.usage.output : stream.chunks.length, unit: '', digits: 0 },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
                <div className="text-[10px] tracking-[0.12em] text-text-faint uppercase">{s.label}</div>
                <div className="mono mt-0.5 text-[22px] leading-none font-medium text-text">
                  <Odometer value={s.value} digits={s.digits} />
                  {s.unit && <span className="ml-1 text-[11px] text-text-muted">{s.unit}</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Stat label="elapsed" value={`${Math.round(elapsed)} ms`} />
            {done && <Stat label="stop reason" value={done.stopReason} />}
          </div>
          <SceneNote>
            {level === 'math'
              ? 'Each chunk is one SSE frame: text = decode(id). throughput = (n_out − 1) / (t_last − t_first). Usage counts are what the API bills: input includes the system prompt and template tokens.'
              : 'Streaming does not make the model faster — it lets you read while it is still writing. Each dot is one chunk arriving; the long cyan wait at the start is prefill. The IDs are decoded back into text with the same table that split your message apart.'}
          </SceneNote>
        </div>
      </div>
    </div>
  );
}

export const Streaming: Scene = { Summary, Body };
