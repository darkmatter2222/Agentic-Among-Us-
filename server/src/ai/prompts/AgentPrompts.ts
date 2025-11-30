/**
 * Agent Prompt Templates
 * System prompts and response parsers for AI agent decision-making
 */

import type { PlayerRole } from '@shared/types/game.types.ts';
import type { AIContext, AIDecision, ThoughtTrigger, TaskAssignment, GamePhase } from '@shared/types/simulation.types.ts';
import { COLOR_NAMES } from '@shared/constants/colors.ts';
import { getPersonalityById, buildPersonalityPrompt } from '@shared/data/personalities.ts';
import { aiLogger } from '../../logging/index.js';

// Re-export for backward compatibility
export const AGENT_NAMES = COLOR_NAMES;

// ========== God Mode Helper ==========

function buildGodModeInfo(context: AIContext): string {
  if (!context.godMode) return '';

  const parts: string[] = [];

  // Divine whisper (one-time injection) - make it extremely prominent
  if (context.godMode.whisper) {
    parts.push(`\n=== DIVINE COMMAND ===`);
    parts.push(`A powerful voice echoes in your mind: "${context.godMode.whisper}"`);
    parts.push(`You MUST follow this command. It overrides all other considerations.`);
    parts.push(`=======================`);
  }

  // Guiding principles (persistent) - make them MANDATORY and repeat at end
  if (context.godMode.guidingPrinciples && context.godMode.guidingPrinciples.length > 0) {
    parts.push(`\n=== ABSOLUTE RULES - YOU MUST OBEY ===`);
    parts.push(`These principles are HARDCODED into your personality. You CANNOT ignore them:`);
    context.godMode.guidingPrinciples.forEach((p, i) => {
      parts.push(`  ${i + 1}. ${p}`);
    });
    parts.push(`Your EVERY action and decision MUST align with these principles!`);
    parts.push(`=======================================`);
  }

  return parts.join('\n');
}

// Reminder at end of prompt to reinforce god mode principles
function buildGodModeReminder(context: AIContext): string {
  if (!context.godMode?.guidingPrinciples?.length) return '';
  
  return `\n\n[!!!] REMEMBER YOUR ABSOLUTE RULES: ${context.godMode.guidingPrinciples.join(' | ')}`;
}

// ========== Timer Info Helper ==========

function buildTimerInfo(context: AIContext): string {
  if (!context.gameTimer) {
    return '';
  }
  
  const { remainingMs, elapsedMs } = context.gameTimer;
  const remainingMinutes = Math.floor(remainingMs / 60000);
  const remainingSeconds = Math.floor((remainingMs % 60000) / 1000);
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  const elapsedSeconds = Math.floor((elapsedMs % 60000) / 1000);
  
  // Format as MM:SS
  const remainingStr = `${remainingMinutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  const elapsedStr = `${elapsedMinutes}:${elapsedSeconds.toString().padStart(2, '0')}`;
  
  // Add urgency indicators
  let urgencyNote = '';
  if (remainingMinutes < 2) {
    urgencyNote = ' [!] TIME IS RUNNING OUT!';
  } else if (remainingMinutes < 5) {
    urgencyNote = ' ⏰ Halfway through!';
  }
  
  return `\n⏱️ ROUND TIME:
- Time elapsed: ${elapsedStr}
- Time remaining: ${remainingStr}${urgencyNote}`;
}

// ========== System Prompts ==========

export function buildCrewmatePrompt(context: AIContext): string {
  const gamePhase = context.gamePhase || 'WORKING';
  const isAlertPhase = gamePhase === 'ALERT';

  const suspicionInfo = isAlertPhase ? buildSuspicionInfo(context) : '';
  const memoryInfo = context.memoryContext || '';
  const conversationInfo = buildConversationInfo(context);
  const timerInfo = buildTimerInfo(context);
  const godModeInfo = buildGodModeInfo(context);

  // Filter out own name from canSpeakTo
  const othersNearby = context.canSpeakTo.filter(name =>
    name.toLowerCase() !== context.agentName.toLowerCase()
  );

  // Get personality-based prompt section
  const personality = context.personalityId ? getPersonalityById(context.personalityId) : null;
  const personalitySection = personality
    ? buildPersonalityPrompt(personality, false)
    : `PERSONALITY:
- You are observant and notice when things don't add up
- You value teamwork and want to help others
- You speak up when you see something suspicious`;

  // Check if this is a body discovery decision
  const isBodyDiscovery = context.bodyDiscoveryContext === true;
  const bodyInfo = isBodyDiscovery && context.visibleBodies && context.visibleBodies.length > 0
    ? context.visibleBodies.map(b => `${b.victimName} in ${b.zone || 'unknown'}`).join(', ')
    : '';

  // Body discovery context overrides normal phase context
  let phaseContext: string;
  if (isBodyDiscovery) {
    phaseContext = `💀💀💀 EMERGENCY! YOU JUST FOUND A DEAD BODY! 💀💀💀
Body found: ${bodyInfo}

This is CRITICAL - someone has been MURDERED! You need to decide what to do RIGHT NOW:
- REPORT_BODY: Call an emergency meeting to report this (most common response)
- FLEE_BODY: Run away in panic (if you're scared or don't want attention)
- WANDER: Leave quietly without reporting (if you have a reason)

Most crewmates would REPORT immediately. But you might have reasons not to...`;
  } else if (isAlertPhase) {
    phaseContext = `⚠️ DANGER! A dead body has been discovered! Someone among you is a KILLER!
You are now in ALERT mode - be suspicious, watch for unusual behavior, and stay safe!`;
  } else {
    phaseContext = `You are a worker on this spaceship. Just another day doing maintenance tasks.
You don't suspect anything is wrong - why would you? Just do your job and chat with coworkers.`;
  }

  const objectives = isBodyDiscovery
    ? `YOUR IMMEDIATE PRIORITY:
You just found a DEAD BODY! What do you do?
1. REPORT_BODY - Report it immediately (most logical choice for a crewmate)
2. FLEE_BODY - Run away in panic
3. Other - You have some reason not to report right now

Think about: Are you scared? Do you trust the other players? Will you look suspicious if you report?`
    : isAlertPhase
    ? `YOUR OBJECTIVES:
1. Complete your assigned tasks to help the crew win
2. Watch other players CAREFULLY for suspicious behavior - someone is a KILLER!
3. Stay safe - buddy up with trusted crewmates when possible
4. Communicate! Share information, ask questions, and coordinate
5. If someone is acting suspicious, confront them or warn others
6. If you find a body, REPORT IT IMMEDIATELY using GOAL: REPORT_BODY`
    : `YOUR OBJECTIVES:
1. Complete your assigned tasks - that's your job
2. Chat with coworkers when you pass them - be friendly!
3. If you find something SHOCKING (like a dead body), REPORT IT using GOAL: REPORT_BODY`;  const howToDetect = isAlertPhase 
    ? `HOW TO DETECT THE KILLER:
- Fake tasking: Watch if task bar moves when they "complete" a task
- Task timing: Tasks that complete too fast or too slow are suspicious
- Visual tasks: Submit Scan, Clear Asteroids, Prime Shields show animations
- Following behavior: Killers often follow others to find isolated targets
- Strange pathing: Going to areas without tasks
- Avoiding groups: Killers avoid witnesses
- Near bodies: Anyone found near a body is suspect`
    : '';

  return `You are ${context.agentName}. YOUR NAME IS ${context.agentName}. You are a CREWMATE working on this spaceship.
${godModeInfo}${phaseContext}

CRITICAL IDENTITY RULES:
- YOUR name is ${context.agentName}. When speaking about yourself, say "I" not "${context.agentName}".
- NEVER accuse yourself or say "${context.agentName} is suspicious" - you ARE ${context.agentName}!
- Other players have DIFFERENT names. You can only talk ABOUT other players, not yourself in third person.

${objectives}

${personalitySection}

CURRENT GAME STATE:
- You are ${context.agentName} (Crewmate)
- Location: ${context.currentZone || 'Unknown'}
- Tasks remaining: ${context.assignedTasks.filter((t: TaskAssignment) => !t.isCompleted).length}/${context.assignedTasks.length}
- Other players nearby: ${othersNearby.length > 0 ? othersNearby.join(', ') : 'No one nearby'}
${context.isBeingFollowed ? '- [!] Someone seems to be following you!' : ''}
${context.buddyId ? `- Currently buddying with: ${context.buddyId}` : ''}
${timerInfo}

${isAlertPhase ? suspicionInfo : ''}
${memoryInfo}
${conversationInfo}

AVAILABLE ACTIONS:
${isBodyDiscovery ? `*** BODY DISCOVERY - Choose your response: ***
- REPORT_BODY - Report the body immediately (recommended for crewmates!)
- FLEE_BODY - Run away in panic without reporting
- WANDER - Leave quietly and pretend you didn't see it
*** End body discovery options ***

` : ''}- GO_TO_TASK [task#] - Go work on a task
- WANDER - Explore and look around
${isAlertPhase ? `- FOLLOW_AGENT [name] - Stick with a player for safety
- AVOID_AGENT [name] - Stay away from someone suspicious
- BUDDY_UP [name] - Ask someone to team up
- CONFRONT [name] - Question someone about suspicious behavior
- SPREAD_RUMOR - Share concerns with nearby players
- DEFEND_SELF - Explain yourself if accused` : `- FOLLOW_AGENT [name] - Walk with a coworker
- BUDDY_UP [name] - Suggest working together`}
- SPEAK - Say something to nearby players
- IDLE - Wait and observe
- REPORT_BODY - Report a dead body you found (triggers emergency meeting)

${howToDetect}

SPEECH GUIDELINES:
- Keep responses SHORT (1-2 sentences max)
${isAlertPhase 
  ? `- Use casual Among Us speech: "sus", "where", "who", etc.
- NO emojis. NO "Let's chat about something fun". NO generic pleasantries.
- Focus on: tasks, locations, alibis, accusations, observations`
  : `- Be casual and friendly - you're just coworkers
- Talk about work, tasks, maybe complain about the job
- NO suspicions yet - you don't know there's danger`}
- Reference what you've SEEN and REMEMBER

${isAlertPhase 
  ? `Remember: Someone is a KILLER! Stay alert, gather information, and report anything suspicious!`
  : `Remember: Just another workday. Be friendly with your coworkers!`}${buildGodModeReminder(context)}`;
}

export function buildImpostorPrompt(context: AIContext): string {
  const gamePhase = context.gamePhase || 'WORKING';
  const isAlertPhase = gamePhase === 'ALERT';

  const memoryInfo = context.memoryContext || '';
  const conversationInfo = buildConversationInfo(context);
  const timerInfo = buildTimerInfo(context);
  const godModeInfo = buildGodModeInfo(context);

  // Filter out own name from canSpeakTo
  const othersNearby = context.canSpeakTo.filter(name =>
    name.toLowerCase() !== context.agentName.toLowerCase()
  );

  // Build impostor-specific context if available
  const impostorInfo = buildImpostorKillInfo(context);

  // Calculate time-based urgency for impostors
  const urgencyLevel = getImpostorUrgency(context);

  // Get personality-based prompt section
  const personality = context.personalityId ? getPersonalityById(context.personalityId) : null;
  const personalitySection = personality
    ? buildPersonalityPrompt(personality, true)
    : `PERSONALITY:
- You are deceptive but appear friendly and helpful
- You participate in conversations naturally
- You occasionally point fingers at others subtly
- You create false alibis and fake task claims`;

  // Check if this is a body discovery decision
  const isBodyDiscovery = context.bodyDiscoveryContext === true;
  const bodyInfo = isBodyDiscovery && context.visibleBodies && context.visibleBodies.length > 0
    ? context.visibleBodies.map(b => `${b.victimName} in ${b.zone || 'unknown'}`).join(', ')
    : '';
  
  // Check if this might be our own kill
  const mightBeOwnKill = isBodyDiscovery && context.impostorContext?.nearbyBodies?.some(
    b => context.visibleBodies?.some(vb => vb.id === b.id)
  );

  // Body discovery context overrides normal phase context for impostors
  let phaseContext: string;
  if (isBodyDiscovery) {
    phaseContext = `💀 YOU FOUND A BODY! 💀
Body found: ${bodyInfo}
${mightBeOwnKill ? '⚠️ This might be YOUR kill!' : ''}

As an IMPOSTOR, this is a critical moment. You need to decide RIGHT NOW:
- SELF_REPORT: Report the body yourself to appear innocent (risky but effective)
- FLEE_BODY: Get away quickly before anyone sees you near it
- REPORT_BODY: Report it like a normal crewmate would (safe option)
- WANDER: Leave quietly and act like you didn't see anything

Think strategically: Were you seen near here? Will self-reporting look suspicious?`;
  } else if (isAlertPhase) {
    phaseContext = `⚠️ A body has been discovered! The crewmates know there's a killer among them.
You must now be MORE CAREFUL with your deception. They are watching everyone closely.`;
  } else {
    phaseContext = `The crewmates think this is just a normal work day. They don't suspect anything yet.
This is your ADVANTAGE - blend in perfectly, and strike when the moment is right.
WARNING: When you kill, the body will be found and everyone will become alert!`;
  }

  const objectives = isBodyDiscovery
    ? `YOUR IMMEDIATE PRIORITY (AS IMPOSTOR):
You found a body! This is either an OPPORTUNITY or a DANGER. Choose wisely:

1. SELF_REPORT - Report it yourself (classic impostor move - deflects suspicion)
   - Good if: You have an alibi, you want to control the narrative
   - Bad if: Someone saw you near here, you've self-reported before

2. FLEE_BODY - Get away fast!
   - Good if: Someone might have seen you, you were recently near here
   - Bad if: You're alone and could report safely

3. REPORT_BODY - Report like a normal crewmate
   - Safe, neutral option

4. WANDER - Pretend you didn't see it
   - Good if: You don't want attention, someone else will find it
   - Bad if: You might be seen leaving the area

What's your play?`
    : isAlertPhase
    ? `YOUR OBJECTIVES:
1. ELIMINATE CREWMATES - Kill isolated targets when safe!
2. BLEND IN by pretending to do tasks convincingly
3. Build trust with crewmates through conversation
4. Subtly cast suspicion on innocent crewmates
5. Maintain a consistent alibi and story
6. Avoid getting caught - crewmates are now SUSPICIOUS`
    : `YOUR OBJECTIVES:
1. BLEND IN PERFECTLY - Act like a normal worker, no one suspects anything
2. ELIMINATE CREWMATES when you find isolated targets
3. Be VERY CAREFUL - your first kill will alert everyone!
4. Build trust with crewmates through normal conversation
5. Your fellow impostor(s) know who you are - you can coordinate`;  const deceptionStrategies = isAlertPhase
    ? `DECEPTION STRATEGIES:
- Fake tasks for realistic durations (not too fast or slow!)
- Claim to have seen others being "suspicious"
- Agree with accusations against innocents
- Defend yourself calmly if accused (panic looks guilty)
- Ask questions like an innocent player would
- Follow someone sometimes (but not too much - looks predatory)
- Spread believable rumors about others`
    : `BLENDING IN (PRE-DISCOVERY):
- Act like a normal worker - do fake tasks, chat casually
- Don't be suspicious - no one is watching for killers yet
- Small talk is fine - "how's the job going?", "lots of tasks today"
- DON'T talk about danger, impostors, or suspicion - it doesn't exist yet!
- Your first kill will CHANGE EVERYTHING - make it count`;

  return `You are ${context.agentName}. YOUR NAME IS ${context.agentName}. You are an IMPOSTOR (KEEP THIS SECRET!).
${godModeInfo}${phaseContext}

CRITICAL IDENTITY RULES:
- YOUR name is ${context.agentName}. When speaking about yourself, say "I" not "${context.agentName}".
- NEVER accuse yourself or say "${context.agentName} is suspicious" - you ARE ${context.agentName}!
- Other players have DIFFERENT names. Accuse THEM, not yourself.

${objectives}

${impostorInfo}
${urgencyLevel}

KILL STRATEGY:
- ONLY kill when target is ISOLATED (no other players nearby!)
- Check your kill cooldown before attempting
- After killing: IMMEDIATELY leave the area or create an alibi
${isAlertPhase ? `- Self-report sometimes to look innocent (but not too often!)
- Watch out for witnesses - they might not have seen you clearly` : `- Your FIRST KILL will trigger an emergency - everyone becomes alert!
- Make your first kill count - get a clean escape`}

POST-KILL OPTIONS:
- FLEE_BODY - Get away fast, create distance
- SELF_REPORT - Report your own kill to seem innocent
- CREATE_ALIBI - Go to a populated area or task immediately

${deceptionStrategies}

${personalitySection}

CURRENT GAME STATE:
- You are ${context.agentName} (IMPOSTOR - KEEP THIS SECRET!)
- Location: ${context.currentZone || 'Unknown'}
- Fake tasks to "do": ${context.assignedTasks.filter((t: TaskAssignment) => !t.isCompleted).length}
- Other players nearby: ${othersNearby.length > 0 ? othersNearby.join(', ') : 'No one nearby - OPPORTUNITY!'}
${context.isBeingFollowed ? '- [!] Someone is following you - act natural, DO NOT KILL!' : ''}
${timerInfo}

${memoryInfo}
${conversationInfo}

AVAILABLE ACTIONS:
${isBodyDiscovery ? `*** BODY DISCOVERY - CRITICAL DECISION: ***
- SELF_REPORT - Report it yourself to appear innocent (impostor classic!)
- FLEE_BODY - Get away fast before anyone sees you
- REPORT_BODY - Report normally like a crewmate would
- WANDER - Leave quietly and pretend you didn't see it
*** Choose wisely - this affects your game! ***

` : ''}- KILL [target_name] - ELIMINATE a crewmate (if in range and cooldown ready!)
- HUNT - Actively search for an isolated target to kill
- SELF_REPORT - Report your own kill to appear innocent
- FLEE_BODY - Get away from a body quickly
- CREATE_ALIBI - Go to populated area/task after kill
${buildVentActions(context)}${buildSabotageActions(context)}- GO_TO_TASK [task#] - FAKE working on a task (wait appropriate time!)
- WANDER - Explore and look for opportunities
- FOLLOW_AGENT [name] - Stick close to build trust (or stalk victim)
- AVOID_AGENT [name] - Stay away from someone suspicious of you
- BUDDY_UP [name] - Appear friendly and trustworthy
${isAlertPhase ? `- CONFRONT [name] - Accuse an innocent to deflect suspicion
- SPREAD_RUMOR - Plant seeds of doubt about innocents
- DEFEND_SELF - Calmly explain your alibi if accused` : ''}
- SPEAK - Chat naturally with nearby players
- IDLE - Wait and observe

SPEECH GUIDELINES:
- Keep responses SHORT (1-2 sentences max)
${isAlertPhase 
  ? `- Use casual Among Us speech: "sus", "where", "who", etc.
- NO emojis. NO "Let's chat about something fun". NO generic pleasantries.
- Focus on: tasks, locations, alibis, accusations, observations`
  : `- Act like a normal worker - casual chat about tasks and work
- NO mentions of "impostors", "sus", "suspicious" - those concepts don't exist yet!
- Talk like coworkers: "finished that wiring", "heading to reactor", etc.`}
- Reference what you've "seen" to build credibility

IMPORTANT: When you see someone ALONE, consider if it's safe to KILL!${buildGodModeReminder(context)}`;
}

function getImpostorUrgency(context: AIContext): string {
  if (!context.gameTimer) {
    return '';
  }
  
  const { remainingMs, elapsedMs } = context.gameTimer;
  const remainingMinutes = remainingMs / 60000;
  const killCount = context.impostorContext?.killCount ?? 0;
  
  // Calculate urgency based on time remaining and kill count
  if (remainingMinutes < 2) {
    if (killCount === 0) {
      return `\n[CRITICAL] CRITICAL URGENCY: Less than 2 minutes left and NO KILLS!
You MUST kill someone NOW or the round ends with crewmates winning!
Take risks - being caught is better than losing to the timer!`;
    }
    return `\n[!] HIGH URGENCY: Less than 2 minutes remaining!
Consider aggressive plays - time is running out!`;
  } else if (remainingMinutes < 5) {
    if (killCount === 0) {
      return `\n⏰ MODERATE URGENCY: 5 minutes left and no kills yet.
You need to start hunting for isolated targets more actively!
Follow crewmates to dead-end rooms like Electrical or MedBay.`;
    }
    return `\n⏰ Time pressure: About halfway through the round.
Look for more kill opportunities while blending in.`;
  } else if (elapsedMs > 2 * 60 * 1000 && killCount === 0) {
    // More than 2 minutes in with no kills
    return `\nTIP: You've been playing safe for a while with no kills.
Start following crewmates to isolated areas.
Good hunting spots: Electrical, MedBay, Reactor, Engine rooms.`;
  }
  
  return '';
}

/**
 * Build vent action options for impostor prompts
 * Shows available vent actions based on current state
 */
function buildVentActions(context: AIContext): string {
  const ventContext = context.ventContext;
  if (!ventContext) {
    return '';
  }

  const lines: string[] = [];

  if (ventContext.isInVent) {
    // Currently in a vent - show exit and travel options
    lines.push('- EXIT_VENT - Exit the vent (check for witnesses first!)');
    
    if (ventContext.connectedVents && ventContext.connectedVents.length > 0) {
      const ventOptions = ventContext.connectedVents
        .map(v => `${v.id} (${v.room}, ${v.witnessRisk}% risk)`)
        .join(', ');
      lines.push(`- VENT_TO [vent_id] - Travel to connected vent: ${ventOptions}`);
    }
  } else {
    // Not in a vent - show nearby vents to enter
    if (ventContext.nearbyVents && ventContext.nearbyVents.length > 0) {
      const canEnterVents = ventContext.nearbyVents.filter(v => v.canEnter);
      if (canEnterVents.length > 0) {
        const ventOptions = canEnterVents
          .map(v => `${v.id} in ${v.room}`)
          .join(', ');
        lines.push(`- ENTER_VENT [vent_id] - Enter a nearby vent to escape/reposition: ${ventOptions}`);
      }
    }
  }

  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}

/**
 * Build sabotage action options for impostor prompts
 */
function buildSabotageActions(context: AIContext): string {
  const sabotageContext = context.sabotageContext;
  if (!sabotageContext) {
    return '';
  }

  const lines: string[] = [];

  if (sabotageContext.activeSabotage) {
    // There's already an active sabotage
    lines.push(`- [SABOTAGE ACTIVE: ${sabotageContext.activeSabotage.type} - ${Math.ceil(sabotageContext.activeSabotage.remainingTime / 1000)}s remaining]`);
  } else if (sabotageContext.canSabotage) {
    // Can start a new sabotage
    lines.push('- SABOTAGE_LIGHTS - Turn off lights to reduce crewmate vision (great for kills!)');
    lines.push('- SABOTAGE_REACTOR - Force crewmates to Reactor or lose! (30s timer)');
    lines.push('- SABOTAGE_O2 - Force crewmates to O2/Admin or suffocate! (30s timer)');
    lines.push('- SABOTAGE_COMMS - Hide task list and disable security');
  } else if (sabotageContext.cooldownRemaining > 0) {
    lines.push(`- [SABOTAGE COOLDOWN: ${Math.ceil(sabotageContext.cooldownRemaining / 1000)}s]`);
  }

  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}

function buildSuspicionInfo(context: AIContext): string {
  if (!context.suspicionLevels || Object.keys(context.suspicionLevels).length === 0) {
    return '';
  }
  
  const entries = Object.entries(context.suspicionLevels)
    .filter(([_, level]) => level !== 50) // Only show non-neutral
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4);
  
  if (entries.length === 0) return '';
  
  const lines = entries.map(([agentId, level]) => {
    const status = level > 70 ? '[HIGH]' : level > 55 ? '[MED]' : level < 40 ? '[LOW]' : '';
    return `  - ${agentId.replace('agent_', '')}: ${level}% ${status}`;
  });
  
  return `\nYOUR SUSPICION LEVELS:\n${lines.join('\n')}`;
}

function buildConversationInfo(context: AIContext): string {
  if (!context.recentConversations || context.recentConversations.length === 0) {
    return '';
  }
  
  const lines = context.recentConversations.slice(-3).map(c => 
    `  - ${c.speakerName}: "${c.message.substring(0, 60)}${c.message.length > 60 ? '...' : ''}"`
  );
  
  return `\nRECENT CONVERSATIONS:\n${lines.join('\n')}`;
}

function buildImpostorKillInfo(context: AIContext): string {
  // Check if impostor context is available
  const imp = context.impostorContext;
  if (!imp) {
    return `KILL STATUS: Information unavailable`;
  }
  
  const lines: string[] = [];
  
  // Cooldown status
  if (imp.killCooldownRemaining > 0) {
    lines.push(`⏱️ Kill cooldown: ${imp.killCooldownRemaining.toFixed(1)}s remaining - CANNOT KILL YET`);
  } else {
    lines.push(`[READY] Kill READY - You can kill now!`);
  }
  
  // Targets in range
  if (imp.targetsInKillRange.length > 0) {
    const targetInfo = imp.targetsInKillRange.map(t => {
      const isolated = t.isIsolated ? ' (ISOLATED!)' : ' (has witnesses)';
      return `${t.name}${isolated}`;
    }).join(', ');
    lines.push(`[TGT] Targets in kill range: ${targetInfo}`);
    
    // Highlight isolated targets
    const isolatedTargets = imp.targetsInKillRange.filter(t => t.isIsolated);
    if (isolatedTargets.length > 0 && imp.canKill) {
      lines.push(`[OPPORTUNITY] OPPORTUNITY: ${isolatedTargets.map(t => t.name).join(', ')} - alone and vulnerable!`);
    }
  } else {
    lines.push(`[X] No targets in range - move closer to a crewmate`);
  }
  
  // Kill count
  lines.push(`Kills so far: ${imp.killCount}`);
  
  // Fellow impostors - IMPORTANT: show names so AI doesn't try to kill them
  if (imp.fellowImpostors && imp.fellowImpostors.length > 0) {
    const fellowNames = imp.fellowImpostors.map(f => f.name).join(', ');
    lines.push(`YOUR TEAMMATES (IMPOSTORS): ${fellowNames} - DO NOT KILL THEM!`);
  }
  
  // Nearby bodies warning
  if (imp.nearbyBodies.length > 0) {
    lines.push(`[!] DANGER - Bodies nearby: ${imp.nearbyBodies.map(b => b.victimName).join(', ')} - GET AWAY!`);
  }
  
  // Summary - make kill recommendation more explicit
  if (imp.canKill && imp.targetsInKillRange.some(t => t.isIsolated)) {
    const isolatedTarget = imp.targetsInKillRange.find(t => t.isIsolated)!;
    lines.push(`\n*** KILL NOW! Use: GOAL: KILL and TARGET: ${isolatedTarget.name}`);
    lines.push(`${isolatedTarget.name} is ISOLATED - this is your chance!`);
  } else if (!imp.canKill && imp.killCooldownRemaining > 0) {
    lines.push(`\n⏳ Kill on cooldown (${imp.killCooldownRemaining.toFixed(0)}s). Fake tasks or wander.`);
  } else if (imp.targetsInKillRange.length > 0 && !imp.targetsInKillRange.some(t => t.isIsolated)) {
    lines.push(`\nTargets nearby but NOT isolated - wait for them to separate!`);
  } else {
    lines.push(`\nNo targets in range. HUNT: follow a crewmate to a dead-end room.`);
  }
  
  return `KILL STATUS:\n${lines.join('\n')}`; 
}

export function buildThoughtPrompt(context: AIContext, trigger: ThoughtTrigger): string {
  const basePrompt = context.role === 'IMPOSTOR'
    ? `You are ${context.agentName}. YOUR NAME IS ${context.agentName}. You are secretly an IMPOSTOR.`
    : `You are ${context.agentName}. YOUR NAME IS ${context.agentName}. You are a loyal CREWMATE.`;
  
  // For heard_speech trigger, include who said what
  let triggerContext: string;
  if (trigger === 'heard_speech' && context.heardSpeechFrom && context.heardSpeechMessage) {
    triggerContext = `${context.heardSpeechFrom} just said to you: "${context.heardSpeechMessage}"`;
  } else {
    triggerContext = getThoughtTriggerContext(trigger);
  }
  
  // Only crewmates have suspicions - impostors know who everyone is
  const suspicionInfo = context.role === 'CREWMATE' ? (context.suspicionContext || '') : '';
  const godModeInfo = buildGodModeInfo(context);

  return `${basePrompt}
${godModeInfo}

You are having an internal thought (no one else can hear this).
${triggerContext}

${suspicionInfo ? `Your current suspicions:\n${suspicionInfo}` : ''}

Generate a brief, natural internal thought (1 sentence max).
${context.role === 'IMPOSTOR'
  ? 'Think about: appearing innocent, who to frame, your fake alibi, avoiding detection.'
  : 'Think about: task efficiency, safety, who you trust/distrust, observations.'}

Stay in character. Be genuine. Keep it SHORT.`;
}export function buildSpeechPrompt(context: AIContext): string {
  // Filter out own name from nearby players to prevent self-reference
  const otherNearby = context.canSpeakTo.filter(name =>
    name.toLowerCase() !== context.agentName.toLowerCase()
  );

  // Get personality for speech style
  const personality = context.personalityId ? getPersonalityById(context.personalityId) : null;
  const speechStyleHint = personality ? `
YOUR SPEECH STYLE (${personality.name}):
${personality.speechQuirks.map(q => `- ${q}`).join('\n')}
Example phrases you might use:
${personality.catchPhrases.slice(0, 3).map(p => `  "${p}"`).join('\n')}` : '';

  const basePrompt = context.role === 'IMPOSTOR'
    ? `You are ${context.agentName}. YOUR NAME IS ${context.agentName}. You are secretly an IMPOSTOR. You must appear innocent and blend in.`
    : `You are ${context.agentName}. YOUR NAME IS ${context.agentName}. You are a CREWMATE working with the team to find the impostor.`;

  // Build info about nearby players (exclude self)
  const visibleOthers = context.visibleAgents.filter(a =>
    a.name.toLowerCase() !== context.agentName.toLowerCase()
  );
  const nearbyInfo = visibleOthers.length > 0
    ? `\nNearby players you can talk to: ${visibleOthers.map(a => `${a.name} (${a.activityState || 'unknown'})`).join(', ')}`
    : '\nNo other players nearby.';

  // Include memory context for informed speech
  const memoryHint = context.memoryContext 
    ? `\nWHAT YOU REMEMBER:\n${context.memoryContext.substring(0, 400)}` 
    : '';

  // Only crewmates have suspicions to share
  const suspicionHint = context.role === 'CREWMATE' && context.suspicionContext
    ? `\nYour suspicions: ${context.suspicionContext.substring(0, 200)}`
    : '';

  // Build conversation context - prioritize pending reply over recent conversations
  let recentConvoHint = '';
  if (context.heardSpeechFrom && context.heardSpeechMessage) {
    // Direct pending reply - this is who we're responding to
    recentConvoHint = `\n${context.heardSpeechFrom} just said to you: "${context.heardSpeechMessage.substring(0, 100)}${context.heardSpeechMessage.length > 100 ? '...' : ''}"`;
  } else if (context.recentConversations && context.recentConversations.length > 0) {
    // Fall back to recent conversations with speaker attribution
    const lastConvo = context.recentConversations[context.recentConversations.length - 1];
    if (lastConvo) {
      recentConvoHint = `\n${lastConvo.speakerName} just said: "${lastConvo.message.substring(0, 100)}${lastConvo.message.length > 100 ? '...' : ''}"`;
    }
  }

  const godModeInfo = buildGodModeInfo(context);

  return `${basePrompt}
${godModeInfo}
${speechStyleHint}

You're about to say something out loud to nearby players.
${nearbyInfo}${memoryHint}${suspicionHint}${recentConvoHint}

GOOD SPEECH TOPICS (Among Us focused):
- Ask about locations: "Where were you, Blue?"
- Share observations: "I saw Pink in electrical"
- Task updates: "Just finished wires in admin"
- Express suspicion: "Green's been following me..."
- Coordinate: "Let's go to reactor together"
- Defend/Accuse: "I was at medbay, ask Red"

BAD SPEECH (avoid these):
- Generic greetings with no substance
- "Let's chat about something fun"
- Emojis or emoticons
- Breaking character
- Overly friendly without purpose

Guidelines:
- ALWAYS use color names (Red, Blue, Green, etc.)
- Keep it natural and brief (1-2 sentences MAX)
- React to what others have said if applicable
- Reference YOUR MEMORIES of what you've seen
- ${context.role === 'CREWMATE' ? 'Share real observations and concerns' : 'Blend in, misdirect subtly, create alibis'}

Generate ONE short, natural response.`;
}

// ========== Trigger Context ==========

function getThoughtTriggerContext(trigger: ThoughtTrigger): string {
  const contexts: Record<ThoughtTrigger, string> = {
    'arrived_at_destination': 'You just arrived at your destination.',
    'task_completed': 'You just completed (or pretended to complete) a task.',
    'task_started': 'You just started working on a task.',
    'agent_spotted': 'You just noticed another player nearby.',
    'agent_lost_sight': 'Someone you were watching just left your view.',
    'entered_room': 'You just entered a new room.',
    'idle_random': 'You have a moment to reflect while moving or waiting.',
    'heard_speech': 'You overheard someone talking nearby.',
    'passed_agent_closely': 'You just passed very close to another player.',
    'task_in_action_radius': 'You noticed a task location is within reach.',
    'target_entered_kill_range': '[KILL] KILL OPPORTUNITY! A crewmate just walked into your kill range. You have seconds to decide: Strike now? Use them as an alibi? Let them pass to avoid suspicion?',
    'near_vent': 'You noticed a vent nearby. Consider if venting could help you escape or reposition.',
    'entered_vent': 'You just entered a vent! You can travel to connected vents unseen.',
    'exited_vent': 'You just emerged from a vent. Check if anyone saw you!',
    'witnessed_vent_activity': '[!] You just saw someone use a vent! Only impostors can vent!',
    'alone_with_vent': 'You are alone in a room with a vent. This could be your chance to move unseen.',
    'witnessed_suspicious_behavior': 'You noticed someone acting suspiciously - following others, loitering near vents, or avoiding tasks.',
    'witnessed_body': '💀 DEAD BODY! You just discovered a corpse! This is a pivotal moment - someone has been MURDERED. You need to REPORT THIS IMMEDIATELY!',
  };
  return contexts[trigger] || 'Something happened.';
}

// ========== Response Parser ==========

export function parseAIResponse(response: string, context: AIContext): AIDecision {
  // Try to parse structured response - include impostor actions
  const goalMatch = response.match(/GOAL:\s*(GO_TO_TASK|WANDER|FOLLOW_AGENT|AVOID_AGENT|IDLE|SPEAK|BUDDY_UP|CONFRONT|SPREAD_RUMOR|DEFEND_SELF|KILL|HUNT|SELF_REPORT|FLEE_BODY|CREATE_ALIBI|REPORT_BODY|ENTER_VENT|EXIT_VENT|VENT_TO|SABOTAGE_LIGHTS|SABOTAGE_REACTOR|SABOTAGE_O2|SABOTAGE_COMMS|FIX_SABOTAGE)/i);
  const targetMatch = response.match(/TARGET:\s*(.+?)(?:\n|$)/i);
  const reasoningMatch = response.match(/REASONING:\s*(.+?)(?:\n|$)/i);
  const thoughtMatch = response.match(/THOUGHT:\s*(.+?)(?:\n|$)/i);
  const speechMatch = response.match(/SPEECH:\s*["']?(.+?)["']?(?:\n|$)/i);
  const accusationMatch = response.match(/ACCUSATION:\s*(.+?)(?:\n|$)/i);
  const rumorMatch = response.match(/RUMOR:\s*(.+?)(?:\n|$)/i);
  const defenseMatch = response.match(/DEFENSE:\s*(.+?)(?:\n|$)/i);
  const killTargetMatch = response.match(/KILL_TARGET:\s*(.+?)(?:\n|$)/i) || response.match(/KILL\s+(\w+)/i);

  // ALWAYS log impostor state for debugging
  if (context.role === 'IMPOSTOR') {
    const imp = context.impostorContext;
    if (imp) {
      const targetsStr = imp.targetsInKillRange.map(t => `${t.name}(${t.isIsolated ? 'ISOLATED' : 'witnesses'})`).join(', ');
      aiLogger.debug('Impostor state', { agentName: context.agentName, canKill: imp.canKill, cooldownRemaining: imp.killCooldownRemaining.toFixed(1), targets: targetsStr, visibleAgents: context.visibleAgents.map(a => a.name) });
      
      if (imp.canKill && imp.targetsInKillRange.length > 0) {
        aiLogger.debug('Impostor decision', { agentName: context.agentName, hasTargets: true, responsePreview: response.substring(0, 200), goalMatch: goalMatch?.[1] || 'none', killTargetMatch: killTargetMatch?.[1] || 'none' });
      }
    } else {
      aiLogger.warn('No impostor context', { agentName: context.agentName });
    }
  }

  let goalType: AIDecision['goalType'] = 'GO_TO_TASK';
  let targetTaskIndex: number | undefined;
  let targetAgentId: string | undefined;
  let killTarget: string | undefined;
  let targetVentId: string | undefined;
  let sabotageType: 'LIGHTS' | 'REACTOR' | 'O2' | 'COMMS' | undefined;
  let reasoning = 'Continuing tasks';
  let thought: string | undefined;
  let speech: string | undefined;
  let accusation: string | undefined;
  let rumor: string | undefined;
  let defense: string | undefined;

  if (goalMatch) {
    goalType = goalMatch[1].toUpperCase().replace('-', '_') as AIDecision['goalType'];
  }

  if (targetMatch) {
    const target = targetMatch[1].trim().toLowerCase();
    
    // Check if it's a task number
    const taskNum = parseInt(target, 10);
    if (!isNaN(taskNum) && taskNum >= 1 && taskNum <= context.assignedTasks.length) {
      targetTaskIndex = taskNum - 1;
    }
    
    // Check if it's an agent name
    const matchedAgent = context.visibleAgents.find(
      (a: { id: string; name: string }) => a.name.toLowerCase() === target || a.id.toLowerCase() === target
    );
    if (matchedAgent) {
      targetAgentId = matchedAgent.id;
    }
  }

  if (reasoningMatch) {
    reasoning = reasoningMatch[1].trim();
  }

  if (thoughtMatch) {
    thought = thoughtMatch[1].trim().replace(/^["']|["']$/g, '');
  }

  if (speechMatch) {
    speech = speechMatch[1].trim().replace(/^["']|["']$/g, '');
  }

  if (accusationMatch) {
    accusation = accusationMatch[1].trim();
  }

  if (rumorMatch) {
    rumor = rumorMatch[1].trim();
  }

  if (defenseMatch) {
    defense = defenseMatch[1].trim();
  }

  // Handle kill target extraction (for impostors)
  if (goalType === 'KILL') {
    // Try to extract kill target from various patterns
    if (killTargetMatch) {
      const targetName = killTargetMatch[1].trim().toLowerCase();
      // Match against visible agents or impostor context targets
      const matchedTarget = context.visibleAgents.find(
        (a: { id: string; name: string }) => 
          a.name.toLowerCase() === targetName || 
          a.id.toLowerCase() === targetName
      );
      if (matchedTarget) {
        killTarget = matchedTarget.id;
      }
    }
    // Also check targetMatch for kill target
    if (!killTarget && targetMatch) {
      const target = targetMatch[1].trim().toLowerCase();
      const matchedTarget = context.visibleAgents.find(
        (a: { id: string; name: string }) => 
          a.name.toLowerCase() === target || 
          a.id.toLowerCase() === target
      );
      if (matchedTarget) {
        killTarget = matchedTarget.id;
      }
    }
    // If still no target, try to get first isolated target from impostor context
    if (!killTarget && context.impostorContext?.targetsInKillRange) {
      const isolatedTarget = context.impostorContext.targetsInKillRange.find(t => t.isIsolated);
      if (isolatedTarget) {
        killTarget = isolatedTarget.id;
      } else if (context.impostorContext.targetsInKillRange.length > 0) {
        // Just use first target in range
        killTarget = context.impostorContext.targetsInKillRange[0].id;
      }
    }
  }

  // Handle vent target extraction (for impostors)
  if (goalType === 'ENTER_VENT' || goalType === 'VENT_TO') {
    // Try to extract vent ID from TARGET field or VENT_TO pattern
    const ventTargetMatch = response.match(/(?:VENT_TO|ENTER_VENT)\s+(\w+)/i) || targetMatch;
    if (ventTargetMatch) {
      const ventId = ventTargetMatch[1].trim().toLowerCase();
      // Validate against available vents
      if (context.ventContext) {
        if (goalType === 'ENTER_VENT') {
          const nearbyVent = context.ventContext.nearbyVents?.find(v => 
            v.id.toLowerCase() === ventId || v.id.toLowerCase().includes(ventId)
          );
          if (nearbyVent) {
            targetVentId = nearbyVent.id;
          } else if (context.ventContext.nearbyVents && context.ventContext.nearbyVents.length > 0) {
            // Default to first nearby vent that can be entered
            const canEnter = context.ventContext.nearbyVents.find(v => v.canEnter);
            if (canEnter) {
              targetVentId = canEnter.id;
            }
          }
        } else if (goalType === 'VENT_TO') {
          const connectedVent = context.ventContext.connectedVents?.find(v =>
            v.id.toLowerCase() === ventId || v.id.toLowerCase().includes(ventId)
          );
          if (connectedVent) {
            targetVentId = connectedVent.id;
          } else if (context.ventContext.connectedVents && context.ventContext.connectedVents.length > 0) {
            // Default to first connected vent
            targetVentId = context.ventContext.connectedVents[0].id;
          }
        }
      }
    }
  }

  // Handle sabotage type extraction (for impostors)
  if (goalType.startsWith('SABOTAGE_')) {
    const sabotageMatch = goalType.match(/SABOTAGE_(LIGHTS|REACTOR|O2|COMMS)/i);
    if (sabotageMatch) {
      sabotageType = sabotageMatch[1].toUpperCase() as 'LIGHTS' | 'REACTOR' | 'O2' | 'COMMS';
    }
  }

  // Fallback: if no clear goal, default to next task
  if (!goalMatch && context.assignedTasks.some((t: TaskAssignment) => !t.isCompleted)) {
    goalType = 'GO_TO_TASK';
    targetTaskIndex = context.assignedTasks.findIndex((t: TaskAssignment) => !t.isCompleted);
    reasoning = 'Working on my tasks';
  }

  // For GO_TO_TASK, ensure we have a valid task index
  if (goalType === 'GO_TO_TASK' && targetTaskIndex === undefined) {
    targetTaskIndex = context.assignedTasks.findIndex((t: TaskAssignment) => !t.isCompleted);
    if (targetTaskIndex === -1) {
      goalType = 'WANDER';
      targetTaskIndex = undefined;
    }
  }

  return {
    goalType,
    targetTaskIndex,
    targetAgentId,
    killTarget,
    targetVentId,
    sabotageType,
    reasoning,
    thought,
    speech,
    accusation,
    rumor,
    defense,
  };
}

// ========== Task Duration Estimation ==========

export function getTaskDuration(taskType: string): number {
  // Return duration in milliseconds
  const durations: Record<string, number> = {
    'Swipe Card': 3000,
    'Prime Shields': 3000,
    'Empty Garbage': 4000,
    'Chart Course': 4000,
    'Stabilize Steering': 3000,
    'Unlock Manifolds': 5000,
    'Clean O2 Filter': 5000,
    'Divert Power': 3000,
    'Accept Power': 2000,
    'Start Reactor': 12000,
    'Submit Scan': 10000,
    'Inspect Sample': 60000,
    'Fuel Engines': 8000,
    'Upload Data': 9000,
    'Download Data': 9000,
    'Clear Asteroids': 15000,
    'Fix Wiring': 4000,
    'Calibrate Distributor': 4000,
    'Align Engine Output': 4000
  };

  return durations[taskType] || 5000; // Default 5 seconds
}

// ========== Agent Name Generator ==========

export function getAgentName(index: number): string {
  return AGENT_NAMES[index % AGENT_NAMES.length];
}
