import { Line, RoundedBox } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { easing } from 'maath';
import { useMemo, useRef } from 'react';
import { Group, Mesh, MeshStandardMaterial } from 'three';
import { useShallow } from 'zustand/shallow';
import { displayText } from '../../components/common/TokenChip';
import { currentProgress } from '../../hooks/useEventProgress';
import { useStore } from '../../store/useStore';
import { Label } from '../primitives/Label';
import { SetFrame } from '../primitives/SetFrame';
import { C } from '../theme';

const WIRE_X0 = -16;
const WIRE_X1 = 6;
const WIRE_Y = 2.6;
const PANEL = { x: 13, y: 4.2, z: -1 };

/** Set 9: chunks ride the wire into the chat panel where the text assembles. */
export function StreamSet() {
  const { stream, lastEvent, promptLen } = useStore(useShallow((s) => ({ stream: s.view.stream, lastEvent: s.view.lastEvent, promptLen: s.view.tokens?.tokens.length ?? 0 })));
  const chunks = stream.chunks;
  const done = stream.done;
  const tEnd = Math.max(done?.totalMs ?? 0, chunks[chunks.length - 1]?.t ?? 0, lastEvent?.t ?? 0, 500) * 1.04;
  const xAt = (t: number): number => WIRE_X0 + (t / tEnd) * (WIRE_X1 - WIRE_X0);
  const first = chunks[0];
  const tiles = useRef<Array<Group | null>>([]);
  const cursor = useRef<Mesh>(null);
  const panelMat = useRef<MeshStandardMaterial>(null);
  const gluing = lastEvent?.type === 'detokenized';
  const tps = useMemo(() => {
    if (chunks.length < 2 || !first) return 0;
    const span = (chunks[chunks.length - 1]?.t ?? first.t) - first.t;
    return span > 0 ? ((chunks.length - 1) / span) * 1000 : 0;
  }, [chunks, first]);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    const p = currentProgress();
    tiles.current.forEach((g, i) => {
      if (!g) return;
      const c = chunks[i];
      if (!c) return;
      const isLast = i === chunks.length - 1;
      // The newest chunk hovers on the wire, older ones have flown into the panel.
      const inPanel = !isLast || gluing || Boolean(done);
      const target: [number, number, number] = inPanel ? [PANEL.x, PANEL.y, PANEL.z + 0.4] : [xAt(c.t), WIRE_Y + 0.6, 0];
      easing.damp3(g.position, target, 0.35, d);
      const s = inPanel ? 0.001 : 1;
      easing.damp3(g.scale, [s, s, s], 0.3, d);
    });
    if (cursor.current) cursor.current.visible = !done && Math.sin(state.clock.elapsedTime * 6) > 0;
    if (panelMat.current) panelMat.current.emissiveIntensity = 0.25 + (gluing ? p * 0.8 : 0) + (done ? 0.5 : 0);
  });

  return (
    <SetFrame stage="stream">
      {/* the wire */}
      <Line points={[[WIRE_X0, WIRE_Y, 0], [WIRE_X1, WIRE_Y, 0]]} color={C.line} lineWidth={2} />
      {first && (
        <>
          <Line points={[[WIRE_X0, WIRE_Y, 0], [xAt(first.t), WIRE_Y, 0]]} color={C.input} lineWidth={4} transparent opacity={0.9} />
          <Label position={[(WIRE_X0 + xAt(first.t)) / 2, WIRE_Y + 0.9, 0]} fontSize={0.26} color={C.input}>
            {`waiting ${first.t} ms (prefill)`}
          </Label>
        </>
      )}
      {chunks.map((c, i) => (
        <group key={c.seq} position={[xAt(c.t), WIRE_Y, 0]}>
          <mesh>
            <sphereGeometry args={[i === chunks.length - 1 ? 0.22 : 0.13, 12, 12]} />
            <meshStandardMaterial color={C.output} emissive={C.output} emissiveIntensity={2} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {chunks.map((c, i) => (
        <group
          key={`tile-${c.seq}`}
          ref={(el) => {
            tiles.current[i] = el;
          }}
          position={[xAt(c.t), WIRE_Y + 0.6, 0]}
          scale={0.001}
        >
          <RoundedBox args={[Math.max(0.9, c.text.length * 0.3 + 0.4), 0.6, 0.2]} radius={0.08}>
            <meshStandardMaterial color="#1a1400" emissive={C.output} emissiveIntensity={1.4} />
          </RoundedBox>
          <Label position={[0, 0, 0.12]} fontSize={0.28} color={C.text}>
            {displayText(c.text)}
          </Label>
        </group>
      ))}
      <Label position={[WIRE_X0, WIRE_Y - 0.7, 0]} fontSize={0.22} color={C.faint} anchorX="left">
        0 ms
      </Label>
      <Label position={[WIRE_X1, WIRE_Y - 0.7, 0]} fontSize={0.22} color={C.faint} anchorX="right">
        {`${Math.round(tEnd)} ms`}
      </Label>

      {/* the chat panel */}
      <group position={[PANEL.x, PANEL.y, PANEL.z]}>
        <RoundedBox args={[13, 7.2, 0.4]} radius={0.35} smoothness={4}>
          <meshPhysicalMaterial ref={panelMat} color="#1a1607" emissive={C.output} emissiveIntensity={0.25} transparent opacity={0.92} roughness={0.3} clearcoat={0.8} />
        </RoundedBox>
        <Label position={[-6, 3.05, 0.25]} fontSize={0.24} color={C.output} anchorX="left">
          ASSISTANT
        </Label>
        <Label
          position={[-6, 2.6, 0.25]}
          fontSize={Math.max(0.17, Math.min(0.36, 0.36 * Math.sqrt(420 / Math.max(420, stream.text.length))))}
          color={C.text}
          anchorX="left"
          anchorY="top"
          maxWidth={12}
          textAlign="left"
          lineHeight={1.4}
        >
          {stream.text || '…'}
        </Label>
        <mesh ref={cursor} position={[5.8, -3, 0.25]}>
          <planeGeometry args={[0.16, 0.5]} />
          <meshBasicMaterial color={C.output} toneMapped={false} />
        </mesh>
      </group>

      {/* stats */}
      {[
        { label: 'time to first token', value: `${first?.t ?? 0} ms`, x: -12 },
        { label: 'tokens / second', value: (done ? done.tokensPerSec : tps).toFixed(1), x: -4 },
        { label: 'tokens in → out', value: `${done ? done.usage.input : promptLen} → ${done ? done.usage.output : chunks.length}`, x: 4 },
      ].map((s) => (
        <group key={s.label} position={[s.x, 7.2, -2]}>
          <Label fontSize={0.85} color={C.output} glow>
            {s.value}
          </Label>
          <Label position={[0, -0.75, 0]} fontSize={0.24} color={C.muted}>
            {s.label}
          </Label>
        </group>
      ))}
      {done && (
        <Label position={[PANEL.x, 8.4, -2]} fontSize={0.34} color={C.ok} glow>
          {`done · ${done.stopReason}`}
        </Label>
      )}
      <Label position={[-5, -0.6, 3]} fontSize={0.28} color={C.faint}>
        each dot is one server-sent event · the tile is the newest chunk · IDs decode back to text with the same table that split your message
      </Label>
    </SetFrame>
  );
}
