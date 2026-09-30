import { readSse } from '../sse';
import type { ChatRequest, Provider, Send, Usage } from './types';

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

export const anthropic: Provider = {
  name: 'anthropic',
  hasKey: () => Boolean(process.env.ANTHROPIC_API_KEY),
  defaultModel: () => process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5',

  async stream(req: ChatRequest, send: Send, signal: AbortSignal): Promise<void> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set in server/.env');
    const base = (process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '');
    const body: Record<string, unknown> = {
      model: req.model || this.defaultModel(),
      max_tokens: req.max_tokens,
      temperature: req.temperature,
      messages: req.messages,
      stream: true,
    };
    if (req.system) body.system = req.system;

    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`Anthropic ${res.status}: ${text.slice(0, 400)}`);
    }

    let stopReason = 'unknown';
    const usage: Usage = { input: 0, output: 0 };
    for await (const frame of readSse(res.body, signal)) {
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
  },
};
