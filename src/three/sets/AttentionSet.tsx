import { Billboard, QuadraticBezierLine } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Color, InstancedMesh, Mesh, MeshStandardMaterial, Object3D } from 'three';
import { useShallow } from 'zustand/shallow';
import { displayText } from '../../components/common/TokenChip';
import { easeOut, findSeq, progressOf, window01 } from '../../hooks/useEventProgress';
import { contextTokens } from '../../pipeline/context';
import { classify } from '../../sim/lexicon';
import { useStore } from '../../store/useStore';
import { Label } from '../primitives/Label';
import { SetFrame } from '../primitives/SetFrame';
import { C, CLASS_3D } from '../theme';

const PILLAR_GAP = 1.7;
const PILLAR_H = 1.6;
const TERRAIN_Z0 = -4;
const TERRAIN_ROW = 0.9;
const MAX_H = 4.5;

const dummy = new Object3D();
const tmpColor = new Color();

function violet(t: number): Color {
  const k = Math.max(0, Math.min(1, t));
  return tmpColor.set('#151d36').lerp(new Color(C.model), Math.min(1, k / 0.7)).lerp(new Color('#f5f3ff'), Math.max(0, (k - 0.7) / 0.3));
}

/** The n×n weights as a bar-field: rows recede backwards, one row per query. */
function Terrain({ rows, rowOffset, n, xs, getReveal, focusQ }: { rows: number[][]; rowOffset: number; n: number; xs: number[]; getReveal: () => number; focusQ: number | null }) {
  const mesh = useRef<InstancedMesh>(null);
  const count = rows.length * n;
  const heights = useRef<Float32Array>(new Float32Array(0));
  useEffect(() => {
    heights.current = new Float32Array(count);
  }, [count]);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    const revealed = Math.ceil(getReveal() * rows.length);
    const k = Math.min(1, dt * 7);
    let idx = 0;
    for (let r = 0; r < rows.length; r++) {
      const q = rowOffset + r;
      const row = rows[r] ?? [];
      for (let c = 0; c < n; c++) {
        const w = c <= q && r < revealed ? (row[c] ?? 0) : 0;
        const target = Math.pow(w, 0.7) * MAX_H;
        const h = (heights.current[idx] ?? 0) + (target - (heights.current[idx] ?? 0)) * k;
        heights.current[idx] = h;
        dummy.position.set(xs[c] ?? 0, h / 2, TERRAIN_Z0 - r * TERRAIN_ROW);
        dummy.scale.set(0.7, Math.max(0.02, h), 0.55);
        dummy.updateMatrix();
        m.setMatrixAt(idx, dummy.matrix);
        const dim = focusQ !== null && focusQ !== q;
        const col = violet(w).clone();
        if (dim) col.multiplyScalar(0.35);
        m.setColorAt(idx, col);
        idx++;
      }
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, Math.max(1, count)]} key={count}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#ffffff" emissive="#a78bfa" emissiveIntensity={0.35} roughness={0.4} />
    </instancedMesh>
  );
}

/** Set 5: token pillars, light arcs of attention, and the weight terrain behind. */
export function AttentionSet() {
  const { attention, view, lastEvent, attnLayer, attnHead } = useStore(
    useShallow((s) => ({ attention: s.view.attention, view: s.view, lastEvent: s.view.lastEvent, attnLayer: s.attnLayer, attnHead: s.attnHead })),
  );
  const latest = attention.latest;
  const layer = attnLayer ?? latest?.layer ?? 0;
  const step = latest?.step ?? 0;
  const ev = attention.byKey[`${step}:${layer}`];
  const tokens = useMemo(() => contextTokens(view, step), [view, step]);
  const n = tokens.length;
  const head = Math.min(attnHead, Math.max(0, (ev?.nHeads ?? 1) - 1));
  const rows = ev?.heads[head] ?? [];
  const rowOffset = rows.length === n ? 0 : Math.max(0, n - rows.length);
  const xs = useMemo(() => tokens.map((_, i) => (i - (n - 1) / 2) * PILLAR_GAP), [tokens, n]);
  const seq = useMemo(() => (ev ? findSeq('attention') : null), [ev]);
  const isCurrent = lastEvent?.type === 'attention' && lastEvent.layer === layer && lastEvent.step === step;
  const [hover, setHover] = useState<number | null>(null);
  const pillars = useRef<Array<Mesh | null>>([]);

  // Default focus: the most "interesting" query (largest non-adjacent weight), else the last one.
  const defaultFocus = useMemo(() => {
    let best = -1;
    let bestW = 0.12;
    for (let r = 0; r < rows.length; r++) {
      const q = rowOffset + r;
      const row = rows[r] ?? [];
      for (let k = 1; k < q - 1; k++) {
        const w = row[k] ?? 0;
        if (w > bestW) {
          bestW = w;
          best = q;
        }
      }
    }
    return best >= 0 ? best : rows.length ? rowOffset + rows.length - 1 : null;
  }, [rows, rowOffset]);
  const focusQ = hover ?? defaultFocus;

  const arcs = useMemo(() => {
    const out: Array<{ q: number; k: number; w: number }> = [];
    for (let r = 0; r < rows.length; r++) {
      const q = rowOffset + r;
      const row = rows[r] ?? [];
      for (let k = 0; k < q; k++) {
        const w = row[k] ?? 0;
        if (w > 0.07) out.push({ q, k, w });
      }
    }
    return out;
  }, [rows, rowOffset]);

  const revealRef = useRef(1);
  const pulses = useRef<Array<Mesh | null>>([]);
  useFrame((state, dt) => {
    const p = progressOf(isCurrent ? seq : null);
    revealRef.current = isCurrent && lastEvent && lastEvent.seq === seq ? easeOut(window01(p, 0.1, 0.85)) : 1;
    pillars.current.forEach((m, i) => {
      if (!m) return;
      const mat = m.material as MeshStandardMaterial;
      const w = focusQ !== null ? (rows[focusQ - rowOffset]?.[i] ?? 0) : 0;
      const target = i === focusQ ? 2.2 : 0.4 + w * 4;
      mat.emissiveIntensity += (target - mat.emissiveIntensity) * Math.min(1, dt * 8);
    });
    // Pulses travel along the focused query's strongest arcs.
    const focusArcs = arcs.filter((a) => a.q === focusQ).sort((a, b) => b.w - a.w).slice(0, pulses.current.length);
    pulses.current.forEach((m, i) => {
      if (!m) return;
      const a = focusArcs[i];
      if (!a) {
        m.visible = false;
        return;
      }
      m.visible = true;
      const t = (state.clock.elapsedTime * 0.5 + i * 0.23) % 1;
      const x0 = xs[a.q] ?? 0;
      const x2 = xs[a.k] ?? 0;
      const lift = 1.2 + Math.abs(x0 - x2) * 0.32;
      const mx = (x0 + x2) / 2;
      const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x2;
      const y = (1 - t) * (1 - t) * PILLAR_H + 2 * (1 - t) * t * (PILLAR_H + lift) + t * t * PILLAR_H;
      m.position.set(x, y, 0);
      m.scale.setScalar(0.12 + a.w * 0.25);
    });
  });

  if (!ev) {
    return (
      <SetFrame stage="attention">
        <Label position={[0, 3, 0]} fontSize={0.4} color={C.faint}>
          waiting for the first attention pass…
        </Label>
      </SetFrame>
    );
  }

  return (
    <SetFrame stage="attention">
      {/* pillars */}
      {tokens.map((t, i) => {
        const color = CLASS_3D[classify(t.text)];
        const isFocus = focusQ === i;
        return (
          <group key={t.index} position={[xs[i] ?? 0, 0, 0]}>
            <mesh
              ref={(el) => {
                pillars.current[i] = el;
              }}
              position={[0, PILLAR_H / 2, 0]}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHover(i);
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                setHover(null);
                document.body.style.cursor = '';
              }}
            >
              <cylinderGeometry args={[0.32, 0.38, PILLAR_H, 24]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} roughness={0.3} />
            </mesh>
            <Billboard position={[0, PILLAR_H + 0.55, 0]}>
              <Label fontSize={isFocus ? 0.42 : 0.28} color={isFocus ? C.text : C.muted} glow={isFocus}>
                {displayText(t.text)}
              </Label>
            </Billboard>
          </group>
        );
      })}
      {/* arcs */}
      {arcs.map((a) => {
        const x0 = xs[a.q] ?? 0;
        const x2 = xs[a.k] ?? 0;
        const lift = 1.2 + Math.abs(x0 - x2) * 0.32;
        const focus = focusQ === null || a.q === focusQ;
        return (
          <QuadraticBezierLine
            key={`${a.q}-${a.k}`}
            start={[x0, PILLAR_H, 0]}
            end={[x2, PILLAR_H, 0]}
            mid={[(x0 + x2) / 2, PILLAR_H + lift, 0]}
            color={focus ? (a.w > 0.3 ? '#d8ccff' : C.model) : '#3b3f6b'}
            lineWidth={focus ? 2 + a.w * 12 : 1}
            transparent
            opacity={focus ? 0.45 + a.w * 0.55 : 0.12}
          />
        );
      })}
      {Array.from({ length: 4 }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            pulses.current[i] = el;
          }}
          visible={false}
        >
          <sphereGeometry args={[1, 12, 12]} />
          <meshStandardMaterial color="#ffffff" emissive={C.model} emissiveIntensity={4} toneMapped={false} />
        </mesh>
      ))}
      {/* terrain */}
      <Terrain rows={rows} rowOffset={rowOffset} n={n} xs={xs} getReveal={() => revealRef.current} focusQ={hover} />
      {rows.map((_, r) => {
        const q = rowOffset + r;
        const t = tokens[q];
        return (
          <Label key={r} position={[(xs[0] ?? 0) - 1.4, 0.2, TERRAIN_Z0 - r * TERRAIN_ROW]} fontSize={0.22} color={q === focusQ ? C.text : C.faint} anchorX="right">
            {displayText(t?.text ?? '').slice(0, 9)}
          </Label>
        );
      })}
      <Label position={[0, 0.2, TERRAIN_Z0 - rows.length * TERRAIN_ROW - 1]} fontSize={0.28} color={C.faint}>
        {`terrain: rows = queries, columns = keys · layer ${layer + 1} head ${head + 1} · the future is flat (masked)`}
      </Label>
      <Label position={[0, -0.7, 3.5]} fontSize={0.28} color={C.faint}>
        {focusQ !== null
          ? `“${displayText(tokens[focusQ]?.text ?? '')}” looks back · arc thickness = attention weight · hover a pillar`
          : 'hover a pillar to see where it looks'}
      </Label>
    </SetFrame>
  );
}
