import type { PipelineEvent } from '../pipeline/events';
import type { ViewState } from '../pipeline/derive';

/**
 * Plain-language and math-flavoured copy for every event type. Numbers come
 * from the event itself so the text is never generic.
 */

export interface Explanation {
  title: string;
  /** "Explain like I'm new" */
  simple: string;
  /** "Show the math" */
  math: string;
  /** "Go deeper" — one paragraph for the curious. */
  deeper: string;
}

const fmt = (n: number, d = 0): string =>
  n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (p: number): string => `${(p * 100).toFixed(p < 0.01 ? 2 : 1)}%`;
const q = (s: string): string => `“${s.replace(/\n/g, '⏎')}”`;

export function explainEvent(e: PipelineEvent, view: ViewState): Explanation {
  switch (e.type) {
    case 'run_start':
      return {
        title: 'A run begins',
        simple: `You pressed Send. Everything from here to the last character of the reply is one run against ${e.model}.`,
        math: `Run ${e.runId}: mode=${e.mode}, temperature=${e.settings.temperature}, top_k=${e.settings.topK}, top_p=${e.settings.topP}, max_tokens=${e.settings.maxTokens}.`,
        deeper:
          'A chat model has no memory between runs. Whatever context it needs — the system prompt, earlier turns — must be sent again every time, which is why the request body below carries the whole conversation.',
      };
    case 'request_built':
      return {
        title: 'The request is assembled',
        simple: `Your message is wrapped in a JSON envelope: which model, how long the reply may be, a system prompt, and the messages array. It is ${fmt(e.bytes)} bytes on the wire.`,
        math: `POST body = ${fmt(e.bytes)} B. messages[0].content is your prompt; max_tokens=${e.body.max_tokens} caps the decode loop; temperature=${e.body.temperature} scales the logits before softmax.`,
        deeper:
          'Providers differ in field names, but the shape is universal: model id, sampling parameters, and an ordered list of role-tagged messages. “stream: true” asks the server to send tokens as they are produced instead of waiting for the whole reply.',
      };
    case 'request_sent':
      return {
        title: 'Off to the model',
        simple: `The packet travels browser → proxy → API → model server. Until the first token comes back you are waiting on the network plus “prefill”, the model reading your whole prompt. Total: ~${fmt(e.totalMs)} ms.`,
        math: `time_to_first_token ≈ Σ hops = ${e.hops.map((h) => `${h.ms}`).join(' + ')} = ${fmt(e.totalMs)} ms.`,
        deeper:
          'The API key never leaves the proxy: the browser talks to a small server you control, which adds the secret header and streams the response back. That is the only safe way to call a paid API from a web page.',
      };
    case 'tokenized':
      return {
        title: 'Text becomes numbers',
        simple: `The model cannot read letters. Your ${fmt(e.tokens.length)} token${e.tokens.length === 1 ? '' : 's'} are integer IDs from a fixed vocabulary of ${fmt(e.vocabSize)} pieces. Common words are one token; rare words shatter into several; a leading space usually belongs to the word after it.`,
        math: `BPE: bytes → merge the most frequent adjacent pair repeatedly using a learned merge table until no merge applies. ids ∈ [0, ${fmt(e.vocabSize - 1)}]. Sequence length n = ${e.tokens.length} (+${e.hiddenTokenCount} hidden system/template tokens).`,
        deeper:
          `Tokenizer: ${e.tokenizer}. Byte-pair encoding was chosen because it never fails on unknown text — worst case it falls back to raw bytes — while keeping frequent words compact. Billing, context limits and speed are all measured in these tokens.`,
      };
    case 'embedded': {
      const real = e.fidelity === 'real';
      return {
        title: 'IDs become vectors',
        simple: `Each ID looks up a row in a big table: a list of ${fmt(e.dims)} numbers that encodes what the model has learned about that token. Similar tokens sit near each other. A position pattern is added so the model can tell “dog bites man” from “man bites dog”.`,
        math: real
          ? `x_i = wte[id_i] + wpe[i], both learned tables with d = ${e.dims} (showing ${e.shownDims} dims). The 2-D scatter is a PCA of the real ${e.vectors.length} embedding rows.`
          : `x_i = E[id_i] + P[i], with E ∈ ℝ^{V×d}, d = ${e.dims} (showing ${e.shownDims}). Sinusoidal P: P[i, 2k] = sin(i / 10000^{2k/d}), P[i, 2k+1] = cos(·). The 2-D scatter is a PCA of the ${e.vectors.length} rows.`,
        deeper: real
          ? 'These rows come straight out of the model’s embedding matrices. GPT-2 learns its position vectors (wpe) rather than using a fixed sine pattern; newer models rotate query/key vectors by position (RoPE) instead of adding anything. 768-D geometry only partly survives a 2-D projection.'
          : 'The embedding table is learned end to end — nobody designs the numbers. Models like GPT-2 learn position vectors too; newer models rotate query/key vectors by position (RoPE) instead of adding anything. The scatter you see is illustrative: real 768-D geometry only partly survives a 2-D projection.',
      };
    }
    case 'layer_start':
      return {
        title: `Layer ${e.layer + 1} of ${e.nLayers} begins`,
        simple: `The ${fmt(e.seqLen)} vectors enter block ${e.layer + 1}. Every block does the same two things: attention (tokens exchange information) and a feed-forward network (each token thinks on its own).`,
        math: `h^{(${e.layer})} ∈ ℝ^{${e.seqLen}×d}. Block: h ← h + Attn(LN(h)); h ← h + FFN(LN(h)). The two “+ h” terms are the residual connections.`,
        deeper:
          'Residual connections mean each block only has to learn a correction to what came before, which is what makes stacks of dozens of layers trainable. Early layers tend to handle syntax and local structure; later layers, meaning and task-specific behaviour.',
      };
    case 'attention': {
      const rows = e.heads[0]?.length ?? 0;
      return {
        title: `Attention, layer ${e.layer + 1}`,
        simple:
          rows > 1
            ? `Each of the ${fmt(e.seqLen)} tokens asks “which earlier tokens matter for me?” and gets ${e.nHeads} different answers — one per head. A token can only look backwards: the future is masked out.`
            : `Only the newest token asks the question this time — the ${fmt(e.seqLen - 1)} earlier tokens were already processed and their keys and values are cached.`,
        math: `Per head: Q = XW_Q, K = XW_K, V = XW_V (d_head = ${e.dHead}). A = softmax(QKᵀ / √${e.dHead} + M) with M_{ij} = −∞ for j > i. Output = AV, then the ${e.nHeads} heads are concatenated and projected.`,
        deeper:
          e.headKinds && e.headKinds.length
            ? `Heads here are labelled by the behaviour they illustrate (${Array.from(new Set(e.headKinds)).slice(0, 3).join('; ')}…). In real models interpretability researchers find exactly these species: previous-token heads, heads that park attention on the first token when they have nothing to say, and heads that route a pronoun back to its referent.`
            : 'Interpretability work keeps finding recognisable head types in real models: previous-token heads, attention sinks on the first token, and heads that resolve references.',
      };
    }
    case 'ffn':
      return {
        title: `Feed-forward network, layer ${e.layer + 1}`,
        simple: `Each token's vector is pushed through a wide two-layer network (${fmt(e.hiddenDim)} hidden units) on its own, no talking to neighbours. Most units stay quiet: ${pct(e.activationSparsity)} are effectively zero for this input.`,
        math: `FFN(x) = W_2 · act(W_1 x + b_1) + b_2, with W_1 ∈ ℝ^{${e.hiddenDim}×d}. act = GELU. Sparsity ≈ ${pct(e.activationSparsity)} of hidden units ≤ 0.`,
        deeper:
          'The FFN holds most of the parameters and is where a lot of factual knowledge seems to live — think of the hidden units as a huge bank of key→value memories, each one firing for a particular pattern in its input.',
      };
    case 'layer_end':
      return {
        title: `Layer ${e.layer + 1} done`,
        simple: `The block's output is added back onto its input (the glowing bypass line) and handed to the next block. The running vector keeps growing in size as layers stack up.`,
        math: `‖h^{(${e.layer + 1})}‖ ≈ ${fmt(e.residualNorm, 2)} (illustrative). The residual stream accumulates every block's contribution: h_L = x + Σ_l Δ_l.`,
        deeper:
          'Because everything is added onto one shared “residual stream”, later layers can read what earlier layers wrote and earlier information is never overwritten, only nudged.',
      };
    case 'kv_cache_update':
      return {
        title: e.phase === 'prefill' ? `Prefill fills the cache, layer ${e.layer + 1}` : `Cache grows, layer ${e.layer + 1}`,
        simple:
          e.phase === 'prefill'
            ? `While reading the prompt, every token's key and value vectors for this layer are stored. All ${fmt(e.positions.length)} positions are computed in one parallel pass — that is why prefill is fast per token.`
            : `The new token's key and value are appended (position ${e.positions[0]}). Nothing older is recomputed: ${fmt(e.computeSaved)} K/V projections have been skipped so far in this run.`,
        math: `K_cache[${e.layer}] ∈ ℝ^{${e.cachedTokens}×d}, V_cache likewise. Decode cost per step ∝ n (read cache) instead of n² (recompute). Saved so far: ${fmt(e.computeSaved)} projections.`,
        deeper:
          'The KV cache is why long conversations get slow and memory-hungry: it grows linearly with context length, per layer, per head. Techniques like grouped-query attention, sliding windows and cache compression all exist to shrink it.',
      };
    case 'logits': {
      const top = e.candidates[0];
      return {
        title: 'Scores for every possible next token',
        simple: `The final vector is compared with all ${fmt(e.vocabSize)} vocabulary entries, producing a score (“logit”) for each. Softmax turns scores into probabilities. Right now ${top ? q(top.token.text) : '…'} leads at ${top ? pct(top.prob) : '–'}; everything outside the top ${e.candidates.length} shares ${pct(e.tailMass)}.`,
        math: `z = h_L W_Uᵀ ∈ ℝ^{${fmt(e.vocabSize)}}. p_i = exp(z_i/T) / Σ_j exp(z_j/T), T = ${e.temperature}. Then keep top-k (k=${e.topK}) and the nucleus with cumulative mass ≥ ${e.topP}, renormalise.`,
        deeper:
          "Temperature below 1 sharpens the distribution (greedy-ish, repetitive); above 1 flattens it (creative, error-prone). Top-p adapts the candidate set to the model's confidence; top-k fixes its size. Drag the sliders to reshape the bars live.",
      };
    }
    case 'sampled':
      return {
        title: e.isEos ? 'The model chooses to stop' : `Chosen: ${q(e.token.text)}`,
        simple: e.isEos
          ? `The end-of-sequence token won the draw. That is the model's way of saying “I'm done”, and the loop stops.`
          : `A random number (${e.roll.toFixed(3)}) was drawn and landed on ${q(e.token.text)} — rank ${e.rank + 1} with probability ${pct(e.prob)}. Not always the top choice: that randomness is what makes replies vary.`,
        math: `u ~ U[0,1) = ${e.roll.toFixed(4)}; pick the smallest i with Σ_{j≤i} p_j > u → token ${e.token.id} (${q(e.token.text)}), p = ${pct(e.prob)}.`,
        deeper:
          'With temperature 0 the draw is replaced by argmax and the model becomes deterministic. Everything the model “decides” is this one draw, repeated once per token.',
      };
    case 'token_streamed':
      return {
        title: `Chunk ${e.chunkIndex + 1} on the wire`,
        simple: `Token ${e.token.id} is turned back into text, ${q(e.text)}, and pushed to your browser as a server-sent event before the next token is even computed.`,
        math: `event: content_block_delta · data: {"delta":{"text":${JSON.stringify(e.text)}}} · arrived at t = ${fmt(e.t)} ms.`,
        deeper:
          'Streaming does not make generation faster; it hides latency by letting you read while the model is still working. Chunks are usually one token but providers may coalesce several.',
      };
    case 'detokenized':
      return {
        title: 'Back to text',
        simple: `${fmt(e.tokens.length)} token IDs joined into ${fmt(e.text.length)} characters. Spaces, punctuation and word pieces glue back together exactly.`,
        math: `text = concat(decode(id_1), …, decode(id_${e.tokens.length})); BPE decoding is lossless: bytes → UTF-8.`,
        deeper:
          'Because tokens are byte sequences, a chunk can end mid-character in multi-byte scripts. Streaming clients buffer until a valid UTF-8 boundary before rendering.',
      };
    case 'done': {
      const n = view.tokens?.tokens.length ?? 0;
      return {
        title: `Done · ${e.stopReason}`,
        simple: `Stopped because of ${q(e.stopReason)}. First token after ${fmt(e.ttftMs)} ms, then ${fmt(e.tokensPerSec, 1)} tokens/s. ${fmt(e.usage.input)} tokens in, ${fmt(e.usage.output)} out.`,
        math: `TTFT = ${fmt(e.ttftMs)} ms; throughput = ${fmt(e.usage.output)} / ${fmt((e.totalMs - e.ttftMs) / 1000, 2)} s = ${fmt(e.tokensPerSec, 1)} tok/s; prompt tokens shown = ${n}.`,
        deeper:
          '“end_turn” means the model emitted its stop token; “max_tokens” means the cap cut it off mid-thought. Usage counts are what you are billed for — input tokens include the system prompt and any hidden template.',
      };
    }
  }
}
