import { streamChat } from '../../src/shared/llmStream';
import type { ChatRequest, Provider, Send } from './types';

/** Any OpenAI-compatible /chat/completions endpoint (OpenAI, Ollama, vLLM, …). */
export const openai: Provider = {
  name: 'openai',
  hasKey: () => Boolean(process.env.OPENAI_API_KEY) || Boolean(process.env.OPENAI_BASE_URL),
  defaultModel: () => process.env.OPENAI_MODEL ?? 'gpt-4o-mini',

  async stream(req: ChatRequest, send: Send, signal: AbortSignal): Promise<void> {
    const cfg = {
      provider: 'openai' as const,
      apiKey: process.env.OPENAI_API_KEY ?? '',
      ...(process.env.OPENAI_BASE_URL ? { baseUrl: process.env.OPENAI_BASE_URL } : {}),
    };
    await streamChat(cfg, { ...req, model: req.model || this.defaultModel() || '' }, send, signal);
  },
};
