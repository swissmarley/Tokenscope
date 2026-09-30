import { Vector3 } from 'three';

/** Shared between the Courier (writes) and the CameraRig (reads) each frame. */
export const courierState = {
  active: false,
  /** 0 → 1 through the flight. */
  u: 0,
  pos: new Vector3(),
};
