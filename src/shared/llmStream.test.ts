import { describe, expect, it } from 'vitest';
import { keyOptional } from './llmStream';

describe('keyOptional', () => {
  it('allows keyless calls only to local or private-network servers', () => {
    for (const url of ['http://localhost:11434/v1', 'http://127.0.0.1:8000/v1', 'http://[::1]:11434/v1', 'http://192.168.1.20:11434/v1', 'http://10.0.0.5/v1', 'http://172.20.0.2/v1', 'http://gpu-box.local:11434/v1', 'http://host.docker.internal:11434/v1']) {
      expect(keyOptional(url), url).toBe(true);
    }
    for (const url of [undefined, '', 'https://api.openai.com/v1', 'https://api.groq.com/openai/v1', 'http://172.32.0.1/v1', 'not a url']) {
      expect(keyOptional(url), String(url)).toBe(false);
    }
  });
});
