import { fileURLToPath } from 'node:url';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { anthropic } from './providers/anthropic';
import { openai } from './providers/openai';
import type { ChatRequest, Provider } from './providers/types';
import { openSse } from './sse';

// The key lives in server/.env (or the project-root .env) and never leaves this process.
dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) });
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const PORT = Number(process.env.PORT ?? 8787);
// Loopback only by default: the proxy spends your API key for anyone who can reach it.
const HOST = process.env.PROXY_HOST || '127.0.0.1';
const PROVIDERS: Record<string, Provider> = { anthropic, openai };
const provider: Provider = PROVIDERS[process.env.LLM_PROVIDER ?? 'anthropic'] ?? anthropic;
const LAB_URL = (process.env.LAB_SERVER_URL ?? 'http://localhost:8788').replace(/\/$/, '');

const app = express();
app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }));
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', async (_req, res) => {
  let lab: { ok: boolean; model?: string } = { ok: false };
  try {
    const r = await fetch(`${LAB_URL}/health`, { signal: AbortSignal.timeout(800) });
    if (r.ok) lab = { ok: true, ...((await r.json()) as { model?: string }) };
  } catch {
    /* lab server not running */
  }
  res.json({ ok: true, provider: provider.name, hasKey: provider.hasKey(), model: provider.defaultModel(), lab });
});

function validate(body: unknown): ChatRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.messages) || b.messages.length === 0) return null;
  const messages = b.messages
    .filter((m): m is { role: 'user' | 'assistant'; content: string } => {
      if (!m || typeof m !== 'object') return false;
      const x = m as Record<string, unknown>;
      return (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string';
    })
    .map((m) => ({ role: m.role, content: m.content.slice(0, 20000) }));
  if (messages.length === 0) return null;
  const req: ChatRequest = {
    model: typeof b.model === 'string' ? b.model.slice(0, 100) : '',
    max_tokens: Math.min(4096, Math.max(1, Number(b.max_tokens) || 1024)),
    temperature: Math.min(2, Math.max(0, Number(b.temperature) || 0)),
    messages,
  };
  if (typeof b.system === 'string' && b.system.trim()) req.system = b.system.slice(0, 8000);
  return req;
}

app.post('/api/chat', async (req, res) => {
  const chat = validate(req.body);
  if (!chat) {
    res.status(400).json({ error: 'Body must include a non-empty messages array.' });
    return;
  }
  if (!provider.hasKey()) {
    res.status(503).json({ error: `No API key for provider "${provider.name}". Copy .env.example to server/.env and set it.` });
    return;
  }
  const controller = new AbortController();
  // `res` closes when the client goes away; `req` closes as soon as the body is read.
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  const send = openSse(res);
  try {
    await provider.stream(chat, send, controller.signal);
  } catch (err) {
    if (!controller.signal.aborted) send('error', { message: err instanceof Error ? err.message : String(err) });
  } finally {
    res.end();
  }
});

// Lab mode: forward to the Python server, which streams its own SSE.
app.post('/api/lab/run', async (req, res) => {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  try {
    const upstream = await fetch(`${LAB_URL}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) {
      // Pass the lab server's reason through (prompt too long, invalid setting, …).
      const raw = await upstream.text().catch(() => '');
      let body: unknown = { error: `Lab server responded ${upstream.status}` };
      try {
        body = JSON.parse(raw);
      } catch {
        /* not JSON */
      }
      res.status(upstream.status).json(body);
      return;
    }
    res.status(200);
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.flushHeaders();
    const reader = upstream.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: `Lab server unreachable at ${LAB_URL}: ${err instanceof Error ? err.message : String(err)}` });
  } finally {
    res.end();
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[api] proxy on http://${HOST}:${PORT} · provider=${provider.name} · key=${provider.hasKey() ? 'set' : 'missing'} · lab=${LAB_URL}`);
});
