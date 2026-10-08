import { afterEach, describe, expect, it } from 'vitest';
import { openai } from './openai';

describe('openai provider', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
  });

  it('needs a key for hosted endpoints, including the one in .env.example', () => {
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
    expect(openai.hasKey()).toBe(false);
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(openai.hasKey()).toBe(true);
  });

  it('needs no key for a local server such as Ollama', () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1';
    expect(openai.hasKey()).toBe(true);
  });

  it('falls back to the default model when OPENAI_MODEL is empty', () => {
    process.env.OPENAI_MODEL = '';
    expect(openai.defaultModel()).toBe('gpt-4o-mini');
    process.env.OPENAI_MODEL = 'llama3.2:1b';
    expect(openai.defaultModel()).toBe('llama3.2:1b');
  });
});
