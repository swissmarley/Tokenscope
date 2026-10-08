# LLM Under the Hood

An interactive, slow-motion visualizer of everything that happens between pressing **Send** and reading the reply.
Type a message, watch the request get sealed and shipped, see the text shatter into tokens, become vectors, pass
through a stack of transformer blocks, attend to itself, fill a KV cache, turn into a probability distribution,
get rolled like dice, loop, and stream back — with play / pause / step / scrub at 0.1× – 4×.

Every visual is driven by one typed event stream (`PipelineEvent`), never by timers inside components, so pausing,
stepping and scrubbing are always exact.

## Quick start

```bash
npm ci               # installs exactly what package-lock.json pins
npm run dev          # Vite on :5173 + the API proxy on 127.0.0.1:8787
```

Open http://localhost:5173. The app starts in **Mock** mode with a canned run — no key, no download.

| Script | What it does |
|---|---|
| `npm run dev` | web + proxy together |
| `npm run dev:web` / `npm run dev:server` | either one alone |
| `npm test` | unit tests (Scheduler, sampling math, event reducer, Live source, proxy normaliser) |
| `npm run e2e` | Playwright: screenshots every stage into `e2e/screenshots/` (`npx playwright install chromium` once) |
| `npm run typecheck` / `npm run build` | strict TypeScript, production bundle |

## The three modes

| Mode | Needs | What you get |
|---|---|---|
| **Mock** (default) | nothing | A deterministic canned run for the example prompts (or a generic reply for your own). Real BPE tokenization; everything else simulated. |
| **Live API** | `server/.env` with a key | A real streamed reply from Claude (or any OpenAI-compatible endpoint). Real request, timing, chunks, stop reason, usage. |
| **Lab model** | the Python lab server | distilgpt2 running on your machine, exposing its *real* tokens, embeddings, attention per layer/head, MLP activations, logits and the actual sampling draw. |

### Live API setup

```bash
cp .env.example server/.env   # then edit: ANTHROPIC_API_KEY=sk-ant-…
npm run dev
```

The key lives only in `server/.env` and is read only by the Node proxy (`server/`). The browser talks to `/api/chat`;
the proxy adds the secret header, calls the provider with `stream: true`, and forwards a normalised SSE stream
(`meta` / `delta` / `done` / `error`). The proxy listens on `127.0.0.1` only; set `PROXY_HOST=0.0.0.0` if you really
want it on your network, keeping in mind that anyone who can reach it can spend your key.

**Model.** Leave *Settings → Model* empty to use the proxy's `ANTHROPIC_MODEL` / `OPENAI_MODEL`; type a name to override it.

#### Ollama (or vLLM, LM Studio, …)

No key is needed when the OpenAI-compatible server runs on this machine or your private network:

```bash
ollama pull llama3.2:1b
cat > server/.env <<'ENV'
LLM_PROVIDER=openai
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_MODEL=llama3.2:1b
ENV
npm run dev
```

A hosted endpoint (OpenAI itself, Groq, …) needs `OPENAI_API_KEY`; without one, Live mode shows as unavailable.

### Lab model setup (Python)

```bash
cd lab-server
uv venv --python 3.11 .venv          # or: python3.11 -m venv .venv
# No NVIDIA GPU? Install the CPU-only PyTorch build first; the default one pulls several GB of CUDA libraries.
uv pip install --python .venv/bin/python torch --index-url https://download.pytorch.org/whl/cpu
uv pip install --python .venv/bin/python -r requirements.txt   # torch, transformers, fastapi, uvicorn
LAB_MODEL=distilgpt2 .venv/bin/python -m uvicorn server:app --port 8788   # or, from the repo root: npm run lab
```

(With plain pip: `.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu`, then
`.venv/bin/pip install -r requirements.txt`.)

First start downloads the weights (~350 MB for distilgpt2). `LAB_MODEL=gpt2` or `LAB_MODEL=EleutherAI/pythia-70m`
also work (pythia uses rotary positions, so its position vectors are shown as an illustration). The proxy forwards
`/api/lab/run` to it; `GET /api/health` tells you whether it is reachable.

Limits: prompts up to `LAB_MAX_PROMPT_TOKENS` (default 128) and replies up to `LAB_MAX_OUTPUT_TOKENS` (default 128),
and prompt plus reply never exceed the model's context window (1,024 for GPT-2) — a reply cut short there ends with
stop reason `context_window`. The prompt cap exists because prefill attention is layers × heads × n² numbers: about
5 MB of JSON at 128 tokens for distilgpt2, and four times that at 256.

## What is real vs. illustrative in each mode

Every event carries `fidelity: 'real' | 'illustrative'`. Illustrative data is drawn with **dashed borders and an
amber badge**; real data gets a green badge. Nothing simulated is ever presented as measured.

| Stage | Mock | Live API | Lab model |
|---|---|---|---|
| 1 Compose & send (request body, bytes) | illustrative timing | **real** | **real** |
| — time to first byte / hops | simulated hops | **real** total; hops not broken down | **real** total |
| 2 Tokenization | **real GPT-2 BPE** (labelled: not the API model's tokenizer) | real GPT-2 BPE, labelled illustrative for Claude | **real** (the model's own tokenizer) |
| 3 Embeddings + position | simulated (word-class clusters, sinusoidal P) | simulated | **real** `wte` / `wpe` rows, real PCA |
| 4 Transformer layers (residual norms, FFN activations) | simulated | simulated | **real** (hidden-state norms, hooked GELU outputs) |
| 5 Attention (all layers × heads, causal mask) | simulated with realistic head "species" | simulated | **real** |
| 6 KV cache (positions, prefill vs decode) | simulated | simulated | **real** (`use_cache=True`, counters derived) |
| 7 Logits / probabilities / sampling draw | simulated (true next token guaranteed) | simulated around the real chunk text | **real** top-16 logits, real filtered draw |
| 8 Autoregressive loop (steps, stop condition) | simulated; EOS step illustrative | steps = real chunks (GPT-2 BPE split); EOS illustrative when `end_turn` | **real** |
| 9 Streaming chunks, detokenized text, usage, stop reason | canned (example Anthropic frame shown) | **real** SSE frames (the provider's raw frame shown) | **real** (the lab server's raw frame shown) |

Slow-motion *timing* is always a presentation choice (`baseDurationMs` per event); the `t` field on every event is the
wall-clock time the source observed.

## Two views of the same run

- **3D (default)** — one continuous WebGL world (react-three-fiber + bloom). Each stage is a "set" laid out along a path in
  space; the camera flies between sets as the pipeline advances, and inside a set you can drag to orbit, scroll to zoom and
  hover objects. Sets: the stamped envelope and neon packet track; token tiles shattering into rows; the 3-D PCA cloud over a
  rippling positional-wave floor; the translucent block tower with its residual beam; token pillars with attention arcs and
  a bar-field "terrain" of weights (layer/head picker in the HUD); the instanced KV-cache grid; the probability skyline with
  a rolling die and live temperature / top-k / top-p; the phase ring of the autoregressive loop; and chunks riding the wire
  into the chat panel. Everything is driven by the same event stream, so pause, step and scrub freeze the world exactly.
- **Detail** — the stage-by-stage 2-D scenes with the full annotations, heatmaps, matrices and callouts.

Toggle between them in the top bar. Both share the transport bar, rail, inspector and history.

### Fly-through

Press **Fly-through** in the top bar (3D view) to replay the whole run from the start as a cinematic: letterboxed, the
camera orbits and dollies inside each set on its own and flies between sets with the courier token. `Esc` or grabbing the
world hands the camera back. Playback speed is whatever the transport is set to — 0.25× is a four-minute tour, 1× about a minute.

## Connections: proxy or direct

| | Through the proxy (default in dev) | Direct from this browser (default on GitHub Pages) |
|---|---|---|
| Where the key lives | `server/.env`, read by the Node proxy | your browser's `localStorage`, entered in **Settings → Connection** |
| Live API | browser → `/api/chat` → provider | browser → provider (Anthropic's CORS opt-in header, or any OpenAI-compatible endpoint) |
| Lab model | browser → `/api/lab/run` → Python server | browser → `http://localhost:8788` directly (browsers treat localhost as a trustworthy origin even from an https page) |

Direct mode is what makes a static deployment useful, but read the warning in Settings: anyone who can open that browser
profile can read the key, so use one you can rotate and never on a shared machine. "Forget" clears it.

## Deploying to GitHub Pages

`.github/workflows/pages.yml` builds on every push to `main` with `VITE_STATIC=true` (so the app defaults to direct
connections) and `BASE_PATH=/<repo>/`, then publishes `dist/` with `actions/deploy-pages`. In the repository settings set
**Pages → Source → GitHub Actions** once. Mock mode works out of the box; Live needs a key entered in Settings; Lab needs the
Python server running on the visitor's own machine.

## Using it

- **Top bar**: message, example prompts, Send, mode toggle, speed, "I'm new / Math" annotation depth, sound cues, run history, settings, inspector.
- **Transport bar**: play/pause, step ±1 event, step ±1 stage, scrubbable timeline with stage markers, speed slider + presets, "Pause at each stage", live-lag indicator with **Catch up** for streaming runs.
- **Inspector** (`I`): plain-language "What's happening", "Go deeper", raw event JSON; click any event, chip or bar to pin it.
- **Keyboard**: `Space` play/pause · `←` `→` step event · `Shift+←/→` step stage · `[` `]` speed · `I` inspector · `Esc` close.
- **History**: every run (mock, live, lab) is logged to IndexedDB and can be replayed and scrubbed without another API call.
- **Settings**: model name (empty = the configured default), proxy URL, system prompt, `max_tokens`, temperature, top-k, top-p, camera follow, sound.
- Honors `prefers-reduced-motion` (instant steps, no smooth camera).

## Architecture

```
sources (Mock / Live / Lab) ──emit──▶ Scheduler (virtual timeline, speed, pause/step/scrub, live lag)
                                          │ cursor
                                          ▼
                              deriveView(events[0..cursor]) ──▶ nine scenes (SVG + Canvas2D, framer-motion)
                                          ▲
                              useEventProgress(seq): 0→1 through an event's hold, so animations scrub
```

- `src/pipeline/events.ts` — the discriminated union of events.
- `src/pipeline/scheduler.ts` — plain class with an injectable clock; `scheduler.test.ts` covers speed scaling, pause, step, scrub, auto-pause, live buffering.
- `src/sim/` — deterministic simulator (seeded PRNG): BPE via `gpt-tokenizer`, PCA, head "species", logits.
- `src/pipeline/sources/` — `MockSource`, `LiveSource` (SSE from the proxy), `LabSource` (SSE from the Python server).
- `server/` — Express proxy; `providers/anthropic.ts`, `providers/openai.ts` normalise streams.
- `lab-server/server.py` — FastAPI + transformers; hooks capture MLP activations; attention via `output_attentions`.

See `PLAN.md` for the original plan and milestones.
