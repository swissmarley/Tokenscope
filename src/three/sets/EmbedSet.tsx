import { Billboard, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { easing } from 'maath';
import { useMemo, useRef, useState } from 'react';
import { BufferAttribute, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { useShallow } from 'zustand/shallow';
import { easeOut, findSeq, progressOf, window01 } from '../../hooks/useEventProgress';
import type { Token } from '../../pipeline/events';
import { classify } from '../../sim/lexicon';
import { pca3d } from '../../sim/pca';
import { useStore } from '../../store/useStore';
import { displayText } from '../../components/common/TokenChip';
import { Label } from '../primitives/Label';
import { SetFrame } from '../primitives/SetFrame';
import { C, CLASS_3D } from '../theme';
import { layoutRows } from './TokenizeSet';

const NO_TOKENS: Token[] = [];
const SPREAD = 8;
const LIFT = 6;

/** The positional signal as a rippling floor: superposed sines of falling frequency. */
function WaveFloor({ getPhase }: { getPhase: () => number }) {
  const mesh = useRef<Mesh>(null);
  const geo = useMemo(() => new PlaneGeometry(44, 26, 110, 66), []);
  const base = useMemo(() => (geo.attributes.position as BufferAttribute).array.slice(), [geo]);
  useFrame((state) => {
    const m = mesh.current;
    if (!m) return;
    const phase = getPhase();
    const pos = geo.attributes.position as BufferAttribute;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3] ?? 0;
      const y = base[i * 3 + 1] ?? 0;
      const z = phase * (0.35 * Math.sin(x * 0.9 + t * 1.2) + 0.25 * Math.sin(x * 0.35 - t * 0.6 + y * 0.2) + 0.15 * Math.sin(y * 0.8 + t));
      pos.setZ(i, z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    (m.material as MeshStandardMaterial).emissiveIntensity = 0.15 + phase * 0.5;
  });
  return (
    <mesh ref={mesh} geometry={geo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      <meshStandardMaterial color="#0d1730" emissive={C.input} emissiveIntensity={0.15} wireframe transparent opacity={0.45} />
    </mesh>
  );
}

/** Set 3: tiles fly into a 3-D PCA cloud above the positional wave. */
export function EmbedSet() {
  const { emb, tokens } = useStore(useShallow((s) => ({ emb: s.view.embedding, tokens: s.view.tokens?.tokens ?? NO_TOKENS })));
  const seq = useMemo(() => (emb ? findSeq('embedded') : null), [emb]);
  const cloud = useMemo(() => (emb ? pca3d(emb.vectors) : []), [emb]);
  const start = useMemo(() => layoutRows(tokens, 3, 10, 0.3, 1.2), [tokens]);
  const groups = useRef<Array<Group | null>>([]);
  const lines = useRef<Array<Group | null>>([]);
  const phaseRef = useRef(0);
  const [hovered, setHovered] = useState<number | null>(null);

  useFrame((_, dt) => {
    const p = progressOf(seq);
    const fly = easeOut(window01(p, 0.05, 0.6));
    phaseRef.current = easeOut(window01(p, 0.45, 0.8));
    const d = Math.min(dt, 0.05);
    groups.current.forEach((g, i) => {
      if (!g) return;
      const c = cloud[i];
      const s = start[i];
      if (!c || !s) return;
      const local = Math.min(1, Math.max(0, fly * (cloud.length + 3) - i * 0.6));
      const tx = s[0] + (c[0] * SPREAD - s[0]) * local;
      const ty = s[1] + (LIFT + c[1] * 4.5 - s[1]) * local;
      const tz = s[2] + (c[2] * SPREAD * 0.7 - s[2]) * local;
      easing.damp3(g.position, [tx, ty, tz], 0.3, d);
      const sc = p > 0.02 ? 1 : 0.001;
      easing.damp3(g.scale, [sc, sc, sc], 0.3, d);
      const ln = lines.current[i];
      if (ln) {
        ln.position.set(g.position.x, 0, g.position.z);
        ln.scale.y = Math.max(0.001, g.position.y);
        ln.visible = local > 0.8;
      }
    });
  });

  return (
    <SetFrame stage="embed">
      <WaveFloor getPhase={() => phaseRef.current} />
      {tokens.map((t, i) => {
        const color = CLASS_3D[classify(t.text)];
        const hot = hovered === i;
        return (
          <group key={t.index}>
            <group
              ref={(el) => {
                groups.current[i] = el;
              }}
              position={start[i] ?? [0, 3, 10]}
              scale={0.001}
            >
              <mesh
                onPointerOver={(e) => {
                  e.stopPropagation();
                  setHovered(i);
                }}
                onPointerOut={() => setHovered(null)}
              >
                <sphereGeometry args={[hot ? 0.42 : 0.3, 24, 24]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hot ? 3 : 1.4} toneMapped={false} />
              </mesh>
              <mesh>
                <sphereGeometry args={[0.7, 16, 16]} />
                <meshBasicMaterial color={color} transparent opacity={hot ? 0.28 : 0.1} depthWrite={false} />
              </mesh>
              <Billboard position={[0, 0.75, 0]}>
                <Label fontSize={hot ? 0.42 : 0.3} color={hot ? C.text : C.muted}>
                  {displayText(t.text)}
                </Label>
              </Billboard>
            </group>
            <group
              ref={(el) => {
                lines.current[i] = el;
              }}
              visible={false}
            >
              <Line points={[[0, 0, 0], [0, 1, 0]]} color={color} lineWidth={1} transparent opacity={0.25} />
            </group>
          </group>
        );
      })}
      {emb && (
        <group position={[0, 0.6, 14]}>
          <Label fontSize={0.3} color={C.faint}>
            {`x = E[id] + P[pos]  ·  d = ${emb.dims}  ·  cloud = 3 principal components of the rows  ·  floor = the position signal`}
          </Label>
        </group>
      )}
      <Line points={[[-SPREAD - 2, LIFT, 0], [SPREAD + 2, LIFT, 0]]} color={C.line} lineWidth={1} transparent opacity={0.5} />
      <Line points={[[0, LIFT, -SPREAD], [0, LIFT, SPREAD]]} color={C.line} lineWidth={1} transparent opacity={0.5} />
      <Label position={[SPREAD + 3.2, LIFT, 0]} fontSize={0.26} color={C.faint}>
        PC1
      </Label>
      <Label position={[0, LIFT, SPREAD + 1.2]} fontSize={0.26} color={C.faint}>
        PC3
      </Label>
    </SetFrame>
  );
}
