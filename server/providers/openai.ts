import { readSse } from '../sse';
import type { ChatRequest, Provider, Send, Usage } from './types';

interface Chunk {
  model?: string;
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
}

const STOP: Record<string, string> = { stop: 'end_turn', length: 'max_tokens', content_filter: 'content_filter' };

/** Any OpenAI-compatible /chat/completions endpoint (OpenAI, Ollama, vLLM, …). */
export const openai: Provider = {
  name: 'openai',
  hasKey: () => Boolean(process.env.OPENAI_API_KEY) || Boolean(process.env.OPENAI_BASE_URL),
  defaultModel: () => process.env.OPENAI_MODEL ?? 'gpt-4o-mini',

  async stream(req: ChatRequest, send: Send, signal: AbortSignal): Promise<void> {
    const base = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    const key = process.env.OPENAI_API_KEY ?? '';
    const messages: Array<{ role: string; content: string }> = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    messages.push(...req.messages);
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        model: req.model || this.defaultModel(),
        max_tokens: req.max_tokens,
        temperature: req.temperature,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI-compatible ${res.status}: ${text.slice(0, 400)}`);
    }
    let stopReason = 'unknown';
    const usage: Usage = { input: 0, output: 0 };
    let metaSent = false;
    for await (const frame of readSse(res.body, signal)) {
      if (frame.data.trim() === '[DONE]') break;
      let chunk: Chunk;
      try {
        chunk = JSON.parse(frame.data) as Chunk;
      } catch {
        continue;
      }
      if (!metaSent) {
        metaSent = true;
        send('meta', { provider: 'openai', model: chunk.model ?? req.model });
      }
      const choice = chunk.choices?.[0];
      const text = choice?.delta?.content;
      if (text) send('delta', { text, raw: frame.raw });
      if (choice?.finish_reason) stopReason = STOP[choice.finish_reason] ?? choice.finish_reason;
      if (chunk.usage) {
        usage.input = chunk.usage.prompt_tokens;
        usage.output = chunk.usage.completion_tokens;
      }
    }
    send('done', { stopReason, usage });
  },
};
