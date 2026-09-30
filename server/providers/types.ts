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

/** Normalised stream events sent to the browser. */
export type Send = (event: 'meta' | 'delta' | 'done' | 'error', data: unknown) => void;

export interface Provider {
  name: string;
  hasKey(): boolean;
  defaultModel(): string | null;
  stream(req: ChatRequest, send: Send, signal: AbortSignal): Promise<void>;
}
