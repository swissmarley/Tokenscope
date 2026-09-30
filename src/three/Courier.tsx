import { RoundedBox, Trail } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { displayText } from '../components/common/TokenChip';
import type { StageId } from '../pipeline/events';
import { STAGE_BY_ID, stageIndex } from '../pipeline/stages';
import { useStore } from '../store/useStore';
import { courierState } from './courierState';
import { Label } from './primitives/Label';
import { C, STAGE_X, tileWidth } from './theme';

const FLIGHT_MS = 1700;
const PHASE_COLOR = { input: C.input, model: C.model, output: C.output } as const;

interface Flight {
  from: StageId;
  to: StageId;
  start: number;
  text: string;
  color: string;
  p0: Vector3;
  p1: Vector3;
  p2: Vector3;
}

/** What the data "is" when it arrives at a set. */
function cargoFor(to: StageId): { text: string; color: string } {
  const v = useStore.getState().view;
  const first = v.tokens?.tokens[0];
  const firstText = first ? displayText(first.text) : '…';
  const lastIt = v.loop.iterations[v.loop.step];
  const sampledText = lastIt?.sampled ? displayText(lastIt.sampled.token.text) : firstText;
  const gen = v.stream.chunks[v.stream.chunks.length - 1];
  const color = PHASE_COLOR[STAGE_BY_ID[to].phase];
  switch (to) {
    case 'compose':
      return { text: '{ json }', color };
    case 'tokenize':
      return { text: '{ json }', color };
    case 'embed':
      return { text: firstText, color };
    case 'layers':
      return { text: `x[0..${Math.max(0, (v.tokens?.tokens.length ?? 1) - 1)}]`, color };
    case 'attention':
      return { text: 'Q · K · V', color };
    case 'kvcache':
      return { text: 'K, V', color };
    case 'sample':
      return { text: 'h_L', color };
    case 'loop':
      return { text: sampledText, color };
    case 'stream':
      return { text: gen ? displayText(gen.text) : sampledText, color };
  }
}

const easeInOut = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const tmp = new Vector3();

/** A glowing token that carries the data from one set to the next while the camera flies. */
export function Courier({ stage }: { stage: StageId }) {
  const prev = useRef(stage);
  const flight = useRef<Flight | null>(null);
  const group = useRef<Group>(null);
  const body = useRef<Mesh>(null);
  const [cargo, setCargo] = useState<{ text: string; color: string }>({ text: '', color: C.input });

  useEffect(() => {
    if (prev.current === stage) return;
    const from = prev.current;
    prev.current = stage;
    const forward = stageIndex(stage) > stageIndex(from);
    const c = cargoFor(stage);
    const x0 = STAGE_X[from] + (forward ? 18 : -18);
    const x2 = STAGE_X[stage] + (forward ? -18 : 18);
    flight.current = {
      from,
      to: stage,
      start: performance.now(),
      text: c.text,
      color: c.color,
      p0: new Vector3(x0, 4, -6),
      p1: new Vector3((x0 + x2) / 2, 15 + Math.min(20, Math.abs(x2 - x0) * 0.08), -10),
      p2: new Vector3(x2, 4, -6),
    };
    setCargo(c);
  }, [stage]);

  useFrame((_, dt) => {
    const g = group.current;
    const f = flight.current;
    if (!g) return;
    if (!f) {
      g.visible = false;
      courierState.active = false;
      return;
    }
    const u = Math.min(1, (performance.now() - f.start) / FLIGHT_MS);
    const t = easeInOut(u);
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    tmp.set(
      a * f.p0.x + b * f.p1.x + c * f.p2.x,
      a * f.p0.y + b * f.p1.y + c * f.p2.y,
      a * f.p0.z + b * f.p1.z + c * f.p2.z,
    );
    g.visible = true;
    g.position.copy(tmp);
    courierState.active = true;
    courierState.u = u;
    courierState.pos.copy(tmp);
    // pop in, sail, pop out
    const s = Math.min(1, u * 6) * Math.min(1, (1 - u) * 6) * 2.6;
    g.scale.setScalar(Math.max(0.001, s));
    g.rotation.y = Math.sin(u * Math.PI * 2) * 0.35;
    g.rotation.z = Math.sin(u * Math.PI) * 0.12;
    void dt;
    if (body.current) {
      const m = body.current.material as MeshStandardMaterial;
      m.emissiveIntensity = 1.8 + Math.sin(u * Math.PI) * 2.2;
    }
    if (u >= 1) {
      flight.current = null;
      courierState.active = false;
    }
  });

  const w = tileWidth(cargo.text);
  return (
    <group ref={group} visible={false}>
      <Trail width={3.2} length={14} color={cargo.color} attenuation={(x) => x * x}>
        <RoundedBox ref={body} args={[w, 0.72, 0.3]} radius={0.12} smoothness={4}>
          <meshStandardMaterial color="#0a0f1f" emissive={cargo.color} emissiveIntensity={2} toneMapped={false} />
        </RoundedBox>
      </Trail>
      <Label position={[0, 0, 0.17]} fontSize={0.34} color={cargo.color} glow>
        {cargo.text}
      </Label>
      {/* halo */}
      <mesh>
        <sphereGeometry args={[Math.max(1.1, w * 0.75), 24, 24]} />
        <meshBasicMaterial color={cargo.color} transparent opacity={0.16} depthWrite={false} toneMapped={false} />
      </mesh>
      <pointLight intensity={220} color={cargo.color} distance={26} decay={2} />
    </group>
  );
}
