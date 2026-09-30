# LLM Under the Hood — Plan

A cinematic, slow-motion visualizer of everything that happens between "Send" and the final rendered reply.
Every visual is driven by a typed stream of `PipelineEvent`s. No component owns a timer.

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ BROWSER                                                                        │
│                                                                                │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                     │
│   │ MockSource   │    │ LiveSource   │    │ LabSource    │   EventSource       │
│   │ canned runs  │    │ SSE from     │    │ SSE from     │   interface         │
│   │ + simulator  │    │ /api/chat    │    │ /api/lab     │                     │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘                     │
│          └───────────────────┼───────────────────┘                             │
│                              ▼  emit(PipelineEvent)   (real-time, append-only) │
│                    ┌─────────────────────┐                                     │
│                    │  Timeline log       │──► IndexedDB (persist runs)         │
│                    │  events[] + startsAt│                                     │
│                    └─────────┬───────────┘                                     │
│                              ▼                                                 │
│                    ┌─────────────────────┐   play / pause / step / scrub       │
│                    │  Scheduler          │   speed 0.1x–4x, auto-pause         │
│                    │  virtualTime,cursor │   live-lag + catch-up               │
│                    └─────────┬───────────┘                                     │
│                              ▼  cursor changes                                 │
│                    ┌─────────────────────┐                                     │
│                    │ deriveView(events,  │  pure reducer → per-stage view      │
│                    │   cursor)           │  models (memoised, incremental)     │
│                    └─────────┬───────────┘                                     │
│                              ▼                                                 │
│   ┌──────────┬───────────────┴──────────────┬──────────────┬────────────────┐  │
│   │ TopBar   │ Stage scenes (9) + rail      │ Inspector    │ TransportBar   │  │
│   │          │ Framer Motion + Canvas2D     │ raw JSON +   │ timeline scrub │  │
│   │          │ (heatmap, scatter, arcs)     │ explanations │ stage markers  │  │
│   └──────────┴──────────────────────────────┴──────────────┴────────────────┘  │
└──────────────────────────────┬─────────────────────────────────────────────────┘
                               │ /api/*  (Vite dev proxy → :8787)
┌──────────────────────────────▼─────────────────────────────────────────────────┐
│ server/ (Node + Express)   API key lives in server/.env only                   │
│   POST /api/chat  → Anthropic Messages (stream) or OpenAI-compatible → SSE     │
│   POST /api/lab   → forwards to lab-server                                     │
└──────────────────────────────┬─────────────────────────────────────────────────┘
┌──────────────────────────────▼─────────────────────────────────────────────────┐
│ lab-server/ (Python, FastAPI + torch + transformers, distilgpt2)               │
│   real tokens, wte+wpe embeddings, attention per layer/head, top-k logits      │
└────────────────────────────────────────────────────────────────────────────────┘
```

**Key invariants**

- UI state is a pure function of `(events, cursor)`. Scrubbing = changing cursor. Nothing else.
- Every event carries `fidelity: 'real' | 'illustrative'`. Illustrative data is rendered with dashed outlines and a badge. Live mode never fakes internals as real.
- The Scheduler is a plain class with injectable clock, unit-tested without React.
- Heavy visuals (heatmap, scatter, arcs) render on Canvas2D; DOM animation uses transform/opacity only.

## Event types

```ts
type StageId =
  | 'compose' | 'tokenize' | 'embed' | 'layers' | 'attention'
  | 'kvcache' | 'sample' | 'loop' | 'stream';

type Fidelity = 'real' | 'illustrative';

interface EventBase {
  seq: number;              // monotonic index in the run
  t: number;                // wall-clock ms since run start (when the source produced it)
  baseDurationMs: number;   // slow-motion hold; Scheduler multiplies by 1/speed
  stage: StageId;
  fidelity: Fidelity;
  step?: number;            // decode step (0 = prefill) when relevant
}

type PipelineEvent = EventBase & (
  | { type: 'run_start';       mode: 'mock'|'live'|'lab'; prompt: string; model: string; settings: Settings }
  | { type: 'request_built';   body: RequestBody; bytes: number }
  | { type: 'request_sent';    hops: Array<{ label: string; ms: number }> }
  | { type: 'tokenized';       tokens: Token[]; tokenizer: string; vocabSize: number }
  | { type: 'embedded';        dims: number; vectors: number[][]; positional: number[][]; projected: Array<[number, number]> }
  | { type: 'layer_start';     layer: number; nLayers: number }
  | { type: 'attention';       layer: number; heads: number[][][] /* [head][q][k] */; nHeads: number; dHead: number }
  | { type: 'ffn';             layer: number; hiddenDim: number; activationSparsity: number }
  | { type: 'layer_end';       layer: number; residualNorm: number }
  | { type: 'kv_cache_update'; layer: number; positions: number[]; cachedTokens: number; computeSaved: number }
  | { type: 'logits';          candidates: Candidate[]; vocabSize: number; temperature: number; topK: number; topP: number }
  | { type: 'sampled';         token: Token; prob: number; rank: number; roll: number }
  | { type: 'token_streamed';  token: Token; text: string; chunkIndex: number; wire: 'sse' | 'canned' }
  | { type: 'detokenized';     text: string; tokens: Token[] }
  | { type: 'done';            stopReason: string; usage: { input: number; output: number }; ttftMs: number; totalMs: number; tokensPerSec: number }
);

interface Token     { id: number; text: string; bytes: number[]; index: number }
interface Candidate { token: Token; logit: number; prob: number }
```

Sources implement one interface:

```ts
interface EventSource {
  readonly kind: 'mock' | 'live' | 'lab';
  run(prompt: string, settings: Settings, emit: (e: PipelineEvent) => void, signal: AbortSignal): Promise<void>;
}
```

## Scheduler

- Each event `i` has `startsAt[i] = Σ baseDurationMs[0..i-1]` on a *virtual* timeline.
- `virtualTime` advances at `speed × wall-time` while playing; `cursor = max i : startsAt[i] ≤ virtualTime`.
- `stepEvent(±1)`, `stepStage(±1)`, `seekTime(ms)`, `seekEvent(i)`, `catchUp()` all just set `virtualTime`.
- Live sources append while playing. `liveLagMs = startsAt[last] − virtualTime`. Auto-pause on stage boundaries is a flag.
- Injectable `now()`; tests drive `tick(now)` manually.

## Simulator (illustrative internals)

Seeded PRNG so a given prompt always produces the same picture.
Tokenization is **real BPE** (`gpt-tokenizer`, GPT-2 `r50k_base`) even in Mock/Live mode, labelled as
"GPT-2 tokenizer — Claude's differs". Embeddings, attention, FFN, KV-cache and logits are generated
with plausible structure (previous-token heads, attention-sink heads, pronoun→referent heads, cluster
offsets for word classes) and always flagged `illustrative`.

## File tree

```
Tokenscope/
├─ PLAN.md  README.md  .env.example  package.json  vite.config.ts  tsconfig*.json  index.html
├─ server/                      Node proxy — key never reaches the client
│  ├─ index.ts                  express app, /api/chat, /api/lab, /api/health
│  └─ providers/{anthropic,openai}.ts   streaming adapters → normalised SSE
├─ lab-server/                  Python: real GPT-2 internals (M6)
│  ├─ server.py  requirements.txt
├─ e2e/                         Playwright screenshot checks
└─ src/
   ├─ main.tsx  App.tsx
   ├─ design/tokens.css         @theme design tokens (colour, type, motion, radii)
   ├─ design/motion.ts          spring presets, stagger helpers, reduced-motion
   ├─ pipeline/
   │  ├─ events.ts              PipelineEvent union, guards, StageId
   │  ├─ stages.ts              stage order, labels, accent colours
   │  ├─ scheduler.ts           Scheduler class
   │  ├─ scheduler.test.ts
   │  ├─ derive.ts              (events, cursor) → ViewState
   │  └─ sources/
   │     ├─ EventSource.ts  MockSource.ts  LiveSource.ts  LabSource.ts  sse.ts
   ├─ sim/                      deterministic illustrative generators
   │  ├─ prng.ts  tokenize.ts  embed.ts  pca.ts  attention.ts  ffn.ts  logits.ts
   │  ├─ buildRun.ts            prompt + reply → full event list
   │  └─ presets.ts             example prompts + canned replies
   ├─ math/
   │  ├─ softmax.ts             softmax, temperature, top-k, top-p, sample
   │  └─ softmax.test.ts
   ├─ store/useStore.ts         zustand: run, transport, ui, settings
   ├─ persistence/runs.ts       IndexedDB via idb
   ├─ content/explain.ts        "What's happening" / "Go deeper" / math copy
   ├─ hooks/                    useKeyboard, useReducedMotion, useCanvas, useFocusStage
   ├─ audio/cues.ts             Web Audio blips (off by default)
   └─ components/
      ├─ layout/    TopBar  TransportBar  ProgressRail  Inspector  SettingsModal  Tour
      ├─ common/    Badge  TokenChip  Panel  Glow  Slider  IconButton
      └─ stages/    StageFrame  ComposeSend  Tokenization  Embeddings  Layers
                    Attention  KVCache  Sampling  Loop  Streaming
```

## Milestones

| M  | Scope | Done when |
|----|-------|-----------|
| M1 | Scaffold, design tokens, events, Scheduler (+tests), MockSource, transport bar, progress rail, stage shells | Mock run plays/pauses/steps/scrubs in the browser |
| M2 | Stages 1–3: compose & send, tokenization chips, embeddings matrix + 2D scatter + positional wave | Visual check |
| M3 | Stages 4–6: layer stack scrubber, attention heatmap/arcs/causal mask, KV-cache grid | Visual check |
| M4 | Stages 7–9: logits bars + temp/top-k/top-p sliders, dice roll, autoregressive loop, SSE stream + stats | Visual check |
| M5 | LiveSource + Node proxy + streaming parse + live-lag indicator + IndexedDB runs | Real Claude run replays |
| M6 | LabSource + Python lab-server (distilgpt2), real attention/logits | Real attention heatmaps |
| M7 | Guided tour, presets, keyboard, a11y, reduced motion, README, e2e screenshots | Ship |

**Dependency note (needs your OK at M6):** distilgpt2 weights are ~350 MB fp32 via `transformers`
(torch itself is ~2 GB). Below the 200 MB threshold there is no browser-side option that exposes
attention, so Lab mode uses the Python server. I will ask before installing.
