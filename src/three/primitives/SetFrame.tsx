import { Float } from '@react-three/drei';
import type { ReactNode } from 'react';
import type { StageId } from '../../pipeline/events';
import { STAGE_BY_ID } from '../../pipeline/stages';
import { C } from '../theme';
import { Label } from './Label';

const PHASE_COLOR = { input: C.input, model: C.model, output: C.output } as const;

/** Common furniture for a set: a floor disc and a title plinth at the back. */
export function SetFrame({ stage, children, radius = 22, titleY = 12, titleZ = -18 }: { stage: StageId; children: ReactNode; radius?: number; titleY?: number; titleZ?: number }) {
  const meta = STAGE_BY_ID[stage];
  const color = PHASE_COLOR[meta.phase];
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <circleGeometry args={[radius, 96]} />
        <meshStandardMaterial color="#0b1225" roughness={0.9} metalness={0.1} transparent opacity={0.85} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <ringGeometry args={[radius - 0.12, radius, 128]} />
        <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.55} />
      </mesh>
      <Float speed={1.2} rotationIntensity={0} floatIntensity={0.4}>
        <group position={[0, titleY, titleZ]}>
          <Label fontSize={0.9} color={color} glow>
            {`${meta.index}  ${meta.title.toUpperCase()}`}
          </Label>
          <Label position={[0, -1.1, 0]} fontSize={0.42} color={C.muted}>
            {meta.blurb}
          </Label>
        </group>
      </Float>
      {children}
    </group>
  );
}

/** A holographic stand-in for a set that is still being built. */
export function Hologram({ color }: { color: string }) {
  return (
    <Float speed={1.5} rotationIntensity={1.2} floatIntensity={1}>
      <mesh position={[0, 4, 0]}>
        <icosahedronGeometry args={[3, 1]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} wireframe transparent opacity={0.5} />
      </mesh>
    </Float>
  );
}
