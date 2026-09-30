import type { WordClass } from '../sim/lexicon';

/** Hex twins of the CSS tokens, for canvas drawing. */
export const HEX = {
  bg: '#0a0f1f',
  bgDeep: '#060912',
  surface: '#0f1629',
  surface2: '#151d36',
  surface3: '#1c2544',
  line: '#1e2745',
  lineStrong: '#2b365e',
  text: '#e9edf7',
  textMuted: '#8f98b6',
  textFaint: '#5a6488',
  input: '#22d3ee',
  model: '#a78bfa',
  output: '#fbbf24',
  ok: '#34d399',
  warn: '#fb923c',
  danger: '#f87171',
  pink: '#f472b6',
  blue: '#60a5fa',
} as const;

export const CLASS_COLORS: Record<WordClass, string> = {
  punct: '#94a3b8',
  number: HEX.output,
  pronoun: HEX.pink,
  function: HEX.blue,
  proper: HEX.ok,
  piece: HEX.input,
  content: HEX.model,
  special: HEX.danger,
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

export function mix(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const k = Math.max(0, Math.min(1, t));
  const c = a.map((x, i) => Math.round(x + ((b[i] ?? 0) - x) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Negative → pink, zero → surface, positive → cyan. */
export function diverging(v: number, max: number): string {
  const t = Math.max(-1, Math.min(1, v / Math.max(1e-9, max)));
  return t < 0 ? mix(HEX.surface2, HEX.pink, -t) : mix(HEX.surface2, HEX.input, t);
}

/** 0 → surface, 1 → violet → near-white. For attention weights. */
export function sequentialViolet(t: number): string {
  const k = Math.max(0, Math.min(1, t));
  return k < 0.7 ? mix(HEX.surface2, HEX.model, k / 0.7) : mix(HEX.model, '#f5f3ff', (k - 0.7) / 0.3);
}

/** 0 → surface, 1 → amber. For probabilities. */
export function sequentialAmber(t: number): string {
  return mix(HEX.surface2, HEX.output, Math.max(0, Math.min(1, t)));
}
