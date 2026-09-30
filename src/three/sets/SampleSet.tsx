import { Billboard } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { easing } from 'maath';
import { useMemo, useRef } from 'react';
import { Mesh, MeshStandardMaterial, SpotLight } from 'three';
import { useShallow } from 'zustand/shallow';
import { displayText } from '../../components/common/TokenChip';
import { currentProgress, easeOut, window01 } from '../../hooks/useEventProgress';
import { sampleDistribution, sampleIndex } from '../../math/softmax';
import { tailLogitFor } from '../../sim/logits';
import { useStore } from '../../store/useStore';
import { Label } from '../primitives/Label';
import { SetFrame } from '../primitives/SetFrame';
import { C } from '../theme';

const BAR_GAP = 1.45;
const MAX_H = 11;
const TRACK_Z = 7;
const TRACK_W = 22;

/** Set 7: the probability skyline and the dice roll. */
export function SampleSet() {
  const { it, lastEvent, override } = useStore(
    useShallow((s) => ({ it: s.view.loop.iterations[s.view.loop.step] ?? null, lastEvent: s.view.lastEvent, override: s.samplingOverride })),
  );
  const ev = it?.logits ?? null;
  const sampled = it?.sampled ?? null;
  const params = override ?? (ev ? { temperature: ev.temperature, topK: ev.topK, topP: ev.topP } : { temperature: 1, topK: 0, topP: 1 });

  const rows = useMemo(() => {
    if (!ev) return [];
    const tailLogit = tailLogitFor(ev.candidates, ev.tailMass, ev.temperature);
    const logits = [...ev.candidates.map((c) => c.logit), tailLogit];
    const k = params.topK > 0 && params.topK <= ev.candidates.length ? params.topK : 0;
    const dist = sampleDistribution(logits, { temperature: params.temperature, topK: k, topP: params.topP });
    return logits.map((_, i) => {
      const c = ev.candidates[i];
      const isTail = i === ev.candidates.length;
      return {
        key: isTail ? 'tail' : `c${c?.token.id ?? i}`,
        id: c?.token.id ?? -1,
        label: isTail ? `other ${(ev.vocabSize - ev.candidates.length).toLocaleString()}` : displayText(c?.token.text ?? ''),
        prob: dist[i] ?? 0,
        isTail,
      };
    });
  }, [ev, params.temperature, params.topK, params.topP]);

  const bars = useRef<Array<Mesh | null>>([]);
  const die = useRef<Mesh>(null);
  const beam = useRef<Mesh>(null);
  const spot = useRef<SpotLight>(null);
  const segs = useRef<Array<Mesh | null>>([]);
  const chosenId = sampled?.token.id ?? -1;
  const onLogits = lastEvent?.type === 'logits';
  const onSampled = lastEvent?.type === 'sampled';
  const nBars = rows.length;
  const x0 = -((nBars - 1) * BAR_GAP) / 2;
  const u = sampled?.roll ?? 0;
  const wouldIdx = rows.length ? sampleIndex(rows.map((r) => r.prob), u) : -1;
  const chosenIdx = rows.findIndex((r) => r.id === chosenId);
  const maxProb = Math.max(1e-6, ...rows.map((r) => r.prob));

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    const p = currentProgress();
    const reveal = onLogits ? easeOut(window01(p, 0, 0.5)) : 1;
    const sweep = onSampled ? easeOut(window01(p, 0.05, 0.75)) : sampled ? 1 : 0;
    const settled = sampled !== null && (!onSampled || p > 0.75);
    bars.current.forEach((m, i) => {
      if (!m) return;
      const r = rows[i];
      if (!r) return;
      const local = Math.min(1, Math.max(0, reveal * (nBars + 2) - i * 0.5));
      const h = Math.max(0.05, (r.prob / maxProb) * MAX_H * local);
      easing.damp(m.scale, 'y', h, 0.22, d);
      m.position.y = m.scale.y / 2;
      const mat = m.material as MeshStandardMaterial;
      const isChosen = settled && i === chosenIdx;
      const would = override && i === wouldIdx && !isChosen;
      const target = isChosen ? 2.6 : would ? 1.6 : r.prob > 0 ? 0.5 : 0.08;
      mat.emissiveIntensity += (target - mat.emissiveIntensity) * Math.min(1, d * 8);
      mat.color.set(isChosen ? C.output : would ? C.input : r.isTail ? '#3b4470' : C.model);
      mat.emissive.set(isChosen ? C.output : would ? C.input : C.model);
      mat.opacity = r.prob > 0 ? 0.95 : 0.25;
    });
    // cumulative track segments
    let acc = 0;
    segs.current.forEach((m, i) => {
      if (!m) return;
      const r = rows[i];
      const w = (r?.prob ?? 0) * TRACK_W;
      easing.damp(m.position, 'x', -TRACK_W / 2 + acc + w / 2, 0.22, d);
      easing.damp(m.scale, 'x', Math.max(0.001, w), 0.22, d);
      const mat = m.material as MeshStandardMaterial;
      const isChosen = settled && i === chosenIdx;
      mat.emissiveIntensity += ((isChosen ? 2 : 0.35) - mat.emissiveIntensity) * Math.min(1, d * 8);
      mat.color.set(isChosen ? C.output : r?.isTail ? '#3b4470' : C.model);
      mat.emissive.set(isChosen ? C.output : C.model);
      acc += w;
    });
    // the die rolls along the track to u
    const dieM = die.current;
    if (dieM) {
      dieM.visible = sampled !== null && sweep > 0;
      const x = -TRACK_W / 2 + sweep * u * TRACK_W;
      dieM.position.set(x, settled ? 0.55 : 0.75 + Math.abs(Math.sin(sweep * 14)) * 0.5, TRACK_Z);
      dieM.rotation.z = -x * 2;
      dieM.rotation.x += d * (settled ? 0 : 6);
      const mat = dieM.material as MeshStandardMaterial;
      mat.emissive.set(settled ? C.output : '#ffffff');
    }
    // spotlight + light column on the chosen bar
    const cx = chosenIdx >= 0 ? x0 + chosenIdx * BAR_GAP : 0;
    const chosenBar = bars.current[chosenIdx];
    if (beam.current) {
      beam.current.visible = settled && chosenIdx >= 0;
      beam.current.position.set(cx, 8, 0);
      const mat = beam.current.material as MeshStandardMaterial;
      mat.opacity = 0.12 + 0.05 * Math.sin(state.clock.elapsedTime * 4);
      void chosenBar;
    }
    if (spot.current) {
      spot.current.visible = settled && chosenIdx >= 0;
      spot.current.position.set(cx, 16, 4);
      spot.current.target.position.set(cx, 0, 0);
      spot.current.target.updateMatrixWorld();
    }
  });

  if (!ev) {
    return (
      <SetFrame stage="sample">
        <Label position={[0, 3, 0]} fontSize={0.4} color={C.faint}>
          waiting for the first prediction…
        </Label>
      </SetFrame>
    );
  }

  return (
    <SetFrame stage="sample">
      {rows.map((r, i) => (
        <group key={r.key} position={[x0 + i * BAR_GAP, 0, 0]}>
          <mesh
            ref={(el) => {
              bars.current[i] = el;
            }}
          >
            <boxGeometry args={[1.05, 1, 1.05]} />
            <meshStandardMaterial color={C.model} emissive={C.model} emissiveIntensity={0.4} transparent roughness={0.35} metalness={0.2} />
          </mesh>
          <Billboard position={[0, -0.7, 0.9]}>
            <Label fontSize={0.26} color={r.prob > 0 ? C.text : C.faint} rotation={[0, 0, 0]}>
              {r.label.slice(0, 10)}
            </Label>
          </Billboard>
          <Billboard position={[0, Math.max(0.6, (r.prob / maxProb) * MAX_H + 0.7), 0]}>
            <Label fontSize={0.26} color={r.id === chosenId ? C.output : C.muted}>
              {`${(r.prob * 100).toFixed(r.prob < 0.01 ? 2 : 1)}%`}
            </Label>
          </Billboard>
        </group>
      ))}
      {/* light column + spot on the chosen one */}
      <mesh ref={beam} visible={false}>
        <cylinderGeometry args={[0.9, 0.6, 16, 24, 1, true]} />
        <meshStandardMaterial color={C.output} emissive={C.output} emissiveIntensity={1.5} transparent opacity={0.15} depthWrite={false} toneMapped={false} />
      </mesh>
      <spotLight ref={spot} visible={false} color={C.output} intensity={400} angle={0.35} penumbra={0.6} distance={40} decay={2} />
      {/* the roll track */}
      <group position={[0, 0, TRACK_Z]}>
        <mesh position={[0, 0.2, 0]}>
          <boxGeometry args={[TRACK_W + 0.6, 0.12, 1.4]} />
          <meshStandardMaterial color="#0f172a" roughness={0.9} />
        </mesh>
        {rows.map((r, i) => (
          <mesh
            key={r.key}
            ref={(el) => {
              segs.current[i] = el;
            }}
            position={[0, 0.32, 0]}
          >
            <boxGeometry args={[1, 0.12, 1.1]} />
            <meshStandardMaterial color={C.model} emissive={C.model} emissiveIntensity={0.35} />
          </mesh>
        ))}
        <Label position={[-TRACK_W / 2, -0.35, 1.2]} fontSize={0.24} color={C.faint}>
          0
        </Label>
        <Label position={[TRACK_W / 2, -0.35, 1.2]} fontSize={0.24} color={C.faint}>
          1
        </Label>
        <Label position={[0, -0.35, 1.2]} fontSize={0.26} color={C.muted}>
          {sampled ? `u ~ Uniform[0, 1) = ${sampled.roll.toFixed(4)}  →  “${displayText(sampled.token.text)}”  ·  rank ${sampled.rank + 1}  ·  ${(sampled.prob * 100).toFixed(1)}%` : 'one uniform random number decides'}
        </Label>
      </group>
      <mesh ref={die} visible={false} position={[-TRACK_W / 2, 0.8, TRACK_Z]}>
        <icosahedronGeometry args={[0.45, 1]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={2.5} toneMapped={false} />
      </mesh>
      <Label position={[0, -0.7, -3]} fontSize={0.28} color={C.faint}>
        {`softmax at T=${params.temperature}${params.topK ? ` · top-k ${params.topK}` : ''}${params.topP < 1 ? ` · top-p ${params.topP}` : ''} · bar height = probability · ${ev.vocabSize.toLocaleString()} candidates in the full vocabulary`}
      </Label>
    </SetFrame>
  );
}
