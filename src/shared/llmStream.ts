import { parseSse } from '../pipeline/sources/sse';

/**
 * Streams a chat completion from Anthropic or any OpenAI-compatible endpoint
 * and normalises it into `meta` / `delta` / `done` / `error` events.
 * Used by the Node proxy (key from server/.env) and, when the user opts in,
 * directly from the browser (key from their own localStorage).
 */

export interface ChatRequest {
  model: string;
  max_tokens: number;
  temperature: number;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface Usage {
  input: number;
  output: number;
}

export type StreamEventName = 'meta' | 'delta' | 'done' | 'error';
export type Send = (event: StreamEventName, data: unknown) => void;

export interface StreamConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  baseUrl?: string;
  /** Adds the CORS opt-in header Anthropic requires for browser calls. */
  fromBrowser?: boolean;
}

export const DEFAULT_BASE: Record<StreamConfig['provider'], string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
};

/** Model used when the request leaves it empty and nothing else is configured. */
export const DEFAULT_MODEL: Record<StreamConfig['provider'], string> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-4o-mini',
};

/**
 * Whether an OpenAI-compatible endpoint can be called without a key: only a server on
 * this machine or a private network (Ollama, vLLM, LM Studio). Hosted APIs answer 401.
 */
export function keyOptional(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  let host: string;
  try {
    host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === 'host.docker.internal' ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

const STOP_MAP: Record<string, string> = { stop: 'end_turn', length: 'max_tokens', content_filter: 'content_filter' };

export async function streamChat(cfg: StreamConfig, req: ChatRequest, send: Send, signal: AbortSignal): Promise<void> {
  if (cfg.provider === 'anthropic') return streamAnthropic(cfg, req, send, signal);
  return streamOpenAI(cfg, req, send, signal);
}

interface MessageStart {
  type: 'message_start';
  message: { model: string; usage: { input_tokens: number; output_tokens: number } };
}
interface ContentBlockDelta {
  type: 'content_block_delta';
  delta: { type: string; text?: string };
}
interface MessageDelta {
  type: 'message_delta';
  delta: { stop_reason: string | null };
  usage: { output_tokens: number };
}
interface ErrorEvent {
  type: 'error';
  error: { type: string; message: string };
}

async function streamAnthropic(cfg: StreamConfig, req: ChatRequest, send: Send, signal: AbortSignal): Promise<void> {
  const base = (cfg.baseUrl || DEFAULT_BASE.anthropic).replace(/\/$/, '');
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.max_tokens,
    temperature: req.temperature,
    messages: req.messages,
    stream: true,
  };
  if (req.system) body.system = req.system;
  const headers: Record<string, string> = {
    'x-api-key': cfg.apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
  if (cfg.fromBrowser) headers['anthropic-dangerous-direct-browser-access'] = 'true';

  let res = await fetch(`${base}/v1/messages`, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Newer models reject `temperature`; the knob still drives the (illustrative) sampling scene.
    if (res.status === 400 && /temperature/i.test(text) && 'temperature' in body) {
      delete body.temperature;
      res = await fetch(`${base}/v1/messages`, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } else {
      throw new Error(`Anthropic ${res.status}: ${text.slice(0, 400)}`);
    }
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 400)}`);
  }
  let stopReason = 'unknown';
  const usage: Usage = { input: 0, output: 0 };
  for await (const frame of parseSse(res.body, signal)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame.data);
    } catch {
      continue;
    }
    const ev = parsed as { type: string };
    switch (ev.type) {
      case 'message_start': {
        const m = ev as MessageStart;
        usage.input = m.message.usage.input_tokens;
        send('meta', { provider: 'anthropic', model: m.message.model, usage: { input: usage.input } });
        break;
      }
      case 'content_block_delta': {
        const d = ev as ContentBlockDelta;
        if (d.delta.type === 'text_delta' && d.delta.text) send('delta', { text: d.delta.text, raw: frame.raw });
        break;
      }
      case 'message_delta': {
        const d = ev as MessageDelta;
        if (d.delta.stop_reason) stopReason = d.delta.stop_reason;
        usage.output = d.usage.output_tokens;
        break;
      }
      case 'error': {
        const d = ev as ErrorEvent;
        throw new Error(`${d.error.type}: ${d.error.message}`);
      }
      default:
        break;
    }
  }
  send('done', { stopReason, usage });
}

interface Chunk {
  model?: string;
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
}

async function streamOpenAI(cfg: StreamConfig, req: ChatRequest, send: Send, signal: AbortSignal): Promise<void> {
  const base = (cfg.baseUrl || DEFAULT_BASE.openai).replace(/\/$/, '');
  const messages: Array<{ role: string; content: string }> = [];
  if (req.system) messages.push({ role: 'system', content: req.system });
  messages.push(...req.messages);
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify({
      model: req.model,
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
  for await (const frame of parseSse(res.body, signal)) {
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
    if (choice?.finish_reason) stopReason = STOP_MAP[choice.finish_reason] ?? choice.finish_reason;
    if (chunk.usage) {
      usage.input = chunk.usage.prompt_tokens;
      usage.output = chunk.usage.completion_tokens;
    }
  }
  send('done', { stopReason, usage });
}
