/** Small word-class heuristics used to give illustrative internals structure. */

export type WordClass =
  | 'punct'
  | 'number'
  | 'pronoun'
  | 'function'
  | 'proper'
  | 'piece'
  | 'content'
  | 'special';

const PRONOUNS = new Set([
  'it', 'its', 'they', 'them', 'their', 'he', 'him', 'his', 'she', 'her', 'this', 'that',
  'these', 'those', 'who', 'which', 'what', 'i', 'you', 'we', 'me', 'us', 'my', 'your', 'our',
]);

const FUNCTION_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by',
  'from', 'as', 'is', 'was', 'were', 'are', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
  'not', "n't", 'no', 'so', 'if', 'then', 'than', 'because', 'while', 'when', 'where', 'how',
  'why', 'very', 'too', 'also', 'just', 'can', 'could', 'would', 'should', 'will', 'shall',
  'may', 'might', 'must', 'have', 'has', 'had', 'into', 'onto', 'about', 'over', 'under',
  'up', 'down', 'out', 'off', 'only', 'one', 'some', 'any', 'all', 'each', 'every', 'both',
  'more', 'most', 'less', 'much', 'many', 'such', 'own', 'same', 'other', 'here', 'there',
  'please', 'briefly', 'show', 'work', 'sentence',
]);

export function stripSpace(text: string): string {
  return text.replace(/^[\sĠ]+/, '');
}

export function hasLeadingSpace(text: string): boolean {
  return /^\s/.test(text);
}

export function classify(text: string): WordClass {
  if (text.startsWith('<|')) return 'special';
  const core = stripSpace(text);
  if (core.length === 0) return 'punct';
  if (/^[\d.,%]+$/.test(core)) return 'number';
  if (!/[A-Za-z]/.test(core)) return 'punct';
  const lower = core.toLowerCase();
  if (PRONOUNS.has(lower)) return 'pronoun';
  if (FUNCTION_WORDS.has(lower)) return 'function';
  if (!hasLeadingSpace(text) && /^[a-z]/.test(core)) return 'piece';
  if (/^[A-Z]/.test(core) && core.length > 1) return 'proper';
  return 'content';
}

export function isPunct(text: string): boolean {
  return classify(text) === 'punct';
}

export function isPronoun(text: string): boolean {
  return classify(text) === 'pronoun';
}

/** Tokens a pronoun could plausibly refer back to. */
export function isReferentCandidate(text: string): boolean {
  const c = classify(text);
  return (c === 'content' || c === 'proper') && stripSpace(text).length >= 3;
}

export const WORD_CLASS_LABEL: Record<WordClass, string> = {
  punct: 'punctuation',
  number: 'number',
  pronoun: 'pronoun',
  function: 'function word',
  proper: 'capitalised word',
  piece: 'word piece',
  content: 'content word',
  special: 'special token',
};
