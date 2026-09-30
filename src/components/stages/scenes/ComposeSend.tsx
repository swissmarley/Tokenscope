import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { HEX, withAlpha } from '../../../design/colors';
import { springs, tween } from '../../../design/motion';
import { easeOut, useEventProgress, window01 } from '../../../hooks/useEventProgress';
import type { Hop, RequestBody } from '../../../pipeline/events';
import { scheduler, useStore } from '../../../store/useStore';
import { ChevronDownIcon } from '../../common/Icons';
import type { Scene } from './index';
import { SceneNote, Stat, SummaryRow } from './shared';

/** First event of a given type in the log. */
function findSeq(type: string): number | null {
  const i = scheduler.events.findIndex((e) => e.type === type);
  return i >= 0 ? i : null;
}

// ─── Assembly: message → stamped → enveloped ────────────────────────────────

interface Stamp {
  key: string;
  label: string;
  value: string;
  color: string;
  rot: number;
}

function stampsFor(body: RequestBody): Stamp[] {
  return [
    { key: 'model', label: 'model', value: body.model, color: HEX.model, rot: -3 },
    { key: 'max', label: 'max_tokens', value: String(body.max_tokens), color: HEX.output, rot: 2 },
    { key: 'temp', label: 'temperature', value: String(body.temperature), color: HEX.output, rot: -2 },
    { key: 'stream', label: 'stream', value: 'true', color: HEX.ok, rot: 3 },
  ];
}

function Assembly({ body, prompt, bytes, p, sent }: { body: RequestBody | null; prompt: string; bytes: number; p: number; sent: boolean }) {
  const stamps = useMemo(() => (body ? stampsFor(body) : []), [body]);
  const showBubble = p > 0.02;
  const showSystem = p > 0.15 && Boolean(body?.system);
  const nStamps = Math.floor(easeOut(window01(p, 0.32, 0.66)) * stamps.length + 0.001);
  const outline = easeOut(window01(p, 0.62, 0.9));
  const label = p > 0.88;

  return (
    <motion.div
      animate={{ height: sent ? 72 : 250 }}
      transition={springs.soft}
      className="relative grid place-items-center overflow-hidden rounded-xl border border-line bg-bg-deep/60"
    >
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-60" />
      <AnimatePresence>
        {showBubble && !sent && (
          <motion.div
            key="envelope"
            layoutId="packet"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={springs.soft}
            className="relative px-8 py-6"
          >
            {/* envelope outline draws itself */}
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
              <motion.rect
                x={1}
                y={1}
                width="calc(100% - 2px)"
                height="calc(100% - 2px)"
                rx={14}
                fill={withAlpha(HEX.input, 0.04 * outline)}
                stroke={HEX.input}
                strokeWidth={1.5}
                strokeDasharray="1 1"
                pathLength={1}
                style={{ strokeDashoffset: 1 - outline, opacity: outline > 0 ? 1 : 0 }}
              />
            </svg>
            <div className="flex flex-col items-center gap-2.5">
              <AnimatePresence>
                {showSystem && (
                  <motion.div
                    key="sys"
                    initial={{ opacity: 0, y: -28 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={springs.snappy}
                    className="mono max-w-[440px] truncate rounded-lg border border-dashed border-text-faint/60 bg-surface-2/80 px-3 py-1.5 text-[11.5px] text-text-muted"
                  >
                    <span className="text-text-faint">system · </span>“{body?.system}”
                  </motion.div>
                )}
              </AnimatePresence>
              <motion.div
                layout
                transition={springs.snappy}
                className="max-w-[460px] rounded-2xl rounded-bl-sm border border-phase-input/60 bg-phase-input/12 px-4 py-2.5 text-[13.5px] leading-snug text-text shadow-glow-input"
              >
                <span className="mr-1.5 text-[10.5px] tracking-[0.1em] text-phase-input uppercase">user</span>
                {prompt}
              </motion.div>
              <div className="flex h-7 flex-wrap items-center justify-center gap-2">
                {stamps.slice(0, nStamps).map((s) => (
                  <motion.span
                    key={s.key}
                    initial={{ opacity: 0, scale: 2.2, rotate: s.rot * 4 }}
                    animate={{ opacity: 1, scale: 1, rotate: s.rot }}
                    transition={{ type: 'spring', stiffness: 520, damping: 26 }}
                    className="mono rounded-md border px-2 py-0.5 text-[11px] font-medium"
                    style={{ borderColor: withAlpha(s.color, 0.7), background: withAlpha(s.color, 0.14), color: s.color }}
                  >
                    {s.label}: {s.value}
                  </motion.span>
                ))}
              </div>
            </div>
            <AnimatePresence>
              {label && (
                <motion.div
                  key="label"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mono absolute -bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-phase-input/60 bg-bg-deep px-2.5 py-0.5 text-[10.5px] text-phase-input whitespace-nowrap"
                >
                  application/json · {bytes} bytes
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
      {sent && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.soft, delay: 0.3 }}
          className="mono flex items-center gap-2.5 text-[11.5px] text-text-muted"
        >
          <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden>
            <rect x="1" y="1" width="20" height="14" rx="3" fill={withAlpha(HEX.input, 0.15)} stroke={HEX.input} strokeWidth="1.5" />
            <path d="M1.5 3l9.5 7 9.5-7" fill="none" stroke={HEX.input} strokeWidth="1.5" />
          </svg>
          sealed · {bytes} bytes · system + message + {stamps.length} parameters
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── Route: browser → proxy → API edge → model ──────────────────────────────

const NODES = [
  { id: 'browser', label: 'Browser', sub: 'you' },
  { id: 'proxy', label: 'Proxy', sub: 'adds the secret key' },
  { id: 'api', label: 'API edge', sub: 'auth · routing' },
  { id: 'model', label: 'Model server', sub: 'GPUs · prefill' },
];

function NodeGlyph({ id, lit }: { id: string; lit: boolean }) {
  const stroke = lit ? HEX.input : HEX.textFaint;
  const common = { fill: 'none', stroke, strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'browser':
      return (
        <g {...common}>
          <rect x={-11} y={-8} width={22} height={16} rx={2.5} />
          <line x1={-11} y1={-3} x2={11} y2={-3} />
          <circle cx={-8} cy={-5.5} r={0.9} fill={stroke} stroke="none" />
          <circle cx={-5} cy={-5.5} r={0.9} fill={stroke} stroke="none" />
        </g>
      );
    case 'proxy':
      return (
        <g {...common}>
          <rect x={-10} y={-9} width={20} height={7} rx={1.5} />
          <rect x={-10} y={2} width={20} height={7} rx={1.5} />
          <circle cx={6} cy={-5.5} r={1} fill={stroke} stroke="none" />
          <circle cx={6} cy={5.5} r={1} fill={stroke} stroke="none" />
        </g>
      );
    case 'api':
      return (
        <g {...common}>
          <path d="M-9 6h17a5 5 0 0 0 0-10 7 7 0 0 0-13-2 5.5 5.5 0 0 0-4 12z" />
        </g>
      );
    default:
      return (
        <g {...common}>
          <rect x={-9} y={-9} width={18} height={18} rx={2} />
          <rect x={-4} y={-4} width={8} height={8} rx={1} fill={withAlpha(stroke, 0.5)} stroke="none" />
          {[-6, -2, 2, 6].map((v) => (
            <g key={v}>
              <line x1={v} y1={-12} x2={v} y2={-9} />
              <line x1={v} y1={9} x2={v} y2={12} />
            </g>
          ))}
        </g>
      );
  }
}

function Route({ hops, totalMs, sent, p }: { hops: Hop[] | null; totalMs: number; sent: boolean; p: number }) {
  const W = 640;
  const H = 128;
  const y = 52;
  const xs = NODES.map((_, i) => 48 + (i * (W - 96)) / (NODES.length - 1));
  const x0 = xs[0] ?? 0;
  const xN = xs[xs.length - 1] ?? 0;
  const travel = easeOut(window01(p, 0, 0.55));
  const waiting = window01(p, 0.55, 1);
  const packetX = x0 + travel * (xN - x0);
  const counterMs = Math.round(p * totalMs);
  const wireHops = hops?.slice(0, 3) ?? [];
  const lastHop = hops?.[3];

  return (
    <div>
      <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Request travelling from browser to model server">
        <defs>
          <filter id="glow-input" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <line x1={x0} x2={xN} y1={y} y2={y} stroke={HEX.lineStrong} strokeWidth={2} />
        {sent && (
          <line x1={x0} x2={packetX} y1={y} y2={y} stroke={HEX.input} strokeWidth={2} strokeDasharray="5 7" className="animate-flow" opacity={0.7} />
        )}
        {wireHops.map((h, i) => {
          const xa = xs[i] ?? 0;
          const xb = xs[i + 1] ?? 0;
          const done = packetX >= xb - 1;
          return (
            <text key={h.label} x={(xa + xb) / 2} y={y - 12} textAnchor="middle" fontSize={10} fill={done ? HEX.textMuted : HEX.textFaint} fontFamily="JetBrains Mono, monospace">
              {h.ms} ms
            </text>
          );
        })}
        {NODES.map((n, i) => {
          const x = xs[i] ?? 0;
          const lit = sent && packetX >= x - 1;
          const isModel = i === NODES.length - 1;
          return (
            <g key={n.id} transform={`translate(${x}, ${y})`}>
              {isModel && waiting > 0 && (
                <>
                  <circle r={22} fill="none" stroke={withAlpha(HEX.model, 0.25)} strokeWidth={3} />
                  <circle
                    r={22}
                    fill="none"
                    stroke={HEX.model}
                    strokeWidth={3}
                    strokeLinecap="round"
                    pathLength={1}
                    strokeDasharray="1 1"
                    strokeDashoffset={1 - waiting}
                    transform="rotate(-90)"
                  />
                </>
              )}
              <circle r={17} fill={lit ? withAlpha(HEX.input, 0.16) : HEX.surface2} stroke={lit ? HEX.input : HEX.lineStrong} strokeWidth={1.5} filter={lit ? 'url(#glow-input)' : undefined} />
              <NodeGlyph id={n.id} lit={lit} />
              <text y={36} textAnchor="middle" fontSize={11.5} fontWeight={600} fill={lit ? HEX.text : HEX.textMuted} fontFamily="Inter Variable, Inter, sans-serif">
                {n.label}
              </text>
              <text y={50} textAnchor="middle" fontSize={9.5} fill={HEX.textFaint} fontFamily="Inter Variable, Inter, sans-serif">
                {n.sub}
              </text>
            </g>
          );
        })}
        {sent && waiting > 0 && lastHop && (
          <text x={xN} y={y - 30} textAnchor="middle" fontSize={10} fill={HEX.model} fontFamily="JetBrains Mono, monospace">
            {waiting < 1 ? `${lastHop.label} · ${lastHop.ms} ms` : 'first byte ✓'}
          </text>
        )}
        {/* glow trail */}
        {sent && p < 1 &&
          [1, 2, 3, 4, 5].map((k) => (
            <circle key={k} cx={Math.max(x0, packetX - k * 9)} cy={y} r={4 - k * 0.5} fill={HEX.input} opacity={0.5 - k * 0.09} />
          ))}
      </svg>
      {/* the packet is HTML so it can morph from the envelope (shared layoutId) */}
      <AnimatePresence>
        {sent && p < 1 && (
          <motion.div
            key="packet"
            layoutId="packet"
            transition={springs.snappy}
            className="mono absolute flex h-5 w-8 items-center justify-center rounded-[4px] bg-phase-input text-[8px] font-bold text-bg-deep shadow-glow-input"
            style={{ left: `${(packetX / W) * 100}%`, top: `${(y / H) * 100}%`, x: '-50%', y: '-50%' }}
          >
            {'{ }'}
          </motion.div>
        )}
      </AnimatePresence>
      </div>
      <div className="mt-1 flex items-end gap-4">
        <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
          <div className="text-[10px] tracking-[0.12em] text-text-faint uppercase">time to first byte</div>
          <div className="mono tabular text-[24px] leading-none font-medium text-text">
            {sent ? counterMs : 0}
            <span className="ml-1 text-[12px] text-text-muted">/ {totalMs} ms</span>
          </div>
        </div>
        <div className="text-[11.5px] leading-relaxed text-text-muted">
          {!sent
            ? 'Waiting for the envelope to seal…'
            : waiting < 1
              ? 'Network hops are quick; most of the wait is the model reading your prompt (“prefill”).'
              : 'The first token is on its way back. Everything after this streams.'}
        </div>
      </div>
    </div>
  );
}

// ─── Raw JSON (collapsible) ─────────────────────────────────────────────────

function RawJson({ body }: { body: RequestBody | null }) {
  const [open, setOpen] = useState(false);
  const text = useMemo(() => (body ? JSON.stringify(body, null, 2) : ''), [body]);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text"
      >
        <motion.span animate={{ rotate: open ? 0 : -90 }} transition={tween(0.2)} className="inline-flex">
          <ChevronDownIcon width={14} height={14} />
        </motion.span>
        {open ? 'Hide' : 'Show'} raw JSON
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.pre
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.soft}
            className="mono mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-bg-deep/70 p-3 text-[11.5px] leading-relaxed text-text-muted"
          >
            {text}
          </motion.pre>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Scene ──────────────────────────────────────────────────────────────────

function Summary() {
  const c = useStore((s) => s.view.compose);
  const model = useStore((s) => s.view.runStart?.model ?? '–');
  return (
    <SummaryRow>
      <Stat label="model" value={model} />
      <Stat label="body" value={`${c.bytes} B`} />
      {c.sent && <Stat label="to first byte" value={`${c.totalMs} ms`} />}
    </SummaryRow>
  );
}

function Body() {
  const { body, bytes, hops, totalMs, sent, prompt, level } = useStore(
    useShallow((s) => ({
      body: s.view.compose.body,
      bytes: s.view.compose.bytes,
      hops: s.view.compose.hops,
      totalMs: s.view.compose.totalMs,
      sent: s.view.compose.sent,
      prompt: s.view.runStart?.prompt ?? '',
      level: s.explainLevel,
    })),
  );
  const seqBuilt = useStore((s) => (s.view.compose.body ? findSeq('request_built') : null));
  const seqSent = useStore((s) => (s.view.compose.sent ? findSeq('request_sent') : null));
  const pb = useEventProgress(seqBuilt);
  const ps = useEventProgress(seqSent);
  const sending = sent && ps > 0;

  return (
    <div className="space-y-5">
      <Assembly body={body} prompt={prompt} bytes={bytes} p={pb} sent={sending} />
      <Route hops={hops} totalMs={totalMs} sent={sending} p={ps} />
      <div className="flex items-start justify-between gap-6">
        <SceneNote>
          {level === 'math'
            ? 'POST /v1/messages with a JSON body: model id, sampling parameters, and an ordered messages array. stream: true switches the response to server-sent events.'
            : 'Everything the model will know for this run is sealed in this one envelope. The secret API key is added by the proxy, so it never touches your browser.'}
        </SceneNote>
        <RawJson body={body} />
      </div>
    </div>
  );
}

export const ComposeSend: Scene = { Summary, Body };
