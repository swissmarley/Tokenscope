import { decode, encode, vocabularySize } from 'gpt-tokenizer/encoding/r50k_base';
import { EOS_TOKEN_ID, type Token } from '../pipeline/events';

/**
 * Real byte-pair tokenization with the GPT-2 vocabulary (r50k_base).
 * Claude's tokenizer is different and not public, so in Mock and Live modes
 * these chips are labelled "GPT-2 tokenizer" — real BPE, but not that model's.
 */

export const TOKENIZER_NAME = 'GPT-2 BPE (r50k_base)';
export const VOCAB_SIZE = vocabularySize;

const encoder = new TextEncoder();

export function tokenText(id: number): string {
  if (id === EOS_TOKEN_ID) return '<|endoftext|>';
  return decode([id]);
}

export function makeToken(id: number, index: number): Token {
  const text = tokenText(id);
  return { id, text, bytes: Array.from(encoder.encode(text)), index };
}

export function tokenize(text: string, startIndex = 0): Token[] {
  return encode(text).map((id, i) => makeToken(id, startIndex + i));
}

export function countTokens(text: string): number {
  return encode(text).length;
}

export function eosToken(index: number): Token {
  return { id: EOS_TOKEN_ID, text: '<|endoftext|>', bytes: [], index };
}

/** Byte string shown when hovering a chip, e.g. "0x20 0x74 0x68". */
export function formatBytes(bytes: readonly number[]): string {
  return bytes.map((b) => '0x' + b.toString(16).padStart(2, '0')).join(' ');
}
