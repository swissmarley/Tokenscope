import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, InstancedMesh, Mesh, MeshStandardMaterial, Object3D } from 'three';
import { useShallow } from 'zustand/shallow';
import { currentProgress, easeOut } from '../../hooks/useEventProgress';
import { useStore } from '../../store/useStore';
import { Label } from '../primitives/Label';
import { SetFrame } from '../primitives/SetFrame';
import { C } from '../theme';

const CELL = 0.85;
const ROW = 1.3;
const dummy = new Object3D();
const colK = new Color(C.model);
const colV = new Color(C.input);
const colD = new Color(C.output);
const colDim = new Color('#1d2749');

/** Set 6: the cache as a physical grid — K tiles over V tiles, one row per layer. */
export function KVSet() {
  const { kv, promptLen, lastEvent, dModel } = useStore(
    useShallow((s) => ({
      kv: s.view.kv,
      promptLen: s.view.tokens?.tokens.length ?? 0,
      lastEvent: s.view.lastEvent,
      dModel: (s.view.attention.nHeads * s.view.attention.dHead) || 768,
    })),
  );
  const nLayers = kv.nLayers || 12;
  const cols = Math.max(1, promptLen, ...Object.values(kv.perLayer));
  const count = nLayers * cols * 2;
  const mesh = useRef<InstancedMesh>(null);
  const scales = useRef(new Float32Array(0));
  useEffect(() => {
    scales.current = new Float32Array(count);
  }, [count]);
  const x0 = -((cols - 1) * CELL) / 2;
  const z0 = -((nLayers - 1) * ROW) / 2;
  const isKvEvent = lastEvent?.type === 'kv_cache_update';
  const sweep = useRef<Mesh>(null);
  const counterRef = useRef<Mesh>(null);
  const shown = useRef(0);

  useFrame((state, dt) => {
    const m = mesh.current;
    if (!m) return;
    const p = currentProgress();
    const k = Math.min(1, dt * 8);
    let idx = 0;
    for (let l = 0; l < nLayers; l++) {
      const filled = kv.perLayer[l] ?? 0;
      const latestHere = isKvEvent && kv.latest?.layer === l;
      for (let c = 0; c < cols; c++) {
        let on = c < filled;
        let local = 1;
        if (latestHere && kv.latest) {
          const j = kv.latest.positions.indexOf(c);
          if (j >= 0) {
            local = easeOut(Math.min(1, Math.max(0, p * (kv.latest.positions.length + 2) - j)));
            on = local > 0;
          }
        }
        const decode = c >= promptLen;
        for (let kvi = 0; kvi < 2; kvi++) {
          const target = on ? local : 0;
          const s = (scales.current[idx] ?? 0) + (target - (scales.current[idx] ?? 0)) * k;
          scales.current[idx] = s;
          dummy.position.set(x0 + c * CELL, kvi === 0 ? 0.62 : 0.2, z0 + l * ROW);
          dummy.rotation.set((1 - s) * Math.PI * 0.5, 0, 0);
          dummy.scale.set(0.72 * Math.max(0.001, s), 0.24, 0.72 * Math.max(0.001, s));
          dummy.updateMatrix();
          m.setMatrixAt(idx, dummy.matrix);
          const base = decode ? colD : kvi === 0 ? colK : colV;
          m.setColorAt(idx, on ? base : colDim);
          idx++;
        }
      }
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    // Decode read-sweep: the newest column pulses and a bar scans the row of cached keys.
    const sw = sweep.current;
    if (sw) {
      const decode = kv.latest?.phase === 'decode';
      sw.visible = decode;
      if (decode && kv.latest) {
        const l = kv.latest.layer;
        const t = (state.clock.elapsedTime * 1.4) % 1;
        sw.position.set(x0 + t * (cols - 1) * CELL, 0.45, z0 + l * ROW);
        (sw.material as MeshStandardMaterial).opacity = 0.35 + 0.35 * Math.sin(t * Math.PI);
      }
    }
    shown.current += (kv.computeSaved - shown.current) * Math.min(1, dt * 4);
    if (counterRef.current) counterRef.current.scale.setScalar(1 + 0.03 * Math.sin(state.clock.elapsedTime * 3));
  });

  const bytesKb = Math.round((nLayers * kv.cachedTokens * 2 * dModel * 2) / 1024);
  const labels = useMemo(() => Array.from({ length: nLayers }, (_, l) => l), [nLayers]);

  return (
    <SetFrame stage="kvcache">
      <instancedMesh ref={mesh} args={[undefined, undefined, Math.max(1, count)]} key={count} position={[0, 0, 0]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.35} roughness={0.35} metalness={0.2} />
      </instancedMesh>
      <mesh ref={sweep} visible={false}>
        <boxGeometry args={[0.9, 0.9, 1.1]} />
        <meshStandardMaterial color={C.output} emissive={C.output} emissiveIntensity={2} transparent opacity={0.5} toneMapped={false} depthWrite={false} />
      </mesh>
      {labels.map((l) => (
        <Label key={l} position={[x0 - 1.2, 0.4, z0 + l * ROW]} fontSize={0.26} color={(kv.perLayer[l] ?? 0) > 0 ? C.text : C.faint} anchorX="right">
          {`L${l + 1}`}
        </Label>
      ))}
      {cols > promptLen && (
        <group position={[x0 + (promptLen - 0.5) * CELL, 0.05, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.04, nLayers * ROW + 1]} />
            <meshBasicMaterial color={C.output} toneMapped={false} transparent opacity={0.8} />
          </mesh>
          <Label position={[0.2, 0.9, z0 - 1.2]} fontSize={0.26} color={C.output} anchorX="left">
            decode →
          </Label>
        </group>
      )}
      <Label position={[x0, 0.9, z0 - 1.2]} fontSize={0.26} color={C.input} anchorX="left">
        {`prefill · ${promptLen} positions in parallel`}
      </Label>
      <group position={[0, 5.2, z0 - 3]}>
        <mesh ref={counterRef}>
          <planeGeometry args={[0.01, 0.01]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
        <Label fontSize={1.3} color={C.output} glow>
          {Math.round(kv.computeSaved).toLocaleString()}
        </Label>
        <Label position={[0, -1, 0]} fontSize={0.3} color={C.muted}>
          K/V projections skipped thanks to the cache
        </Label>
      </group>
      <Label position={[0, -0.7, z0 + nLayers * ROW + 1]} fontSize={0.28} color={C.faint}>
        {`${nLayers} layers × ${kv.cachedTokens} positions · K over V · ≈${bytesKb} KB at fp16 · amber = written during decode`}
      </Label>
    </SetFrame>
  );
}
