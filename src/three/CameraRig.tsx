import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { easing } from 'maath';
import { useEffect, useMemo, useRef } from 'react';
import { Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { StageId } from '../pipeline/events';
import { courierState } from './courierState';
import { POSES, STAGE_X } from './theme';

const look = new Vector3();

/**
 * Flies the camera between sets when the stage changes, then hands control
 * to orbit so the viewer can look around. Honors reduced motion by snapping.
 */
export function CameraRig({ stage, reduced }: { stage: StageId | null; reduced: boolean }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const s = stage ?? 'compose';
  const desired = useMemo(() => {
    const p = POSES[s];
    const x = STAGE_X[s];
    return {
      position: new Vector3(p.position[0] + x, p.position[1], p.position[2]),
      target: new Vector3(p.target[0] + x, p.target[1], p.target[2]),
    };
  }, [s]);
  const transition = useRef({ active: true, since: 0 });

  useEffect(() => {
    transition.current = { active: true, since: performance.now() };
    if (reduced) {
      camera.position.copy(desired.position);
      controls.current?.target.copy(desired.target);
      transition.current.active = false;
    }
  }, [desired, reduced, camera]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c || !transition.current.active) return;
    const d = Math.min(dt, 0.05);
    // While the courier is in the air, the camera glances toward it so the hand-off reads.
    const bias = courierState.active ? Math.sin(courierState.u * Math.PI) * 0.45 : 0;
    look.copy(desired.target).lerp(courierState.pos, bias);
    easing.damp3(camera.position, desired.position, 0.75, d);
    easing.damp3(c.target, look, 0.45, d);
    const settled = camera.position.distanceTo(desired.position) < 0.05 && c.target.distanceTo(desired.target) < 0.05;
    if (settled && performance.now() - transition.current.since > 700 && !courierState.active) transition.current.active = false;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.6}
      minDistance={6}
      maxDistance={80}
      maxPolarAngle={Math.PI * 0.49}
    />
  );
}
