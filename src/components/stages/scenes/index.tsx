import type { ComponentType } from 'react';
import type { StageId } from '../../../pipeline/events';
import { ComposeSend } from './ComposeSend';
import { Tokenization } from './Tokenization';
import { Embeddings } from './Embeddings';
import { Layers } from './Layers';
import { Attention } from './Attention';
import { KVCache } from './KVCache';
import { Sampling } from './Sampling';
import { Loop } from './Loop';
import { Streaming } from './Streaming';

export interface Scene {
  /** One-line collapsed summary shown when the stage is not expanded. */
  Summary: ComponentType;
  /** The full scene. */
  Body: ComponentType;
}

export const SCENES: Record<StageId, Scene> = {
  compose: ComposeSend,
  tokenize: Tokenization,
  embed: Embeddings,
  layers: Layers,
  attention: Attention,
  kvcache: KVCache,
  sample: Sampling,
  loop: Loop,
  stream: Streaming,
};
