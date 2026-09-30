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
const autoPos = new Vector3();
const offset = new Vector3();

/**
 * Flies the camera between sets when the stage changes, then hands control
 * to orbit so the viewer can look around. In the fly-through, the camera
 * keeps moving on its own: a slow orbit with a gentle dolly and bob.
 * Honors reduced motion by snapping and skipping the auto moves.
 */
export function CameraRig({ stage, reduced, cinematic }: { stage: StageId | null; reduced: boolean; cinematic: boolean }) {
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
  const autoClock = useRef(0);

  useEffect(() => {
    transition.current = { active: true, since: performance.now() };
    if (reduced) {
      camera.position.copy(desired.position);
      controls.current?.target.copy(desired.target);
      transition.current.active = false;
    }
  }, [desired, reduced, camera]);

  // Starting the fly-through cuts straight to the first set instead of flying back over empty space.
  useEffect(() => {
    if (!cinematic) return;
    autoClock.current = 0;
    camera.position.copy(desired.position);
    controls.current?.target.copy(desired.target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cinematic]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const d = Math.min(dt, 0.05);
    if (cinematic && !reduced) {
      // Auto camera: orbit slowly around the set's target, dolly in and out, bob a little.
      autoClock.current += d;
      const t = autoClock.current;
      const yaw = Math.sin(t * 0.13) * 0.55;
      const radius = 1 + 0.08 * Math.sin(t * 0.07 + 1);
      const bob = 0.8 * Math.sin(t * 0.09);
      offset.copy(desired.position).sub(desired.target);
      offset.applyAxisAngle(new Vector3(0, 1, 0), yaw).multiplyScalar(radius);
      autoPos.copy(desired.target).add(offset).add(new Vector3(0, bob, 0));
      const bias = courierState.active ? Math.sin(courierState.u * Math.PI) * 0.45 : 0;
      look.copy(desired.target).lerp(courierState.pos, bias);
      easing.damp3(camera.position, autoPos, 0.7, d);
      easing.damp3(c.target, look, 0.45, d);
      return;
    }
    if (!transition.current.active) return;
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
      enabled={!cinematic}
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
