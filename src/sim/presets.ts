export interface Preset {
  id: string;
  label: string;
  prompt: string;
  reply: string;
  /** What this prompt is good at showing off. */
  shows: string;
}

export const PRESETS: Preset[] = [
  {
    id: 'pronoun',
    label: 'Ambiguous pronoun',
    prompt: 'The trophy did not fit in the suitcase because it was too big. What was too big?',
    reply:
      'The trophy was too big. "It" refers to the trophy: a suitcase being too big would not stop something from fitting inside it.',
    shows: 'watch "it" attend to both "trophy" and "suitcase" in the attention scene',
  },
  {
    id: 'rare',
    label: 'Rare word',
    prompt: 'What does antidisestablishmentarianism mean, in one sentence?',
    reply:
      'It is opposition to removing the Church of England as the official state church, a 19th-century position now famous mostly as a very long word.',
    shows: 'a rare word shatters into five sub-word tokens',
  },
  {
    id: 'math',
    label: 'Math question',
    prompt: 'What is 17 × 24? Show your work briefly.',
    reply: '17 × 24 = 17 × 20 + 17 × 4 = 340 + 68 = 408.',
    shows: 'digits are their own tokens and the next-token distribution gets very peaked',
  },
  {
    id: 'greeting',
    label: 'Very short greeting',
    prompt: 'hi',
    reply: 'Hi there! How can I help you today?',
    shows: 'a one-token prompt: almost all the work is in the decode loop',
  },
  {
    id: 'sky',
    label: 'Why is the sky blue?',
    prompt: 'Why is the sky blue? Answer in one sentence.',
    reply:
      'Sunlight scatters off air molecules, and shorter blue wavelengths scatter far more than red ones, so blue light reaches your eyes from every direction.',
    shows: 'a longer reply: see tokens-per-second settle in the streaming stats',
  },
];

export const DEFAULT_PRESET_ID = 'pronoun';

export function findPreset(prompt: string): Preset | undefined {
  const norm = prompt.trim().toLowerCase();
  return PRESETS.find((p) => p.prompt.toLowerCase() === norm);
}

export const GENERIC_MOCK_REPLY =
  'This is a canned reply from Mock mode, so it cannot actually answer that. Every stage you are watching is still the real pipeline shape; switch to Live API or Lab mode for a genuine answer.';
