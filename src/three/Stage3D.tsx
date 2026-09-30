import { Grid, Sparkles } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { useReducedMotion } from 'framer-motion';
import { easing } from 'maath';
import { Suspense, useRef } from 'react';
import { ACESFilmicToneMapping, Group } from 'three';
import { useShallow } from 'zustand/shallow';
import { Welcome } from '../components/layout/Welcome';
import type { StageId } from '../pipeline/events';
import { STAGE_ORDER, stageIndex } from '../pipeline/stages';
import { useStore } from '../store/useStore';
import { CameraRig } from './CameraRig';
import { Hud } from './Hud';
import { AttentionSet } from './sets/AttentionSet';
import { EmbedSet } from './sets/EmbedSet';
import { KVSet } from './sets/KVSet';
import { LayersSet } from './sets/LayersSet';
import { LoopSet } from './sets/LoopSet';
import { SampleSet } from './sets/SampleSet';
import { SendSet } from './sets/SendSet';
import { StreamSet } from './sets/StreamSet';
import { TokenizeSet } from './sets/TokenizeSet';
import { C, STAGE_X } from './theme';

const HOLO_COLOR: Record<StageId, string> = {
  compose: C.input,
  tokenize: C.input,
  embed: C.input,
  layers: C.model,
  attention: C.model,
  kvcache: C.model,
  sample: C.model,
  loop: C.model,
  stream: C.output,
};

function SetFor({ stage }: { stage: StageId }) {
  switch (stage) {
    case 'compose':
      return <SendSet />;
    case 'tokenize':
      return <TokenizeSet />;
    case 'embed':
      return <EmbedSet />;
    case 'layers':
      return <LayersSet />;
    case 'attention':
      return <AttentionSet />;
    case 'kvcache':
      return <KVSet />;
    case 'sample':
      return <SampleSet />;
    case 'loop':
      return <LoopSet />;
    case 'stream':
      return <StreamSet />;
  }
}

/** Ambient dust and a key light that follow the active set. */
function Ambience({ stage }: { stage: StageId }) {
  const g = useRef<Group>(null);
  useFrame((_, dt) => {
    if (g.current) easing.damp(g.current.position, 'x', STAGE_X[stage], 0.8, Math.min(dt, 0.05));
  });
  return (
    <group ref={g}>
      <Sparkles count={260} scale={[70, 30, 60]} position={[0, 10, 0]} size={2.2} speed={0.25} opacity={0.35} color="#9fb8ff" />
      <pointLight position={[0, 14, 12]} intensity={260} color="#c9d8ff" distance={80} decay={2} />
      <pointLight position={[-14, 6, -10]} intensity={120} color={HOLO_COLOR[stage]} distance={60} decay={2} />
    </group>
  );
}

function World() {
  const { stage, focused } = useStore(useShallow((s) => ({ stage: s.view.currentStage, focused: s.focusedStage })));
  const reduced = useReducedMotion() ?? false;
  const active: StageId = focused ?? stage ?? 'compose';
  const cur = stageIndex(active);
  return (
    <>
      <color attach="background" args={[C.bg]} />
      <fog attach="fog" args={[C.bg, 60, 170]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[20, 30, 10]} intensity={0.8} />
      <Grid position={[0, -0.05, 0]} args={[10, 10]} cellSize={2} cellThickness={0.6} sectionSize={10} sectionThickness={1.1} cellColor="#182246" sectionColor="#26305a" fadeDistance={120} fadeStrength={1.4} infiniteGrid />
      <Ambience stage={active} />
      <CameraRig stage={active} reduced={reduced} />
      <Suspense fallback={null}>
        {STAGE_ORDER.map((s, i) =>
          Math.abs(i - cur) <= 1 ? (
            <group key={s} position={[STAGE_X[s], 0, 0]}>
              <SetFor stage={s} />
            </group>
          ) : null,
        )}
      </Suspense>
      <EffectComposer>
        <Bloom luminanceThreshold={0.55} luminanceSmoothing={0.25} intensity={0.9} mipmapBlur radius={0.7} />
        <Vignette eskil={false} offset={0.2} darkness={0.75} />
      </EffectComposer>
    </>
  );
}

/** The cinematic 3-D view: one continuous world, one set per stage. */
export function Stage3D() {
  const eventCount = useStore((s) => s.transport.eventCount);
  return (
    <div className="relative h-full min-h-0">
      <Canvas
        dpr={[1, 1.75]}
        camera={{ fov: 42, near: 0.1, far: 400, position: [2, 7, 30] }}
        gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.05, powerPreference: 'high-performance' }}
        className="!absolute inset-0"
      >
        <World />
      </Canvas>
      {eventCount === 0 ? (
        <div className="absolute inset-0 overflow-y-auto px-4 py-8 lg:px-8">
          <Welcome />
        </div>
      ) : (
        <Hud />
      )}
    </div>
  );
}
