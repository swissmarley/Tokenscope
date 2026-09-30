import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { CLASS_COLORS, HEX, withAlpha } from '../../../design/colors';
import { springs } from '../../../design/motion';
import { easeOut, useEventProgress, window01 } from '../../../hooks/useEventProgress';
import type { Token } from '../../../pipeline/events';
import { classify, hasLeadingSpace, stripSpace, WORD_CLASS_LABEL } from '../../../sim/lexicon';
import { formatBytes, tokenText } from '../../../sim/tokenize';
import { scheduler, useStore } from '../../../store/useStore';
import { displayText } from '../../common/TokenChip';
import type { Scene } from './index';
import { SceneNote, Stat, SummaryRow } from './shared';

const NO_TOKENS: Token[] = [];

// ─── A span of text that morphs into a chip in place ────────────────────────

function MorphChip({
  token,
  on,
  hot,
  dim,
  onHover,
}: {
  token: Token;
  on: boolean;
  hot: boolean;
  dim: boolean;
  onHover: (i: number | null) => void;
}) {
  const [hover, setHover] = useState(false);
  const cls = classify(token.text);
  const accent = CLASS_COLORS[cls];
  const lit = hot || hover;
  return (
    <motion.span
      layout
      layoutId={`tok-${token.index}`}
      transition={springs.snappy}
      onMouseEnter={() => {
        setHover(true);
        onHover(token.index);
      }}
      onMouseLeave={() => {
        setHover(false);
        onHover(null);
      }}
      className="relative inline-flex flex-col items-center"
      style={{ marginLeft: on ? 3 : 0, marginRight: on ? 3 : 0 }}
    >
      <motion.span
        layout
        animate={{
          paddingLeft: on ? 8 : 0,
          paddingRight: on ? 8 : 0,
          paddingTop: on ? 4 : 0,
          paddingBottom: on ? 4 : 0,
          borderColor: on ? withAlpha(accent, lit ? 0.95 : 0.5) : 'rgba(0,0,0,0)',
          backgroundColor: on ? withAlpha(accent, lit ? 0.24 : 0.11) : 'rgba(0,0,0,0)',
          color: on ? HEX.text : HEX.textFaint,
          opacity: dim ? 0.35 : 1,
          boxShadow: on ? (lit ? `0 0 18px ${withAlpha(accent, 0.45)}` : `0 0 0px ${withAlpha(accent, 0)}`) : 'none',
        }}
        transition={springs.snappy}
        className="mono rounded-chip border text-[13.5px] whitespace-pre"
      >
        {on ? displayText(token.text) : token.text}
      </motion.span>
      <AnimatePresence>
        {on && (
          <motion.span
            initial={{ opacity: 0, y: -8, scale: 0.7 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ ...springs.snappy, delay: 0.08 }}
            className="mono mt-0.5 text-[10px] tabular"
            style={{ color: lit ? accent : HEX.textFaint }}
          >
            {token.id}
          </motion.span>
        )}
      </AnimatePresence>
      {on && hover && (
        <span
          role="tooltip"
          className="glass pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-64 -translate-x-1/2 rounded-lg border border-line px-3 py-2 text-left text-[11px] leading-relaxed whitespace-normal shadow-panel"
        >
          <span className="mono block text-[12px] text-text">
            id <span style={{ color: accent }}>{token.id}</span> · {WORD_CLASS_LABEL[cls]}
          </span>
          <span className="mono block text-text-muted">
            {token.bytes.length} byte{token.bytes.length === 1 ? '' : 's'}: {formatBytes(token.bytes) || '∅'}
          </span>
          {hasLeadingSpace(token.text) && <span className="block text-text-faint">the leading space is part of the token</span>}
        </span>
      )}
    </motion.span>
  );
}

// ─── Insights detected from the real token list ─────────────────────────────

interface Insight {
  id: string;
  title: string;
  body: string;
  indices: number[];
  color: string;
}

function findInsights(tokens: readonly Token[]): Insight[] {
  const out: Insight[] = [];
  let best: number[] = [];
  let run: number[] = [];
  for (const t of tokens) {
    const core = stripSpace(t.text);
    const alpha = /^[A-Za-z]+$/.test(core);
    if (alpha && !hasLeadingSpace(t.text) && run.length > 0) run.push(t.index);
    else if (alpha && (hasLeadingSpace(t.text) || t.index === 0)) run = [t.index];
    else run = [];
    if (run.length > best.length) best = run.slice();
  }
  if (best.length >= 2) {
    const word = best.map((i) => stripSpace(tokens[i]?.text ?? '')).join('');
    out.push({
      id: 'split',
      title: `“${word}” is ${best.length} tokens`,
      body: 'Rare or long words are not in the vocabulary whole, so the tokenizer builds them from pieces it has seen often. Frequent words stay one token.',
      indices: best,
      color: HEX.input,
    });
  }
  const spaced = tokens.filter((t) => hasLeadingSpace(t.text) && stripSpace(t.text).length > 0).map((t) => t.index);
  if (spaced.length > 0) {
    out.push({
      id: 'space',
      title: `${spaced.length} token${spaced.length === 1 ? '' : 's'} carry a leading space`,
      body: 'The space is glued to the word that follows it (shown as ␣). “␣trophy” and “trophy” are different tokens with different IDs.',
      indices: spaced,
      color: HEX.blue,
    });
  }
  const punct = tokens.filter((t) => classify(t.text) === 'punct').map((t) => t.index);
  if (punct.length > 0) {
    out.push({
      id: 'punct',
      title: 'Punctuation gets its own token',
      body: 'Periods, commas and question marks are separate pieces, which is how a model can learn what usually follows a “?”.',
      indices: punct,
      color: CLASS_COLORS.punct,
    });
  }
  const nums = tokens.filter((t) => classify(t.text) === 'number').map((t) => t.index);
  if (nums.length > 0) {
    out.push({
      id: 'number',
      title: 'Numbers split into digit groups',
      body: 'Arithmetic is hard for a language model partly because “1234” can be several unrelated tokens.',
      indices: nums,
      color: HEX.output,
    });
  }
  return out.slice(0, 3);
}

// ─── Vocabulary tape ────────────────────────────────────────────────────────

function VocabTape({ token, vocabSize, accent }: { token: Token | null; vocabSize: number; accent: string }) {
  const rows = useMemo(() => {
    if (!token) return [];
    const ids: number[] = [];
    for (let d = -4; d <= 4; d++) {
      const id = token.id + d;
      if (id >= 0 && id < vocabSize) ids.push(id);
    }
    return ids.map((id) => ({ id, text: tokenText(id) }));
  }, [token, vocabSize]);
  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-bg-deep/60">
      <div className="flex items-baseline justify-between border-b border-line px-3 py-1.5">
        <span className="text-[10.5px] font-semibold tracking-[0.1em] text-text-muted uppercase">Vocabulary lookup</span>
        <span className="mono text-[10px] text-text-faint">{vocabSize.toLocaleString()} entries</span>
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-8 h-6 bg-gradient-to-b from-bg-deep/90 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-bg-deep/90 to-transparent" />
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.table
          key={token?.id ?? 'none'}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={springs.snappy}
          className="mono w-full text-[11.5px]"
        >
          <tbody>
            {rows.map((r) => {
              const isIt = token && r.id === token.id;
              return (
                <tr key={r.id} className={isIt ? 'text-text' : 'text-text-faint'} style={isIt ? { background: withAlpha(accent, 0.12) } : undefined}>
                  <td className="w-16 py-[3px] pr-3 pl-3 text-right tabular">{r.id}</td>
                  <td className="py-[3px] pr-3">
                    <span className="whitespace-pre" style={isIt ? { color: accent } : undefined}>
                      {displayText(r.text)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </motion.table>
      </AnimatePresence>
    </div>
  );
}

// ─── Scene ──────────────────────────────────────────────────────────────────

function useTokenizedSeq(): number | null {
  return useStore((s) => {
    if (!s.view.tokens) return null;
    const i = scheduler.events.findIndex((e) => e.type === 'tokenized');
    return i >= 0 ? i : null;
  });
}

function Summary() {
  const t = useStore((s) => s.view.tokens);
  const tokens = t?.tokens ?? NO_TOKENS;
  return (
    <SummaryRow>
      <Stat label="tokens" value={tokens.length} />
      <Stat label="vocab" value={t ? t.vocabSize.toLocaleString() : '–'} />
      <span className="mono ml-1 inline-flex flex-wrap gap-1 self-center">
        {tokens.slice(0, 14).map((tok) => (
          <span key={tok.index} className="rounded border px-1 text-[10.5px] whitespace-pre text-text-muted" style={{ borderColor: withAlpha(CLASS_COLORS[classify(tok.text)], 0.5) }}>
            {displayText(tok.text)}
          </span>
        ))}
        {tokens.length > 14 && <span className="text-[10.5px] text-text-faint">+{tokens.length - 14}</span>}
      </span>
    </SummaryRow>
  );
}

function Body() {
  const { ev, prompt, level } = useStore(
    useShallow((s) => ({ ev: s.view.tokens, prompt: s.view.runStart?.prompt ?? '', level: s.explainLevel })),
  );
  const seq = useTokenizedSeq();
  const p = useEventProgress(seq);
  const tokens = ev?.tokens ?? NO_TOKENS;
  const n = tokens.length;
  const revealed = Math.min(n, Math.ceil(easeOut(window01(p, 0.05, 0.72)) * n));
  const showInsights = p > 0.8;
  const [hovered, setHovered] = useState<number | null>(null);
  const [insightHover, setInsightHover] = useState<string | null>(null);
  const insights = useMemo(() => findInsights(tokens), [tokens]);
  const highlight = insightHover ? new Set(insights.find((i) => i.id === insightHover)?.indices ?? []) : null;
  const focusToken = hovered !== null ? (tokens[hovered] ?? null) : (tokens[Math.max(0, revealed - 1)] ?? null);
  const focusAccent = focusToken ? CLASS_COLORS[classify(focusToken.text)] : HEX.input;
  const avgChars = n ? (prompt.length / n).toFixed(1) : '–';

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="min-w-0 space-y-4">
        <div className="relative rounded-xl border border-line bg-bg-deep/60 px-4 py-5">
          <div className="pointer-events-none absolute inset-0 grid-bg opacity-50" />
          <div className="relative flex flex-wrap items-start gap-y-3 text-[13.5px] leading-relaxed">
            {tokens.map((t, i) => (
              <MorphChip
                key={t.index}
                token={t}
                on={i < revealed}
                hot={hovered === i || Boolean(highlight?.has(i))}
                dim={Boolean(highlight) && !highlight?.has(i)}
                onHover={setHovered}
              />
            ))}
            {revealed < n && n > 0 && (
              <motion.span
                layout
                className="mono ml-0.5 self-start text-phase-input"
                animate={{ opacity: [1, 0.2, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
              >
                ▍
              </motion.span>
            )}
          </div>
          <div className="mono mt-3 flex items-center gap-3 text-[10.5px] text-text-faint">
            <span>
              cut {revealed} / {n}
            </span>
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
              <motion.span className="block h-full bg-phase-input" animate={{ width: `${(revealed / Math.max(1, n)) * 100}%` }} transition={springs.snappy} />
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Stat label="tokens" value={n} />
          <Stat label="characters" value={prompt.length} />
          <Stat label="chars / token" value={avgChars} />
          <Stat label="hidden (system + template)" value={ev?.hiddenTokenCount ?? 0} />
        </div>

        <AnimatePresence>
          {showInsights && insights.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid gap-2 sm:grid-cols-3">
              {insights.map((ins, i) => (
                <motion.button
                  type="button"
                  key={ins.id}
                  initial={{ opacity: 0, y: 10, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ ...springs.soft, delay: i * 0.1 }}
                  onMouseEnter={() => setInsightHover(ins.id)}
                  onMouseLeave={() => setInsightHover(null)}
                  className="rounded-lg border border-line bg-surface-2/70 p-3 text-left transition-colors hover:border-line-strong"
                  style={{ borderLeftColor: ins.color, borderLeftWidth: 3 }}
                >
                  <div className="text-[12.5px] font-semibold text-text">{ins.title}</div>
                  <div className="mt-1 text-[11.5px] leading-relaxed text-text-muted">{ins.body}</div>
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="space-y-4">
        <VocabTape token={focusToken} vocabSize={ev?.vocabSize ?? 0} accent={focusAccent} />
        <SceneNote>
          {level === 'math'
            ? `Byte-pair encoding: start from UTF-8 bytes, then repeatedly merge the adjacent pair with the highest learned rank until none applies. Output: ${n} ids ∈ [0, ${(ev?.vocabSize ?? 1) - 1}].`
            : 'The model never sees letters, only these IDs. This is GPT-2’s real byte-pair encoder; Claude’s own tokenizer splits text a little differently but works the same way.'}
        </SceneNote>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-text-faint">
          {(['content', 'function', 'pronoun', 'piece', 'proper', 'punct', 'number'] as const).map((c) => (
            <span key={c} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: CLASS_COLORS[c] }} />
              {c === 'piece' ? 'word piece' : c === 'function' ? 'function word' : c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export const Tokenization: Scene = { Summary, Body };
