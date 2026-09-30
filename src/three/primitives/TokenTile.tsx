import { RoundedBox } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { easing } from 'maath';
import { useRef, useState } from 'react';
import { Color, Group, MeshStandardMaterial, Vector3 } from 'three';
import { tileWidth } from '../theme';
import { Label } from './Label';

export interface TileTarget {
  position: [number, number, number];
  scale: number;
  /** 0..1 extra glow (e.g. active token). */
  glow: number;
  rotation?: [number, number, number];
}

interface Props {
  text: string;
  color: string;
  sub?: string;
  /** Read every frame; lets the parent drive dozens of tiles without re-rendering. */
  getTarget: () => TileTarget;
  onHover?: (on: boolean) => void;
  onClick?: () => void;
  smooth?: number;
}

const tmp = new Vector3();

/** A physical token: rounded slab, mono label, id underneath. Springs toward its target each frame. */
export function TokenTile({ text, color, sub, getTarget, onHover, onClick, smooth = 0.28 }: Props) {
  const group = useRef<Group>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const [hover, setHover] = useState(false);
  const w = tileWidth(text);
  const emissive = useRef(new Color(color));

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const t = getTarget();
    tmp.set(t.position[0], t.position[1] + (hover ? 0.35 : 0), t.position[2]);
    easing.damp3(g.position, tmp, smooth, dt);
    const s = t.scale;
    easing.damp3(g.scale, [s, s, s], smooth * 0.8, dt);
    if (t.rotation) easing.dampE(g.rotation, t.rotation, smooth, dt);
    if (mat.current) {
      const target = 0.25 + t.glow * 1.6 + (hover ? 1.2 : 0);
      mat.current.emissiveIntensity += (target - mat.current.emissiveIntensity) * Math.min(1, dt * 10);
    }
  });

  return (
    <group ref={group} scale={0.001}>
      <RoundedBox
        args={[w, 0.72, 0.28]}
        radius={0.1}
        smoothness={4}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          onHover?.(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHover(false);
          onHover?.(false);
          document.body.style.cursor = '';
        }}
        onClick={onClick}
      >
        <meshStandardMaterial ref={mat} color={color} emissive={emissive.current} emissiveIntensity={0.25} roughness={0.35} metalness={0.15} transparent opacity={0.92} />
      </RoundedBox>
      <Label position={[0, 0, 0.16]} fontSize={0.34} color="#0a0f1f">
        {text}
      </Label>
      {sub && (
        <Label position={[0, -0.6, 0.05]} fontSize={0.2} color="#8f98b6">
          {sub}
        </Label>
      )}
    </group>
  );
}
