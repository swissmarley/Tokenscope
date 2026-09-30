import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { easing } from 'maath';
import { useMemo, useRef } from 'react';
import { BufferAttribute, CatmullRomCurve3, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Points, Vector3 } from 'three';
import { useShallow } from 'zustand/shallow';
import { currentProgress } from '../../hooks/useEventProgress';
import { scheduler, useStore } from '../../store/useStore';
import { Label } from '../primitives/Label';
import { SetFrame } from '../primitives/SetFrame';
import { C } from '../theme';

const SLAB_GAP = 1.25;
const SLAB_W = 10;
const SLAB_D = 7;
const BEAM_X = -6.6;
const N_PARTICLES = 220;

function yOf(layer: number): number {
  return 1 + layer * SLAB_GAP;
}

/** Rising particles inside the beam column. */
function BeamParticles({ getTop }: { getTop: () => number }) {
  const ref = useRef<Points>(null);
  const seeds = useMemo(() => Float32Array.from({ length: N_PARTICLES * 3 }, () => Math.random()), []);
  const positions = useMemo(() => new Float32Array(N_PARTICLES * 3), []);
  useFrame((state, dt) => {
    const top = Math.max(0.5, getTop());
    const t = state.clock.elapsedTime;
    const playing = useStore.getState().transport.playing;
    for (let i = 0; i < N_PARTICLES; i++) {
      const s0 = seeds[i * 3] ?? 0;
      const s1 = seeds[i * 3 + 1] ?? 0;
      const s2 = seeds[i * 3 + 2] ?? 0;
      const speed = playing ? 1.4 + s2 * 2 : 0.15;
      const y = ((s1 * top + t * speed) % top) + 0.05;
      const a = s0 * Math.PI * 2 + t * 0.6;
      const r = 0.15 + s2 * 0.35;
      positions[i * 3] = BEAM_X + Math.cos(a) * r;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = ref.current?.geometry;
    if (geo) {
      (geo.attributes.position as BufferAttribute).needsUpdate = true;
    }
    void dt;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.14} color={C.model} transparent opacity={0.9} sizeAttenuation depthWrite={false} />
    </points>
  );
}

/** Set 4: a tower of translucent blocks; the residual stream climbs through them. */
export function LayersSet() {
  const { layers, nHeads, step } = useStore(useShallow((s) => ({ layers: s.view.layers, nHeads: s.view.attention.nHeads || 12, step: s.view.loop.step })));
  const n = layers.nLayers || 12;
  const slabs = useRef<Array<Mesh | null>>([]);
  const beam = useRef<Mesh>(null);
  const beamTop = useRef(0);
  const attnBlock = useRef<Mesh>(null);
  const ffnBlock = useRef<Mesh>(null);
  const inner = useRef<Group>(null);
  const bypass1 = useRef<Mesh>(null);
  const bypass2 = useRef<Mesh>(null);
  const bars = useRef<Array<Mesh | null>>([]);

  const tube = useMemo(() => {
    const mk = (y0: number, y1: number): CatmullRomCurve3 =>
      new CatmullRomCurve3([new Vector3(3.5, y0, 0), new Vector3(6.4, y0 + 0.2, 0.2), new Vector3(6.4, y1 - 0.2, 0.2), new Vector3(3.5, y1, 0)]);
    return { a: mk(-0.35, 0.05), b: mk(0.05, 0.45) };
  }, []);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    const p = currentProgress();
    const cur = layers.current;
    const phase = layers.phase;
    const active = cur !== null && phase !== 'done';
    const sub = phase === 'attention' ? p * 0.5 : phase === 'ffn' ? 0.5 + p * 0.5 : 1;
    const target = active && cur !== null ? yOf(cur) - 0.3 + sub * SLAB_GAP : layers.completed > 0 ? yOf(layers.completed - 1) + 0.6 : 0.3;
    beamTop.current += (target - beamTop.current) * Math.min(1, d * 6);
    if (beam.current) {
      beam.current.scale.y = Math.max(0.01, beamTop.current);
      beam.current.position.y = beamTop.current / 2;
    }
    slabs.current.forEach((m, i) => {
      if (!m) return;
      const mat = m.material as MeshPhysicalMaterial;
      const isActive = active && i === cur;
      const done = i < layers.completed && !isActive;
      const glow = isActive ? 1.6 + 0.4 * Math.sin(state.clock.elapsedTime * 5) : done ? 0.55 : 0.12;
      mat.emissiveIntensity += (glow - mat.emissiveIntensity) * Math.min(1, d * 8);
      mat.opacity += ((isActive ? 0.55 : done ? 0.4 : 0.22) - mat.opacity) * Math.min(1, d * 8);
      easing.damp3(m.scale, isActive ? [1.06, 1.4, 1.06] : [1, 1, 1], 0.2, d);
    });
    if (inner.current) {
      const y = cur !== null ? yOf(cur) : yOf(0);
      easing.damp(inner.current.position, 'y', y, 0.18, d);
      inner.current.visible = cur !== null;
    }
    const a = attnBlock.current?.material as MeshStandardMaterial | undefined;
    const f = ffnBlock.current?.material as MeshStandardMaterial | undefined;
    if (a) a.emissiveIntensity += ((phase === 'attention' ? 2.4 : 0.3) - a.emissiveIntensity) * Math.min(1, d * 10);
    if (f) f.emissiveIntensity += ((phase === 'ffn' ? 2.4 : 0.3) - f.emissiveIntensity) * Math.min(1, d * 10);
    const b1 = bypass1.current?.material as MeshStandardMaterial | undefined;
    const b2 = bypass2.current?.material as MeshStandardMaterial | undefined;
    if (b1) b1.emissiveIntensity += ((phase === 'attention' ? 2.5 : 0.2) - b1.emissiveIntensity) * Math.min(1, d * 10);
    if (b2) b2.emissiveIntensity += ((phase === 'ffn' ? 2.5 : 0.2) - b2.emissiveIntensity) * Math.min(1, d * 10);
    // FFN activation bars: mostly silent units.
    const sample = cur !== null ? layers.ffnByLayer[cur]?.sample : undefined;
    bars.current.forEach((m, i) => {
      if (!m) return;
      const v = sample?.[i] ?? 0;
      const lit = phase === 'ffn' ? i < p * 32 : Boolean(sample);
      easing.damp(m.scale, 'y', Math.max(0.05, lit ? v * 0.6 : 0.05), 0.15, d);
      m.position.y = m.scale.y / 2;
    });
  });

  const pick = (layer: number): void => {
    const i = scheduler.events.findIndex((e) => e.type === 'layer_start' && e.layer === layer && e.step === step);
    if (i >= 0) {
      scheduler.pause();
      scheduler.seekEvent(i);
    }
  };

  return (
    <SetFrame stage="layers" titleY={20} titleZ={-14}>
      {/* residual stream */}
      <mesh position={[BEAM_X, 0.5, 0]}>
        <cylinderGeometry args={[0.06, 0.06, yOf(n) + 0.5, 12]} />
        <meshStandardMaterial color={C.line} transparent opacity={0.6} />
      </mesh>
      <mesh ref={beam} position={[BEAM_X, 0, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 1, 16]} />
        <meshStandardMaterial color={C.model} emissive={C.model} emissiveIntensity={2.5} toneMapped={false} />
      </mesh>
      <BeamParticles getTop={() => beamTop.current} />
      <Label position={[BEAM_X, -0.7, 0]} fontSize={0.3} color={C.faint}>
        residual stream ↑
      </Label>

      {/* slabs */}
      {Array.from({ length: n }, (_, i) => (
        <group key={i} position={[0, yOf(i), 0]}>
          <mesh
            ref={(el) => {
              slabs.current[i] = el;
            }}
            onClick={() => pick(i)}
            onPointerOver={() => {
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = '';
            }}
          >
            <boxGeometry args={[SLAB_W, 0.42, SLAB_D]} />
            <meshPhysicalMaterial color="#1b2452" emissive={C.model} emissiveIntensity={0.12} transparent opacity={0.22} roughness={0.25} metalness={0.4} clearcoat={0.6} />
          </mesh>
          <Label position={[-SLAB_W / 2 - 0.9, 0, SLAB_D / 2]} fontSize={0.3} color={i < layers.completed ? C.text : C.faint}>
            {`L${i + 1}`}
          </Label>
        </group>
      ))}

      {/* inside the active block */}
      <group ref={inner} position={[0, yOf(0), 0]} visible={false}>
        <mesh ref={attnBlock} position={[-2.2, 0.55, 0]}>
          <boxGeometry args={[3.4, 0.5, 3.2]} />
          <meshStandardMaterial color={C.model} emissive={C.model} emissiveIntensity={0.3} transparent opacity={0.85} />
        </mesh>
        <Label position={[-2.2, 1.05, 0]} fontSize={0.26} color={C.text}>
          {`attention · ${nHeads} heads`}
        </Label>
        <mesh ref={ffnBlock} position={[2.2, 0.55, 0]}>
          <boxGeometry args={[3.4, 0.5, 3.2]} />
          <meshStandardMaterial color={C.input} emissive={C.input} emissiveIntensity={0.3} transparent opacity={0.85} />
        </mesh>
        <Label position={[2.2, 1.05, 0]} fontSize={0.26} color={C.text}>
          feed-forward · GELU
        </Label>
        {/* activation bars along the front of the FFN block */}
        <group position={[0.65, 0.82, 1.75]}>
          {Array.from({ length: 32 }, (_, i) => (
            <mesh
              key={i}
              ref={(el) => {
                bars.current[i] = el;
              }}
              position={[i * 0.1, 0, 0]}
            >
              <boxGeometry args={[0.07, 1, 0.07]} />
              <meshStandardMaterial color={C.input} emissive={C.input} emissiveIntensity={1.5} toneMapped={false} />
            </mesh>
          ))}
        </group>
        {/* residual bypass tubes */}
        <mesh ref={bypass1}>
          <tubeGeometry args={[tube.a, 32, 0.07, 10, false]} />
          <meshStandardMaterial color={C.input} emissive={C.input} emissiveIntensity={0.2} toneMapped={false} />
        </mesh>
        <mesh ref={bypass2}>
          <tubeGeometry args={[tube.b, 32, 0.07, 10, false]} />
          <meshStandardMaterial color={C.input} emissive={C.input} emissiveIntensity={0.2} toneMapped={false} />
        </mesh>
        <Label position={[7.2, 0.05, 0]} fontSize={0.24} color={C.faint} rotation={[0, -Math.PI / 2, 0]}>
          residual bypass
        </Label>
        <Line points={[[-2.2, 0.55, 0], [2.2, 0.55, 0]]} color={C.model} lineWidth={1.5} transparent opacity={0.6} />
      </group>

      <Label position={[0, -0.7, 5]} fontSize={0.3} color={C.faint}>
        {`${n} identical blocks · click one to jump · ${layers.seqLen} tokens in flight`}
      </Label>
    </SetFrame>
  );
}
