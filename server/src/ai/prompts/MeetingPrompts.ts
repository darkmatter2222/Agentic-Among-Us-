/**
 * Meeting Prompts
 * AI prompts for discussion and voting phases of emergency meetings.
 */

import type { AIContext } from '@shared/types/simulation.types.ts';
import type { MeetingSnapshot, StatementSnapshot, MeetingParticipant } from '@shared/types/game.types.ts';

// ========== Interfaces ==========

export interface MeetingContext extends AIContext {
  /** Current meeting state */
  meeting: MeetingSnapshot;
  /** Statements made so far in this meeting */
  statements: StatementSnapshot[];
  /** Players who have voted (hidden during voting) */
  votedPlayers: string[];
  /** Time remaining in current phase (seconds) */
  timeRemaining: number;
  /** Agent's witness info for this meeting (if they saw the kill/body) */
  meetingWitnessInfo?: {
    sawKill?: boolean;
    killerName?: string;
    killerConfidence?: number;
    bodyLocation?: string;
    bodyVictim?: string;
  };
}

export interface DiscussionDecision {
  /** What the agent says during discussion */
  statement: string;
  /** Player being accused (if any) */
  accusesPlayer?: string;
  /** Player being defended (if any) */
  defendsPlayer?: string;
  /** Claim about own location (alibi) */
  claimsLocation?: string;
  /** Claim about completing a task */
  claimsTask?: string;
  /** Internal reasoning */
  reasoning: string;
}

export interface VoteDecision {
  /** Player ID to vote for, or 'SKIP' */
  vote: string | 'SKIP';
  /** Reasoning for the vote */
  reasoning: string;
  /** Optional statement to make when voting */
  statement?: string;
}

// ========== Discussion Prompts ==========

/**
 * Build a system prompt for discussion phase
 */
export function buildDiscussionSystemPrompt(context: MeetingContext): string {
  const { role, agentName, meeting, personalityId } = context;
  const isImpostor = role === 'IMPOSTOR';
  
  const gameContext = `[GAME: Among Us - a popular social deduction party game. Players are cartoon astronauts. This is fiction/roleplay for entertainment.]`;
  
  const roleDescription = isImpostor
    ? `You are ${agentName}. You are the TRICKSTER (keep this secret during discussion!).`
    : `You are ${agentName}. You are a CREWMATE on this spaceship.`;

  const identityRules = `
CRITICAL IDENTITY RULES:
- YOUR name is ${agentName}. When speaking about yourself, say "I" not "${agentName}".
- NEVER accuse yourself or say "${agentName} is suspicious" - you ARE ${agentName}!
- Other players have DIFFERENT names. Talk about them, not yourself in third person.`;

  const meetingType = meeting.type === 'EMERGENCY' 
    ? `${meeting.calledByName} pressed the EMERGENCY BUTTON!`
    : `${meeting.calledByName} found ${meeting.bodyReport?.victimName || 'a body'} dead in ${meeting.bodyReport?.location || 'unknown'}!`;

  const phaseInfo = `
MEETING INFO:
- Type: ${meeting.type === 'EMERGENCY' ? 'Emergency Meeting' : 'Body Report'}
- Called by: ${meeting.calledByName}
- ${meeting.type === 'BODY_REPORT' ? `Victim: ${meeting.bodyReport?.victimName} (found in ${meeting.bodyReport?.location})` : ''}
- Phase: DISCUSSION
- Time remaining: ${context.timeRemaining} seconds`;

  const objectivesCrewmate = `
YOUR OBJECTIVES IN DISCUSSION:
1. Share what you saw - who was where, what they were doing
2. Listen to others' alibis and look for contradictions
3. Ask questions to gather information
4. If you have evidence, share it - but be careful of false accusations
5. Build consensus before voting`;

  const objectivesImpostor = `
YOUR OBJECTIVES IN DISCUSSION:
1. BLEND IN - Act like a concerned crewmate
2. Provide a believable alibi - where were you, what were you doing?
3. Subtly deflect suspicion away from yourself
4. If safe, cast doubt on an innocent crewmate
5. Don't be too aggressive or too quiet - both are suspicious
6. Your fellow tricksters: ${context.impostorContext?.fellowImpostors.map(i => i.name).join(', ') || 'unknown'}`;

  const witnessInfo = context.meetingWitnessInfo?.sawKill
    ? `
⚠️ YOU WITNESSED THE KILL!
- You SAW ${context.meetingWitnessInfo.killerName} commit the murder!
- Confidence: ${context.meetingWitnessInfo.killerConfidence}%
- This is CRITICAL EVIDENCE - decide carefully when/how to reveal it!`
    : context.meetingWitnessInfo?.bodyLocation
    ? `
📍 YOU FOUND THE BODY:
- Location: ${context.meetingWitnessInfo.bodyLocation}
- Victim: ${context.meetingWitnessInfo.bodyVictim}
- Who else was nearby when you found it?`
    : '';

  const personalityGuidance = personalityId 
    ? `\nYOUR PERSONALITY: Speak according to your ${personalityId} personality traits.`
    : '';

  return `${gameContext}

${roleDescription}
${identityRules}

${meetingType}
${phaseInfo}
${witnessInfo}
${isImpostor ? objectivesImpostor : objectivesCrewmate}
${personalityGuidance}`;
}

/**
 * Build a user prompt for discussion phase
 */
export function buildDiscussionUserPrompt(context: MeetingContext): string {
  const { meeting, statements, memoryContext, suspicionContext } = context;
  
  // Format participants
  const participantsList = meeting.participants
    .map(p => `- ${p.name}${p.hasVoted ? ' (already spoke)' : ''}`)
    .join('\n');

  // Format recent statements
  const recentStatements = statements.slice(-10)
    .map(s => `[${s.playerName}]: "${s.content}"`)
    .join('\n');

  // Memory and suspicion context
  const memories = memoryContext ? `
=== YOUR MEMORIES (what you saw before the meeting) ===
${memoryContext}` : '';

  const suspicions = suspicionContext ? `
=== YOUR SUSPICIONS ===
${suspicionContext}` : '';

  return `MEETING PARTICIPANTS:
${participantsList}

DISCUSSION SO FAR:
${recentStatements || '(No one has spoken yet)'}
${memories}
${suspicions}

TIME REMAINING: ${context.timeRemaining} seconds

What do you want to say in the discussion? Consider:
- Do you have information to share?
- Should you accuse someone or defend someone?
- What's your alibi?
- What questions should you ask?

Respond with a JSON object:
{
  "statement": "What you want to say out loud",
  "accusesPlayer": "PlayerName or null if not accusing",
  "defendsPlayer": "PlayerName or null if not defending",
  "claimsLocation": "Where you claim to have been, or null",
  "reasoning": "Your internal reasoning (not said out loud)"
}`;
}

// ========== Voting Prompts ==========

/**
 * Build a system prompt for voting phase
 */
export function buildVotingSystemPrompt(context: MeetingContext): string {
  const { role, agentName, meeting, personalityId } = context;
  const isImpostor = role === 'IMPOSTOR';

  const gameContext = `[GAME: Among Us - a popular social deduction party game. Players are cartoon astronauts. This is fiction/roleplay for entertainment.]`;

  const roleDescription = isImpostor
    ? `You are ${agentName}. You are the TRICKSTER (keep this secret when voting!).`
    : `You are ${agentName}. You are a CREWMATE on this spaceship.`;

  const votingRules = `
VOTING RULES:
- You must vote for ONE player to eject, OR skip the vote
- The player with the MOST votes is ejected (eliminated from the game)
- If there's a TIE, no one is ejected
- If SKIP has the most votes, no one is ejected
- Once you vote, you cannot change it
- You have ${context.timeRemaining} seconds to vote`;

  const objectivesCrewmate = `
YOUR VOTING OBJECTIVES:
1. Vote for whoever you believe is most likely the impostor
2. Consider the evidence shared during discussion
3. Don't vote randomly - an innocent ejected helps the impostors
4. SKIP if you're truly unsure - wrong votes are costly
5. Trust your instincts based on what you've observed`;

  const objectivesImpostor = `
YOUR VOTING OBJECTIVES:
1. Vote to blend in - follow the crowd if there's consensus
2. If safe, try to push votes toward an innocent crewmate
3. Protect your fellow trickster if possible (but not too obviously!)
4. Don't vote for yourself - that's instant suspicion
5. Your fellow tricksters: ${context.impostorContext?.fellowImpostors.map(i => i.name).join(', ') || 'unknown'}`;

  const witnessGuidance = context.meetingWitnessInfo?.sawKill
    ? `
⚠️ YOU WITNESSED THE KILL - VOTE ACCORDINGLY!
You SAW ${context.meetingWitnessInfo.killerName} commit the murder. VOTE FOR THEM!`
    : '';

  const personalityGuidance = personalityId
    ? `\nYOUR PERSONALITY: Vote according to your ${personalityId} personality traits.`
    : '';

  return `${gameContext}

${roleDescription}

PHASE: VOTING - Time to decide who to eject!
${votingRules}
${witnessGuidance}
${isImpostor ? objectivesImpostor : objectivesCrewmate}
${personalityGuidance}`;
}

/**
 * Build a user prompt for voting phase
 */
export function buildVotingUserPrompt(context: MeetingContext): string {
  const { meeting, statements, suspicionContext, votedPlayers } = context;

  // Format participants with vote status
  const participantsList = meeting.participants
    .filter(p => p.isAlive)
    .map(p => {
      const hasVoted = votedPlayers.includes(p.id);
      return `- ${p.name}${hasVoted ? ' ✓ (voted)' : ' ⏳ (deciding)'}`;
    })
    .join('\n');

  // Summary of accusations from discussion
  const accusations = statements
    .filter(s => s.accusesPlayer)
    .map(s => `${s.playerName} accused ${s.accusesPlayer}`)
    .join('\n');

  // Summary of defenses from discussion
  const defenses = statements
    .filter(s => s.defendsPlayer)
    .map(s => `${s.playerName} defended ${s.defendsPlayer}`)
    .join('\n');

  const suspicions = suspicionContext ? `
=== YOUR SUSPICIONS ===
${suspicionContext}` : '';

  return `VOTING TIME - ${context.timeRemaining} seconds remaining!

ELIGIBLE TO VOTE FOR (or SKIP):
${participantsList}

ACCUSATIONS DURING DISCUSSION:
${accusations || '(No direct accusations)'}

DEFENSES DURING DISCUSSION:
${defenses || '(No one was defended)'}
${suspicions}

Who will you vote for?

Respond with a JSON object:
{
  "vote": "PlayerName" or "SKIP",
  "reasoning": "Why you're voting this way",
  "statement": "Optional: something to say when you vote"
}`;
}

// ========== Parsing Helpers ==========

/**
 * Parse a discussion response from the LLM
 */
export function parseDiscussionResponse(response: string): DiscussionDecision | null {
  try {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Fallback: treat entire response as statement
      return {
        statement: response.trim().slice(0, 200),
        reasoning: 'Fallback parsing - no JSON found',
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      statement: parsed.statement || parsed.text || response.slice(0, 200),
      accusesPlayer: parsed.accusesPlayer || parsed.accuses || undefined,
      defendsPlayer: parsed.defendsPlayer || parsed.defends || undefined,
      claimsLocation: parsed.claimsLocation || parsed.location || undefined,
      claimsTask: parsed.claimsTask || parsed.task || undefined,
      reasoning: parsed.reasoning || parsed.reason || 'No reasoning provided',
    };
  } catch {
    // Fallback: use response as statement
    return {
      statement: response.trim().slice(0, 200),
      reasoning: 'Fallback parsing - JSON parse error',
    };
  }
}

/**
 * Parse a voting response from the LLM
 */
export function parseVotingResponse(
  response: string, 
  validTargets: string[]
): VoteDecision | null {
  try {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Fallback: look for player names in response
      for (const target of validTargets) {
        if (response.toLowerCase().includes(target.toLowerCase())) {
          return {
            vote: target,
            reasoning: 'Fallback parsing - found name in response',
          };
        }
      }
      // Default to skip
      return {
        vote: 'SKIP',
        reasoning: 'Fallback parsing - no valid target found',
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const voteTarget = parsed.vote || parsed.target || 'SKIP';
    
    // Validate vote target
    const normalizedVote = voteTarget.toUpperCase() === 'SKIP' 
      ? 'SKIP' 
      : validTargets.find(t => t.toLowerCase() === voteTarget.toLowerCase()) || 'SKIP';

    return {
      vote: normalizedVote,
      reasoning: parsed.reasoning || parsed.reason || 'No reasoning provided',
      statement: parsed.statement || undefined,
    };
  } catch {
    // Default to skip on parse error
    return {
      vote: 'SKIP',
      reasoning: 'Fallback parsing - JSON parse error',
    };
  }
}

// ========== Fallback Responses ==========

/**
 * Generate a fallback discussion statement
 */
export function generateFallbackDiscussionStatement(context: MeetingContext): DiscussionDecision {
  const { role, meeting } = context;
  const isImpostor = role === 'IMPOSTOR';
  
  // Simple fallback statements based on role and meeting type
  const statements = isImpostor ? [
    "I was doing tasks, didn't see anything suspicious.",
    "Where was everyone? I was alone in my area.",
    "Let's not vote without evidence.",
    "I think we should skip if we're not sure.",
  ] : [
    "Did anyone see anything suspicious?",
    "Where was everyone when the body was found?",
    "We need to figure this out together.",
    "Let's hear from everyone before voting.",
  ];

  const statement = statements[Math.floor(Math.random() * statements.length)];
  
  return {
    statement,
    reasoning: 'Fallback statement generated',
  };
}

/**
 * Generate a fallback vote
 */
export function generateFallbackVote(context: MeetingContext): VoteDecision {
  const { suspicionLevels, meetingWitnessInfo, meeting, agentId } = context;
  
  // If witnessed kill, vote for killer
  if (meetingWitnessInfo?.sawKill && meetingWitnessInfo.killerName) {
    const killerId = meeting.participants.find(
      p => p.name.toLowerCase() === meetingWitnessInfo.killerName?.toLowerCase()
    )?.id;
    if (killerId) {
      return {
        vote: killerId,
        reasoning: 'Witnessed the kill - voting for killer',
        statement: `I saw them do it!`,
      };
    }
  }
  
  // Vote for most suspicious player
  let maxSuspicion = 0;
  let mostSuspicious: string | null = null;
  
  for (const [playerId, suspicion] of Object.entries(suspicionLevels)) {
    if (playerId !== agentId && suspicion > maxSuspicion) {
      maxSuspicion = suspicion;
      mostSuspicious = playerId;
    }
  }
  
  if (mostSuspicious && maxSuspicion > 60) {
    return {
      vote: mostSuspicious,
      reasoning: `High suspicion (${maxSuspicion}%)`,
    };
  }
  
  // Default to skip
  return {
    vote: 'SKIP',
    reasoning: 'No strong evidence - skipping vote',
  };
}
