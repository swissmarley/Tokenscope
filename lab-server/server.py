"""
Lab server: runs a small open causal LM and streams its REAL internals.

Every number sent here is read from the model: BPE tokens, embedding rows
(wte / wpe), per-layer attention weights for every head, MLP activations,
residual-stream norms, full-vocabulary logits and the actual sampling draw.

    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    LAB_MODEL=distilgpt2 uvicorn server:app --port 8788

Supported architectures: GPT-2 family (gpt2, distilgpt2, …) and GPT-NeoX
(EleutherAI/pythia-*). Anything HF loads with `output_attentions` should work.
"""

from __future__ import annotations

import json
import os
import random
import time
from typing import Any, Iterator

import torch
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL = os.environ.get("LAB_MODEL", "distilgpt2")
SHOWN_DIMS = 48
TOP_N = 16
# Prefill attention is layers × heads × n² numbers, so the payload grows with the
# square of the prompt: ~5 MB at 128 tokens for distilgpt2, ~20 MB at 256.
MAX_PROMPT_TOKENS = int(os.environ.get("LAB_MAX_PROMPT_TOKENS", "128"))
MAX_OUTPUT_TOKENS = int(os.environ.get("LAB_MAX_OUTPUT_TOKENS", "128"))
MAX_PROMPT_CHARS = 8000

torch.set_grad_enabled(False)
torch.set_num_threads(max(1, os.cpu_count() or 1))

app = FastAPI(title="tokenscope lab server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

print(f"[lab] loading {MODEL} …", flush=True)
tokenizer = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForCausalLM.from_pretrained(MODEL, attn_implementation="eager", dtype=torch.float32)
model.eval()
cfg = model.config
N_LAYERS = int(getattr(cfg, "n_layer", getattr(cfg, "num_hidden_layers", 0)))
N_HEADS = int(getattr(cfg, "n_head", getattr(cfg, "num_attention_heads", 0)))
D_MODEL = int(getattr(cfg, "n_embd", getattr(cfg, "hidden_size", 0)))
D_HEAD = D_MODEL // max(1, N_HEADS)
VOCAB = int(cfg.vocab_size)
EOS = tokenizer.eos_token_id
# Positions the model has embeddings for; GPT-2 indexes past the end of `wpe` and crashes beyond it.
CONTEXT = int(getattr(cfg, "n_positions", None) or getattr(cfg, "max_position_embeddings", None) or 1024)


def find_blocks() -> tuple[list[Any], str]:
    if hasattr(model, "transformer") and hasattr(model.transformer, "h"):
        return list(model.transformer.h), "gpt2"
    if hasattr(model, "gpt_neox"):
        return list(model.gpt_neox.layers), "neox"
    raise RuntimeError("unsupported architecture: expected GPT-2 or GPT-NeoX")


BLOCKS, ARCH = find_blocks()
FFN_HIDDEN = int(getattr(cfg, "n_inner", None) or getattr(cfg, "intermediate_size", 4 * D_MODEL) or 4 * D_MODEL)

# Capture post-activation MLP outputs with forward hooks.
_mlp_acts: dict[int, torch.Tensor] = {}


def _hook(layer: int):
    def fn(_mod, _inp, out):
        _mlp_acts[layer] = out.detach()

    return fn


for _l, _b in enumerate(BLOCKS):
    _b.mlp.act.register_forward_hook(_hook(_l))

print(f"[lab] ready: {MODEL} · {N_LAYERS} layers · {N_HEADS} heads · d={D_MODEL} · vocab={VOCAB} · context={CONTEXT}", flush=True)


class RunRequest(BaseModel):
    prompt: str = Field(max_length=MAX_PROMPT_CHARS)
    # Clamped to LAB_MAX_OUTPUT_TOKENS rather than rejected, so a client unaware of the limit still runs.
    max_tokens: int = Field(48, ge=1)
    temperature: float = Field(0.8, ge=0.0, le=2.0)
    top_k: int = Field(40, ge=0, le=VOCAB)
    top_p: float = Field(0.95, ge=0.0, le=1.0)
    seed: int | None = None


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def r4(x: Any) -> float:
    return round(float(x), 4)


def token_info(tid: int, index: int) -> dict[str, Any]:
    text = tokenizer.decode([tid])
    return {"id": int(tid), "text": text, "bytes": list(text.encode("utf-8")), "index": index}


def attn_rows(layer_attn: torch.Tensor) -> list[list[list[float]]]:
    """[heads, q, k] → nested lists, 4 decimals. Row q stops at k = q: the causal mask zeroes the rest."""
    return [[[r4(v) for v in row[: q + 1]] for q, row in enumerate(head)] for head in layer_attn.tolist()]


def pca2d(x: torch.Tensor) -> list[list[float]]:
    n = x.shape[0]
    if n < 3:
        return [[0.0, 0.0] for _ in range(n)]
    xc = x - x.mean(0, keepdim=True)
    _u, _s, v = torch.pca_lowrank(xc, q=2, center=False)
    p = xc @ v[:, :2]
    m = p.abs().max().clamp_min(1e-9)
    return [[r4(a), r4(b)] for a, b in (p / m).tolist()]


def ffn_stats(layer: int) -> dict[str, Any]:
    a = _mlp_acts[layer][0, -1]
    sparsity = float((a <= 0.01).float().mean())
    idx = torch.linspace(0, a.numel() - 1, 32).long()
    sample = [max(0.0, r4(v)) for v in a[idx].tolist()]
    return {"sparsity": r4(sparsity), "sample": sample}


def residual_norms(hidden_states: tuple[torch.Tensor, ...]) -> list[float]:
    return [r4(hidden_states[l + 1][0, -1].norm()) for l in range(N_LAYERS)]


def filtered_probs(logits: torch.Tensor, temperature: float, top_k: int, top_p: float) -> torch.Tensor:
    if temperature <= 1e-6:
        out = torch.zeros_like(logits)
        out[int(torch.argmax(logits))] = 1.0
        return out
    probs = torch.softmax(logits / temperature, -1)
    if top_k > 0 and top_k < probs.numel():
        kth = torch.topk(probs, top_k).values[-1]
        probs = torch.where(probs >= kth, probs, torch.zeros_like(probs))
    if top_p < 1.0:
        sp, si = torch.sort(probs, descending=True)
        cum = torch.cumsum(sp, 0)
        sp[(cum - sp) > top_p] = 0.0
        probs = torch.zeros_like(probs).scatter(0, si, sp)
    return probs / probs.sum()


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "model": MODEL,
        "arch": ARCH,
        "nLayers": N_LAYERS,
        "nHeads": N_HEADS,
        "dModel": D_MODEL,
        "dHead": D_HEAD,
        "vocabSize": VOCAB,
        "contextLength": CONTEXT,
        "maxPromptTokens": min(MAX_PROMPT_TOKENS, CONTEXT - 1),
        "maxOutputTokens": MAX_OUTPUT_TOKENS,
    }


def bad_request(message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=400)


@app.exception_handler(RequestValidationError)
async def validation_error(_req: Request, exc: RequestValidationError) -> JSONResponse:
    # FastAPI echoes each rejected value back; for the prompt that is up to MAX_PROMPT_CHARS of user text.
    errors = [{k: v for k, v in err.items() if k != "input"} for err in exc.errors()]
    return JSONResponse({"detail": errors}, status_code=422)


@app.post("/run", response_model=None)
def run(req: RunRequest) -> StreamingResponse | JSONResponse:
    ids = tokenizer.encode(req.prompt) or [EOS]
    n = len(ids)
    # Check the model's own window first: raising LAB_MAX_PROMPT_TOKENS cannot help past it.
    if n > CONTEXT - 1:
        return bad_request(f"Prompt is {n} tokens, over {MODEL}'s context window of {CONTEXT} (at least one reply token must fit).")
    if n > MAX_PROMPT_TOKENS:
        return bad_request(
            f"Prompt is {n} tokens; the lab server accepts at most {MAX_PROMPT_TOKENS} "
            f"(set LAB_MAX_PROMPT_TOKENS to raise it, up to {CONTEXT - 1} for {MODEL})."
        )
    wanted = min(req.max_tokens, MAX_OUTPUT_TOKENS)
    # Prompt plus reply must fit the window the model was trained on.
    max_tokens = min(wanted, CONTEXT - n)

    def gen() -> Iterator[str]:
        try:
            yield from generate(req, ids, max_tokens, context_limited=max_tokens < wanted)
        except Exception as err:  # noqa: BLE001 — anything mid-stream must reach the client as an event
            print(f"[lab] run failed: {err!r}", flush=True)
            yield sse("error", {"message": f"Lab server: {type(err).__name__}: {err}"})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"cache-control": "no-cache", "x-accel-buffering": "no"})


# Grad mode is per thread and Starlette resumes this generator on worker threads, so the
# module-level set_grad_enabled(False) does not reach it; the decorator re-applies it on every resume.
@torch.inference_mode()
def generate(req: RunRequest, ids: list[int], max_tokens: int, context_limited: bool) -> Iterator[str]:
    t0 = time.perf_counter()

    def now() -> int:
        return int((time.perf_counter() - t0) * 1000)

    if req.seed is not None:
        torch.manual_seed(req.seed)
        random.seed(req.seed)

    yield sse(
        "meta",
        {
            "model": MODEL,
            "arch": ARCH,
            "nLayers": N_LAYERS,
            "nHeads": N_HEADS,
            "dModel": D_MODEL,
            "dHead": D_HEAD,
            "ffnHidden": FFN_HIDDEN,
            "vocabSize": VOCAB,
            "contextLength": CONTEXT,
            "tokenizer": f"{MODEL} BPE",
            "t": now(),
        },
    )

    yield sse("tokenized", {"tokens": [token_info(i, k) for k, i in enumerate(ids)], "t": now()})

    wte = model.get_input_embeddings().weight
    e = wte[ids]
    positional: list[list[float]] | None = None
    if ARCH == "gpt2":
        positional = [[r4(v) for v in row] for row in model.transformer.wpe.weight[: len(ids), :SHOWN_DIMS].tolist()]
    yield sse(
        "embedded",
        {
            "dims": D_MODEL,
            "shownDims": SHOWN_DIMS,
            "vectors": [[r4(v) for v in row] for row in e[:, :SHOWN_DIMS].tolist()],
            "positional": positional,
            "positionKind": "learned" if positional is not None else "rotary",
            "projected": pca2d(e),
            "t": now(),
        },
    )

    input_ids = torch.tensor([ids])
    out = model(input_ids, use_cache=True, output_attentions=True, output_hidden_states=True)
    past = out.past_key_values
    yield sse(
        "prefill",
        {
            "attentions": [attn_rows(a[0]) for a in out.attentions],
            "residualNorms": residual_norms(out.hidden_states),
            "ffn": [ffn_stats(l) for l in range(N_LAYERS)],
            "t": now(),
        },
    )

    logits = out.logits[0, -1]
    context = list(ids)
    generated: list[int] = []
    step_attn: list[list[list[float]]] | None = None
    step_res: list[float] | None = None
    step_ffn: list[dict[str, Any]] | None = None
    stop = "max_tokens"
    text_so_far = ""

    for step in range(max_tokens):
        probs = filtered_probs(logits, req.temperature, req.top_k, req.top_p)
        chosen = int(torch.multinomial(probs, 1))
        soft = torch.softmax(logits / max(req.temperature, 1e-6), -1)
        _top_v, top_i = torch.topk(logits, TOP_N)
        cand_ids = top_i.tolist()
        if chosen not in cand_ids:
            cand_ids.append(chosen)
        cands = [
            {"token": token_info(i, len(context)), "logit": r4(logits[i]), "prob": r4(soft[i])}
            for i in cand_ids
        ]
        cands.sort(key=lambda c: -c["logit"])
        tail = max(0.0, 1.0 - sum(c["prob"] for c in cands))
        filt = [float(probs[c["token"]["id"]]) for c in cands]
        rank = next(k for k, c in enumerate(cands) if c["token"]["id"] == chosen)
        roll = sum(filt[:rank]) + filt[rank] * random.random()
        is_eos = chosen == EOS
        yield sse(
            "step",
            {
                "step": step,
                "seqLen": len(context),
                "token": token_info(chosen, len(context)),
                "candidates": cands,
                "tailMass": r4(tail),
                "prob": r4(filt[rank]),
                "rank": rank,
                "roll": r4(roll),
                "isEos": is_eos,
                "attentions": step_attn,
                "residualNorms": step_res,
                "ffn": step_ffn,
                "t": now(),
            },
        )
        if is_eos:
            stop = "end_turn"
            break
        context.append(chosen)
        generated.append(chosen)
        full = tokenizer.decode(generated)
        piece = full[len(text_so_far) :]
        text_so_far = full
        yield sse("chunk", {"text": piece, "tokenId": chosen, "t": now()})
        if step == max_tokens - 1:
            if context_limited:
                stop = "context_window"
            break

        out = model(torch.tensor([[chosen]]), past_key_values=past, use_cache=True, output_attentions=True, output_hidden_states=True)
        past = out.past_key_values
        logits = out.logits[0, -1]
        step_attn = [[[r4(v) for v in head[0]] for head in layer[0].tolist()] for layer in out.attentions]
        step_res = residual_norms(out.hidden_states)
        step_ffn = [ffn_stats(l) for l in range(N_LAYERS)]

    yield sse(
        "done",
        {"stopReason": stop, "usage": {"input": len(ids), "output": len(generated)}, "text": text_so_far, "t": now()},
    )
