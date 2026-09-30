import { motion } from 'framer-motion';
import { useState } from 'react';
import { springs } from '../../design/motion';
import { CLASS_COLORS, withAlpha } from '../../design/colors';
import type { Token } from '../../pipeline/events';
import { classify, WORD_CLASS_LABEL } from '../../sim/lexicon';
import { formatBytes } from '../../sim/tokenize';

export function displayText(text: string): string {
  return text.replace(/ /g, '␣').replace(/\n/g, '⏎').replace(/\t/g, '⇥');
}

interface Props {
  token: Token;
  /** Accent (hex). Defaults to the token's word-class colour. */
  color?: string;
  showId?: boolean;
  size?: 'xs' | 'sm' | 'md';
  active?: boolean;
  dim?: boolean;
  layoutId?: string;
  tooltip?: boolean;
  onHover?: (index: number | null) => void;
  onClick?: (index: number) => void;
  /** Extra label shown under the chip instead of the id. */
  sub?: string;
}

const SIZE = {
  xs: 'px-1.5 py-0.5 text-[11px]',
  sm: 'px-2 py-1 text-[12.5px]',
  md: 'px-2.5 py-1.5 text-[14px]',
} as const;

export function TokenChip({
  token,
  color,
  showId = false,
  size = 'md',
  active = false,
  dim = false,
  layoutId,
  tooltip = true,
  onHover,
  onClick,
  sub,
}: Props) {
  const [hover, setHover] = useState(false);
  const cls = classify(token.text);
  const accent = color ?? CLASS_COLORS[cls];
  return (
    <motion.span
      layoutId={layoutId}
      initial={{ opacity: 0, scale: 0.7, y: 6 }}
      animate={{ opacity: dim ? 0.4 : 1, scale: active ? 1.06 : 1, y: 0 }}
      transition={springs.snappy}
      onMouseEnter={() => {
        setHover(true);
        onHover?.(token.index);
      }}
      onMouseLeave={() => {
        setHover(false);
        onHover?.(null);
      }}
      onClick={onClick ? () => onClick(token.index) : undefined}
      className={'relative inline-flex flex-col items-center ' + (onClick ? 'cursor-pointer' : '')}
    >
      <span
        className={`mono rounded-chip border whitespace-pre transition-[box-shadow,background-color] duration-150 ${SIZE[size]}`}
        style={{
          borderColor: withAlpha(accent, active || hover ? 0.9 : 0.45),
          background: withAlpha(accent, active || hover ? 0.22 : 0.1),
          color: 'var(--color-text)',
          boxShadow: active || hover ? `0 0 16px ${withAlpha(accent, 0.35)}` : undefined,
        }}
      >
        {displayText(token.text)}
      </span>
      {(showId || sub) && (
        <span className="mono mt-0.5 text-[10px] tabular text-text-faint">{sub ?? token.id}</span>
      )}
      {tooltip && hover && (
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
          {/^\s/.test(token.text) && <span className="block text-text-faint">leading space is part of the token</span>}
        </span>
      )}
    </motion.span>
  );
}
