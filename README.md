# LLM Under the Hood

An interactive, slow-motion visualizer of everything that happens between pressing **Send** and reading the reply.
Type a message, watch the request get sealed and shipped, see the text shatter into tokens, become vectors, pass
through a stack of transformer blocks, attend to itself, fill a KV cache, turn into a probability distribution,
get rolled like dice, loop, and stream back — with play / pause / step / scrub at 0.1× – 4×.

Every visual is driven by one typed event stream (`PipelineEvent`), never by timers inside components, so pausing,
stepping and scrubbing are always exact.

## Quick start

```bash
npm install
npm run dev          # Vite on :5173 + the API proxy on :8787
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
(`meta` / `delta` / `done` / `error`). Set `LLM_PROVIDER=openai` plus `OPENAI_BASE_URL` to use OpenAI, Ollama, vLLM, etc.

### Lab model setup (Python)

```bash
cd lab-server
uv venv --python 3.11 .venv          # or: python3.11 -m venv .venv
uv pip install --python .venv/bin/python -r requirements.txt   # torch, transformers, fastapi, uvicorn
LAB_MODEL=distilgpt2 .venv/bin/python -m uvicorn server:app --port 8788
```

First start downloads the weights (~350 MB for distilgpt2). `LAB_MODEL=gpt2` or `LAB_MODEL=EleutherAI/pythia-70m`
also work (pythia uses rotary positions, so its position vectors are shown as an illustration). The proxy forwards
`/api/lab/run` to it; `GET /api/health` tells you whether it is reachable.

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
| 9 Streaming chunks, detokenized text, usage, stop reason | canned | **real** SSE frames (raw line shown) | **real** |

Slow-motion *timing* is always a presentation choice (`baseDurationMs` per event); the `t` field on every event is the
wall-clock time the source observed.

## Using it

- **Top bar**: message, example prompts, Send, mode toggle, speed, "I'm new / Math" annotation depth, sound cues, run history, settings, inspector.
- **Transport bar**: play/pause, step ±1 event, step ±1 stage, scrubbable timeline with stage markers, speed slider + presets, "Pause at each stage", live-lag indicator with **Catch up** for streaming runs.
- **Inspector** (`I`): plain-language "What's happening", "Go deeper", raw event JSON; click any event, chip or bar to pin it.
- **Keyboard**: `Space` play/pause · `←` `→` step event · `Shift+←/→` step stage · `[` `]` speed · `I` inspector · `Esc` close.
- **History**: every run (mock, live, lab) is logged to IndexedDB and can be replayed and scrubbed without another API call.
- **Settings**: model name, proxy URL, system prompt, `max_tokens`, temperature, top-k, top-p, camera follow, sound.
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
