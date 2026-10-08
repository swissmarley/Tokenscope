import { DEFAULT_MODEL, streamChat } from '../../src/shared/llmStream';
import type { ChatRequest, Provider, Send } from './types';

export const anthropic: Provider = {
  name: 'anthropic',
  hasKey: () => Boolean(process.env.ANTHROPIC_API_KEY),
  defaultModel: () => process.env.ANTHROPIC_MODEL || DEFAULT_MODEL.anthropic,

  async stream(req: ChatRequest, send: Send, signal: AbortSignal): Promise<void> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set in server/.env');
    const cfg = { provider: 'anthropic' as const, apiKey: key, ...(process.env.ANTHROPIC_BASE_URL ? { baseUrl: process.env.ANTHROPIC_BASE_URL } : {}) };
    await streamChat(cfg, { ...req, model: req.model || this.defaultModel() || '' }, send, signal);
  },
};
