/**
 * Trust Classification System (formerly "Suspicion")
 *
 * Instead of asking the LLM to generate numeric deltas (which smaller models struggle with),
 * we provide 10 discrete classes for the LLM to choose from. This is much easier for models
 * to understand and produces more reliable results.
 *
 * The classes map to trust level changes (deltas) that get applied to the 0-100 scale.
 * Lower = more trusted, Higher = less trusted
 * 
 * NOTE: We use "trust" terminology in prompts instead of "suspicion" to avoid 
 * triggering safety filters on smaller LLMs that may misinterpret the context.
 */

export interface SuspicionClass {
  id: string;           // Short identifier for LLM to use
  label: string;        // Human-readable description
  delta: number;        // Change to apply to trust level (-25 to +25)
  emoji: string;        // Visual indicator
}

/**
 * 10 Trust Classes from most trusted to least trusted
 *
 * Scale breakdown:
 * - Classes 1-3: Trust (negative delta, lowers distrust)
 * - Classes 4-6: Neutral (minimal/no change)
 * - Classes 7-10: Distrust (positive delta, raises distrust)
 */
export const SUSPICION_CLASSES: SuspicionClass[] = [
  // Trust indicators (negative deltas - LOWER suspicion)
  {
    id: 'CLEARED',
    label: 'Completely cleared - saw them do visual task or have solid alibi',
    delta: -25,
    emoji: '✅'
  },
  {
    id: 'VOUCHED',
    label: 'Strongly trust - they vouched for me or helped me',
    delta: -15,
    emoji: '🤝'
  },
  {
    id: 'SAFE',
    label: 'Seems safe - doing tasks, acting normal',
    delta: -8,
    emoji: '👍'
  },
  
  // Neutral indicators (minimal change)
  {
    id: 'NO_INFO',
    label: 'No new information - just passing by',
    delta: 0,
    emoji: '➖'
  },
  {
    id: 'NEUTRAL',
    label: 'Neutral interaction - nothing suspicious or trustworthy',
    delta: 0,
    emoji: '😐'
  },
  {
    id: 'UNCERTAIN',
    label: 'Slightly uncertain - something felt off but not sure',
    delta: 3,
    emoji: '🤔'
  },
  
  // Suspicion indicators (positive deltas - RAISE suspicion)
  {
    id: 'ODD',
    label: 'Odd behavior - not doing tasks, wandering strangely',
    delta: 8,
    emoji: '👀'
  },
  {
    id: 'SUSPICIOUS',
    label: 'Suspicious - following people, avoiding tasks, lying',
    delta: 12,
    emoji: '🚨'
  },
  {
    id: 'VERY_SUS',
    label: 'Very suspicious - caught lying, near bodies, no alibi',
    delta: 18,
    emoji: '⚠️'
  },
  {
    id: 'CAUGHT',
    label: 'Caught red-handed - saw them vent or kill',
    delta: 25,
    emoji: '🔴'
  }
];

/**
 * Map from class ID to the full class object for quick lookup
 */
export const SUSPICION_CLASS_MAP: Record<string, SuspicionClass> = Object.fromEntries(
  SUSPICION_CLASSES.map(c => [c.id, c])
);

/**
 * Get the list of class IDs for prompt generation
 */
export function getSuspicionClassIds(): string[] {
  return SUSPICION_CLASSES.map(c => c.id);
}

/**
 * Build a formatted string describing all classes for the LLM prompt
 */
export function buildSuspicionClassPrompt(): string {
  return SUSPICION_CLASSES.map(c => 
    `${c.id}: ${c.label}`
  ).join('\n');
}

/**
 * Parse a suspicion class from LLM response and return the delta
 * Handles various formats: exact match, partial match, with/without quotes
 */
export function parseSuspicionClass(classStr: string): SuspicionClass | null {
  if (!classStr) return null;
  
  // Normalize: uppercase, trim, remove quotes
  const normalized = classStr.toUpperCase().trim().replace(/['"]/g, '');
  
  // Try exact match first
  if (SUSPICION_CLASS_MAP[normalized]) {
    return SUSPICION_CLASS_MAP[normalized];
  }
  
  // Try partial match (in case LLM outputs something like "SUSPICIOUS behavior")
  for (const cls of SUSPICION_CLASSES) {
    if (normalized.includes(cls.id) || cls.id.includes(normalized)) {
      return cls;
    }
  }
  
  // Try matching by label keywords
  const labelKeywords: Record<string, string> = {
    'CLEARED': 'cleared|visual|alibi|innocent',
    'VOUCHED': 'vouch|helped|trust',
    'SAFE': 'safe|normal|task',
    'NO_INFO': 'no info|nothing|passing',
    'NEUTRAL': 'neutral',
    'UNCERTAIN': 'uncertain|off|maybe|unsure',
    'ODD': 'odd|strange|wander',
    'SUSPICIOUS': 'suspicious|lying|follow',
    'VERY_SUS': 'very sus|caught|body|no alibi',
    'CAUGHT': 'caught|vent|kill|saw them'
  };
  
  for (const [classId, pattern] of Object.entries(labelKeywords)) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(normalized)) {
      return SUSPICION_CLASS_MAP[classId];
    }
  }
  
  return null;
}

/**
 * Get default class for when no classification is provided
 */
export function getDefaultSuspicionClass(): SuspicionClass {
  return SUSPICION_CLASS_MAP['NEUTRAL'];
}
