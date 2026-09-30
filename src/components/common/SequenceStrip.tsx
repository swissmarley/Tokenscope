import { motion } from 'framer-motion';
import { HEX, withAlpha } from '../../design/colors';
import { springs } from '../../design/motion';
import type { Token } from '../../pipeline/events';
import { displayText } from './TokenChip';

/** Prompt tokens (cyan) followed by generated tokens (amber): the model's growing input. */
export function SequenceStrip({
  prompt,
  generated,
  highlightLast = false,
  size = 'sm',
  maxPrompt = 40,
}: {
  prompt: readonly Token[];
  generated: readonly Token[];
  highlightLast?: boolean;
  size?: 'xs' | 'sm';
  maxPrompt?: number;
}) {
  const cls = size === 'xs' ? 'px-1 py-0.5 text-[10.5px]' : 'px-1.5 py-0.5 text-[12px]';
  const shownPrompt = prompt.length > maxPrompt ? prompt.slice(prompt.length - maxPrompt) : prompt;
  return (
    <div className="mono flex flex-wrap items-center gap-1">
      {prompt.length > maxPrompt && <span className="text-[10px] text-text-faint">…{prompt.length - maxPrompt} more</span>}
      {shownPrompt.map((t) => (
        <span key={`p${t.index}`} className={`rounded border whitespace-pre ${cls}`} style={{ borderColor: withAlpha(HEX.input, 0.35), background: withAlpha(HEX.input, 0.08), color: HEX.textMuted }}>
          {displayText(t.text)}
        </span>
      ))}
      {generated.map((t, i) => {
        const last = highlightLast && i === generated.length - 1;
        return (
          <motion.span
            key={`g${t.index}`}
            layoutId={`seq-${t.index}`}
            initial={{ opacity: 0, scale: 0.6, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={springs.snappy}
            className={`rounded border whitespace-pre ${cls}`}
            style={{
              borderColor: withAlpha(HEX.output, last ? 1 : 0.5),
              background: withAlpha(HEX.output, last ? 0.3 : 0.12),
              color: HEX.text,
              boxShadow: last ? `0 0 14px ${withAlpha(HEX.output, 0.45)}` : undefined,
            }}
          >
            {displayText(t.text)}
          </motion.span>
        );
      })}
    </div>
  );
}
