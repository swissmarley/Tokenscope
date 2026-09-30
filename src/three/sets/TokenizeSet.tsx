import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import { Mesh, MeshBasicMaterial } from 'three';
import { useShallow } from 'zustand/shallow';
import { easeOut, findSeq, progressOf, window01 } from '../../hooks/useEventProgress';
import type { Token } from '../../pipeline/events';
import { classify } from '../../sim/lexicon';
import { useStore } from '../../store/useStore';
import { displayText } from '../../components/common/TokenChip';
import { Label } from '../primitives/Label';
import { SetFrame } from '../primitives/SetFrame';
import { TokenTile, type TileTarget } from '../primitives/TokenTile';
import { C, CLASS_3D, tileWidth } from '../theme';

const NO_TOKENS: Token[] = [];
const ROW_W = 24;

/**
 * Lay tiles out in centred rows. Rows stack *upward* from `y` (the last row
 * sits at `y`), so long sequences never sink below the floor.
 */
export function layoutRows(tokens: readonly Token[], y: number, z: number, gap = 0.35, rowGap = 1.5, rowWidth = ROW_W): Array<[number, number, number]> {
  const rows: Array<Array<{ i: number; w: number }>> = [[]];
  let x = 0;
  tokens.forEach((t, i) => {
    const w = tileWidth(displayText(t.text));
    if (x + w > rowWidth && rows[rows.length - 1]!.length > 0) {
      rows.push([]);
      x = 0;
    }
    rows[rows.length - 1]!.push({ i, w });
    x += w + gap;
  });
  const out: Array<[number, number, number]> = [];
  const nRows = rows.length;
  rows.forEach((row, r) => {
    const width = row.reduce((s, c) => s + c.w, 0) + gap * (row.length - 1);
    let cx = -width / 2;
    for (const c of row) {
      out[c.i] = [cx + c.w / 2, y + (nRows - 1 - r) * rowGap, z];
      cx += c.w + gap;
    }
  });
  return out;
}

/** Set 2: the sentence shatters into physical tiles. */
export function TokenizeSet() {
  const { ev, prompt } = useStore(useShallow((s) => ({ ev: s.view.tokens, prompt: s.view.runStart?.prompt ?? '' })));
  const tokens = ev?.tokens ?? NO_TOKENS;
  const seq = useMemo(() => (ev ? findSeq('tokenized') : null), [ev]);
  const positions = useMemo(() => layoutRows(tokens, 1.6, 0), [tokens]);
  const revealed = useRef(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const rawText = useRef<Mesh>(null);

  useFrame(() => {
    const p = progressOf(seq);
    revealed.current = Math.ceil(easeOut(window01(p, 0.05, 0.75)) * tokens.length);
    const m = rawText.current?.material as MeshBasicMaterial | undefined;
    if (m) m.opacity = Math.max(0, 1 - window01(p, 0, 0.25) * 1.2);
  });

  const hoveredToken = hovered !== null ? tokens[hovered] : undefined;

  return (
    <SetFrame stage="tokenize">
      <Label ref={rawText} position={[0, 7.2, -1]} fontSize={0.5} color={C.text} maxWidth={24} textAlign="center">
        {prompt}
      </Label>
      {tokens.map((t, i) => {
        const pos = positions[i] ?? [0, 3, 0];
        const color = CLASS_3D[classify(t.text)];
        const getTarget = (): TileTarget => {
          const on = i < revealed.current;
          return { position: on ? pos : [pos[0], 7.2, -1], scale: on ? 1 : 0.001, glow: hovered === i ? 1 : 0 };
        };
        return (
          <TokenTile
            key={t.index}
            text={displayText(t.text)}
            sub={String(t.id)}
            color={color}
            getTarget={getTarget}
            onHover={(on) => setHovered(on ? i : null)}
          />
        );
      })}
      {hoveredToken && (
        <group position={[0, -1.4, 2]}>
          <Label fontSize={0.34} color={C.text}>
            {`“${displayText(hoveredToken.text)}”  ·  id ${hoveredToken.id}  ·  ${hoveredToken.bytes.length} bytes  ·  ${classify(hoveredToken.text)}`}
          </Label>
        </group>
      )}
      <Label position={[0, -2.4, 2]} fontSize={0.28} color={C.faint}>
        {ev ? `${tokens.length} tokens · vocabulary of ${ev.vocabSize.toLocaleString()} · ${ev.tokenizer}` : ''}
      </Label>
    </SetFrame>
  );
}
