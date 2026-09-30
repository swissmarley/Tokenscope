import { Line, RoundedBox, Trail } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { easing } from 'maath';
import { useMemo, useRef } from 'react';
import { CatmullRomCurve3, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { useShallow } from 'zustand/shallow';
import { easeOut, findSeq, progressOf, window01 } from '../../hooks/useEventProgress';
import { useStore } from '../../store/useStore';
import { Label } from '../primitives/Label';
import { SetFrame } from '../primitives/SetFrame';
import { C } from '../theme';

const NODES = [
  { label: 'Browser', sub: 'you', t: 0.06 },
  { label: 'Proxy', sub: 'adds the secret key', t: 0.36 },
  { label: 'API edge', sub: 'auth · routing', t: 0.66 },
  { label: 'Model server', sub: 'GPUs · prefill', t: 0.96 },
];

const STAMP_SLOTS: Array<[number, number, number]> = [
  [-4.2, 1.3, 0.4],
  [-1.4, 1.3, 0.4],
  [1.4, 1.3, 0.4],
  [4.2, 1.3, 0.4],
];

/** Set 1: the envelope is stamped, sealed, and flies the neon track to the model. */
export function SendSet() {
  const { body, prompt, sent, hops, totalMs, bytes } = useStore(
    useShallow((s) => ({
      body: s.view.compose.body,
      prompt: s.view.runStart?.prompt ?? '',
      sent: s.view.compose.sent,
      hops: s.view.compose.hops,
      totalMs: s.view.compose.totalMs,
      bytes: s.view.compose.bytes,
    })),
  );
  const seqBuilt = useMemo(() => (body ? findSeq('request_built') : null), [body]);
  const seqSent = useMemo(() => (sent ? findSeq('request_sent') : null), [sent]);
  const stamps = useMemo(
    () =>
      body
        ? [
            { k: 'model', text: `model: ${body.model}`, color: C.model },
            { k: 'max', text: `max_tokens: ${body.max_tokens}`, color: C.output },
            { k: 'temp', text: `temperature: ${body.temperature}`, color: C.output },
            { k: 'stream', text: 'stream: true', color: C.ok },
          ]
        : [],
    [body],
  );

  const curve = useMemo(
    () =>
      new CatmullRomCurve3([
        new Vector3(0, 3, 0),
        new Vector3(7, 4.2, -2.5),
        new Vector3(15, 3.2, -6),
        new Vector3(23, 4.5, -9.5),
        new Vector3(31, 3.4, -13),
      ]),
    [],
  );
  const trackPts = useMemo(() => curve.getPoints(120), [curve]);

  const envelope = useRef<Group>(null);
  const envMat = useRef<MeshStandardMaterial>(null);
  const packet = useRef<Mesh>(null);
  const stampRefs = useRef<Array<Group | null>>([]);
  const ringRefs = useRef<Array<Mesh | null>>([]);
  const waitRing = useRef<Mesh>(null);
  const frameLine = useRef<Group>(null);
  const counter = useRef({ v: 0 });

  useFrame((state, dt) => {
    const pb = progressOf(seqBuilt);
    const ps = progressOf(seqSent);
    const d = Math.min(dt, 0.05);
    // Stamps snap in one by one.
    const nStamps = Math.floor(easeOut(window01(pb, 0.3, 0.7)) * stamps.length + 0.001);
    stampRefs.current.forEach((g, i) => {
      if (!g) return;
      const on = i < nStamps && ps === 0;
      const slot = STAMP_SLOTS[i] ?? [0, 0, 0];
      easing.damp3(g.position, on ? slot : [slot[0] * 2.4, 6, 4], 0.35, d);
      easing.damp3(g.scale, on ? [1, 1, 1] : [0.001, 0.001, 0.001], 0.25, d);
    });
    // Frame draws around the envelope, then the whole thing seals into a packet.
    if (frameLine.current) frameLine.current.visible = pb > 0.6 && ps === 0;
    const env = envelope.current;
    if (env) {
      const visible = pb > 0.02 && ps < 0.06;
      const s = visible ? 1 : 0.001;
      easing.damp3(env.scale, [s, s, s], 0.25, d);
      if (envMat.current) envMat.current.emissiveIntensity = 0.3 + easeOut(window01(pb, 0.6, 0.95)) * 0.9;
    }
    // Packet flight along the curve.
    const travel = easeOut(window01(ps, 0, 0.55));
    const waiting = window01(ps, 0.55, 1);
    const p = packet.current;
    if (p) {
      p.visible = sent && ps > 0 && ps < 1;
      const pt = curve.getPointAt(Math.min(0.999, travel));
      p.position.copy(pt);
      p.rotation.y += d * 2;
      p.rotation.x += d * 1.2;
    }
    ringRefs.current.forEach((r, i) => {
      if (!r) return;
      const lit = sent && travel >= (NODES[i]?.t ?? 1) - 0.02;
      const m = r.material as MeshStandardMaterial;
      m.emissiveIntensity += ((lit ? 2.2 : 0.15) - m.emissiveIntensity) * Math.min(1, d * 8);
    });
    if (waitRing.current) {
      const on = sent && waiting > 0 && waiting < 1;
      waitRing.current.visible = on;
      const pulse = 1 + 0.25 * Math.sin(state.clock.elapsedTime * 6);
      waitRing.current.scale.setScalar(on ? pulse * (1 + waiting * 0.6) : 0.001);
      (waitRing.current.material as MeshStandardMaterial).opacity = 0.9 - waiting * 0.6;
    }
    counter.current.v = Math.round(ps * totalMs);
  });

  const last = curve.getPointAt(1);

  return (
    <SetFrame stage="compose">
      {/* the envelope */}
      <group ref={envelope} position={[0, 3, 0]} scale={0.001}>
        <RoundedBox args={[11.5, 4.4, 0.35]} radius={0.25} smoothness={4}>
          <meshPhysicalMaterial ref={envMat} color="#0e1a33" emissive={C.input} emissiveIntensity={0.3} roughness={0.2} metalness={0.3} transparent opacity={0.9} clearcoat={1} />
        </RoundedBox>
        {body?.system && (
          <Label position={[0, 1.55, 0.2]} fontSize={0.26} color={C.muted} maxWidth={10.5}>
            {`system · “${body.system}”`}
          </Label>
        )}
        <Label position={[0, 0.25, 0.2]} fontSize={0.36} color={C.text} maxWidth={10.5} textAlign="center" glow>
          {prompt}
        </Label>
        <Label position={[0, -1.7, 0.2]} fontSize={0.22} color={C.input}>
          {`application/json · ${bytes} bytes`}
        </Label>
        <group ref={frameLine} visible={false}>
          <Line
            points={[
              [-5.9, -2.3, 0.22],
              [5.9, -2.3, 0.22],
              [5.9, 2.3, 0.22],
              [-5.9, 2.3, 0.22],
              [-5.9, -2.3, 0.22],
            ]}
            color={C.input}
            lineWidth={2}
            transparent
            opacity={0.9}
          />
        </group>
      </group>
      {/* stamps */}
      {stamps.map((s, i) => (
        <group
          key={s.k}
          ref={(el) => {
            stampRefs.current[i] = el;
          }}
          position={[0, 8, 4]}
          scale={0.001}
        >
          <RoundedBox args={[2.5, 0.6, 0.2]} radius={0.08} rotation={[0, 0, (i % 2 ? 1 : -1) * 0.05]}>
            <meshStandardMaterial color="#0f172a" emissive={s.color} emissiveIntensity={1.1} />
          </RoundedBox>
          <Label position={[0, 0, 0.12]} fontSize={0.2} color={s.color} glow>
            {s.text}
          </Label>
        </group>
      ))}
      {/* the track */}
      <Line points={trackPts} color={C.line} lineWidth={1.5} transparent opacity={0.8} />
      {sent && <Line points={trackPts} color={C.input} lineWidth={1} dashed dashSize={0.5} gapSize={0.6} transparent opacity={0.5} />}
      {NODES.map((n, i) => {
        const pt = curve.getPointAt(n.t);
        return (
          <group key={n.label} position={pt}>
            <mesh
              ref={(el) => {
                ringRefs.current[i] = el;
              }}
              rotation={[0, Math.PI / 2 - Math.atan2(curve.getTangentAt(n.t).z, curve.getTangentAt(n.t).x), 0]}
            >
              <torusGeometry args={[1.5, 0.08, 16, 64]} />
              <meshStandardMaterial color={C.input} emissive={C.input} emissiveIntensity={0.15} toneMapped={false} />
            </mesh>
            <Label position={[0, -2.2, 0]} fontSize={0.42} color={C.text}>
              {n.label}
            </Label>
            <Label position={[0, -2.8, 0]} fontSize={0.24} color={C.faint}>
              {n.sub}
            </Label>
            {hops && i < 3 && (
              <Label position={[0, 2.1, 0]} fontSize={0.24} color={C.muted}>
                {`${hops[i]?.ms ?? '–'} ms`}
              </Label>
            )}
          </group>
        );
      })}
      {/* prefill pulse at the model */}
      <mesh ref={waitRing} position={last} visible={false}>
        <torusGeometry args={[1.8, 0.05, 12, 64]} />
        <meshStandardMaterial color={C.model} emissive={C.model} emissiveIntensity={2.5} transparent toneMapped={false} />
      </mesh>
      {/* the packet with its light trail */}
      <Trail width={1.6} length={7} color={C.input} attenuation={(t) => t * t}>
        <mesh ref={packet} visible={false}>
          <boxGeometry args={[0.7, 0.5, 0.7]} />
          <meshStandardMaterial color={C.input} emissive={C.input} emissiveIntensity={3} toneMapped={false} />
        </mesh>
      </Trail>
      <Label position={[15.5, -0.6, -2]} fontSize={0.3} color={C.faint}>
        {hops ? `time to first byte · ${totalMs} ms` : ''}
      </Label>
    </SetFrame>
  );
}
