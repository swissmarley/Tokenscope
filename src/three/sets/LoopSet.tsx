import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Group, Mesh, MeshStandardMaterial } from 'three';
import { useShallow } from 'zustand/shallow';
import { displayText } from '../../components/common/TokenChip';
import { currentProgress } from '../../hooks/useEventProgress';
import type { LoopPhase } from '../../pipeline/derive';
import type { Token } from '../../pipeline/events';
import { classify } from '../../sim/lexicon';
import { useStore } from '../../store/useStore';
import { Label } from '../primitives/Label';
import { SetFrame } from '../primitives/SetFrame';
import { TokenTile, type TileTarget } from '../primitives/TokenTile';
import { C, CLASS_3D } from '../theme';
import { layoutRows } from './TokenizeSet';

const NO_TOKENS: Token[] = [];
const R = 6.5;
const PHASES: Array<{ id: LoopPhase; label: string }> = [
  { id: 'layers', label: 'layers' },
  { id: 'attention', label: 'attention' },
  { id: 'kv', label: 'KV cache' },
  { id: 'logits', label: 'logits' },
  { id: 'sampled', label: 'sample' },
  { id: 'streamed', label: 'stream' },
];

/** Set 8: the ring of the forward pass; each new token lifts out and rejoins the input. */
export function LoopSet() {
  const { loop, prompt, nLayers, maxTokens } = useStore(
    useShallow((s) => ({ loop: s.view.loop, prompt: s.view.tokens?.tokens ?? NO_TOKENS, nLayers: s.view.layers.nLayers || 12, maxTokens: s.view.runStart?.settings.maxTokens ?? 0 })),
  );
  const it = loop.iterations[loop.step] ?? null;
  const generated = useMemo(
    () => loop.iterations.filter((x) => x.sampled && !x.sampled.isEos && (x.streamed || x.step < loop.step)).map((x) => x.sampled!.token),
    [loop.iterations, loop.step],
  );
  const chosen = it?.sampled?.token ?? null;
  const chosenPlaced = Boolean(it?.streamed) || (chosen !== null && generated.some((g) => g.index === chosen.index));
  const sequence = useMemo(() => [...prompt, ...generated], [prompt, generated]);
  const positions = useMemo(() => layoutRows(sequence, 1.2, 11, 0.3, 1.3), [sequence]);
  const phaseIdx = Math.max(0, PHASES.findIndex((x) => x.id === loop.phase));
  const arcs = useRef<Array<Mesh | null>>([]);
  const marker = useRef<Mesh>(null);
  const ringGlow = useRef<Mesh>(null);
  const stopRing = useRef<Mesh>(null);
  const centerGroup = useRef<Group>(null);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    const p = currentProgress();
    const within = loop.phase === 'layers' || loop.phase === 'attention' || loop.phase === 'kv' ? (it?.layersDone ?? 0) / Math.max(1, nLayers) : p;
    const ring = loop.phase === 'idle' ? 0 : (phaseIdx + Math.min(1, within)) / PHASES.length;
    arcs.current.forEach((m, i) => {
      if (!m) return;
      const mat = m.material as MeshStandardMaterial;
      const lit = loop.phase !== 'idle' && i <= phaseIdx;
      const target = lit ? (i === phaseIdx ? 2.2 : 1) : 0.15;
      mat.emissiveIntensity += (target - mat.emissiveIntensity) * Math.min(1, d * 8);
    });
    if (marker.current) {
      const a = -Math.PI / 2 + ring * Math.PI * 2;
      marker.current.position.set(Math.cos(a) * R, 1.5, Math.sin(a) * R);
      marker.current.visible = loop.phase !== 'idle';
    }
    if (ringGlow.current) {
      const s = 1 + 0.02 * Math.sin(state.clock.elapsedTime * 4);
      ringGlow.current.scale.setScalar(s);
    }
    if (stopRing.current) {
      stopRing.current.visible = loop.stopped;
      const mat = stopRing.current.material as MeshStandardMaterial;
      mat.opacity = 0.5 + 0.3 * Math.sin(state.clock.elapsedTime * 3);
    }
    if (centerGroup.current) centerGroup.current.rotation.y += d * 0.3;
  });

  const used = generated.length;

  return (
    <SetFrame stage="loop">
      {/* the ring, six arcs */}
      <group position={[0, 1.5, 0]}>
        <mesh ref={ringGlow} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[R, 0.12, 12, 96]} />
          <meshStandardMaterial color={C.line} emissive={C.model} emissiveIntensity={0.25} />
        </mesh>
        {PHASES.map((ph, i) => {
          const a0 = -Math.PI / 2 + (i / PHASES.length) * Math.PI * 2;
          const mid = a0 + Math.PI / PHASES.length;
          return (
            <group key={ph.id}>
              <mesh
                ref={(el) => {
                  arcs.current[i] = el;
                }}
                rotation={[Math.PI / 2, 0, -a0 - (Math.PI * 2) / PHASES.length + 0.04]}
              >
                <torusGeometry args={[R, 0.42, 14, 40, (Math.PI * 2) / PHASES.length - 0.08]} />
                <meshStandardMaterial color={i >= 4 ? C.output : C.model} emissive={i >= 4 ? C.output : C.model} emissiveIntensity={0.15} roughness={0.35} />
              </mesh>
              <Label position={[Math.cos(mid) * (R + 1.9), 0.2, Math.sin(mid) * (R + 1.9)]} fontSize={0.34} color={C.muted} rotation={[-Math.PI / 2, 0, 0]}>
                {ph.label}
              </Label>
            </group>
          );
        })}
        <mesh ref={marker} visible={false}>
          <sphereGeometry args={[0.5, 16, 16]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={3} toneMapped={false} />
        </mesh>
        <mesh ref={stopRing} rotation={[Math.PI / 2, 0, 0]} visible={false}>
          <torusGeometry args={[R + 0.9, 0.08, 8, 96]} />
          <meshStandardMaterial color={C.danger} emissive={C.danger} emissiveIntensity={2} transparent toneMapped={false} />
        </mesh>
      </group>
      {/* centre: the model, spinning */}
      <group ref={centerGroup} position={[0, 2.6, 0]}>
        {Array.from({ length: Math.min(nLayers, 12) }, (_, i) => (
          <mesh key={i} position={[0, -1.4 + i * 0.25, 0]}>
            <boxGeometry args={[2.2, 0.12, 2.2]} />
            <meshStandardMaterial color="#1b2452" emissive={C.model} emissiveIntensity={it && it.layersDone > i ? 1.2 : 0.15} transparent opacity={0.6} />
          </mesh>
        ))}
      </group>
      <Label position={[0, 5.4, 0]} fontSize={0.4} color={C.text}>
        {loop.phase === 'idle' ? 'waiting' : `step ${loop.step} · ${loop.phase === 'layers' || loop.phase === 'attention' || loop.phase === 'kv' ? `layer ${Math.min(nLayers, (it?.layersDone ?? 0) + 1)} / ${nLayers}` : loop.phase}`}
      </Label>
      {loop.stopped && (
        <Label position={[0, 6.2, 0]} fontSize={0.34} color={C.danger} glow>
          stop condition met
        </Label>
      )}
      {/* the newly sampled token rises from the centre, then joins the row */}
      {chosen && !chosenPlaced && (
        <TokenTile
          key={`chosen-${loop.step}`}
          text={displayText(chosen.text)}
          color={it?.sampled?.isEos ? C.danger : C.output}
          getTarget={(): TileTarget => {
            const lifted = loop.phase === 'sampled' || loop.phase === 'streamed';
            return { position: lifted ? [0, 7.4, 0] : [0, 2.6, 0], scale: lifted ? 1.4 : 0.001, glow: 1 };
          }}
        />
      )}
      {/* the growing input */}
      {sequence.map((t, i) => {
        const isGen = i >= prompt.length;
        const last = isGen && i === sequence.length - 1;
        const color = isGen ? C.output : CLASS_3D[classify(t.text)];
        const pos = positions[i] ?? [0, 1.2, 11];
        return (
          <TokenTile
            key={`seq-${t.index}`}
            text={displayText(t.text)}
            color={color}
            getTarget={(): TileTarget => ({ position: pos, scale: isGen ? 1 : 0.85, glow: last ? 1 : isGen ? 0.35 : 0 })}
          />
        );
      })}
      <Label position={[0, -0.6, 14]} fontSize={0.28} color={C.faint}>
        {`the growing input · ${prompt.length} prompt + ${used} generated · max_tokens ${used} / ${maxTokens} · EOS ${loop.iterations.some((x) => x.sampled?.isEos) ? 'sampled' : 'not yet'}`}
      </Label>
    </SetFrame>
  );
}
