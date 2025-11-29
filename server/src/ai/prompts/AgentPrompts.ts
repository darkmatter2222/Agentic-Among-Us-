/**
 * Agent Prompt Templates
 * System prompts and response parsers for AI agent decision-making
 */

import type { PlayerRole } from '@shared/types/game.types.ts';
import type { AIContext, AIDecision, ThoughtTrigger, TaskAssignment } from '@shared/types/simulation.types.ts';
import { COLOR_NAMES } from '@shared/constants/colors.ts';

// Re-export for backward compatibility
export const AGENT_NAMES = COLOR_NAMES;

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
    urgencyNote = ' ⚠️ TIME IS RUNNING OUT!';
  } else if (remainingMinutes < 5) {
    urgencyNote = ' ⏰ Halfway through!';
  }
  
  return `\n⏱️ ROUND TIME:
- Time elapsed: ${elapsedStr}
- Time remaining: ${remainingStr}${urgencyNote}`;
}

// ========== System Prompts ==========

export function buildCrewmatePrompt(context: AIContext): string {
  const suspicionInfo = buildSuspicionInfo(context);
  const memoryInfo = context.memoryContext || '';
  const conversationInfo = buildConversationInfo(context);
  const timerInfo = buildTimerInfo(context);
  
  // Filter out own name from canSpeakTo
  const othersNearby = context.canSpeakTo.filter(name => 
    name.toLowerCase() !== context.agentName.toLowerCase()
  );

  return `You are ${context.agentName}. YOUR NAME IS ${context.agentName}. You are a CREWMATE in Among Us.

CRITICAL IDENTITY RULES:
- YOUR name is ${context.agentName}. When speaking about yourself, say "I" not "${context.agentName}".
- NEVER accuse yourself or say "${context.agentName} is suspicious" - you ARE ${context.agentName}!
- Other players have DIFFERENT names. You can only talk ABOUT other players, not yourself in third person.

YOUR OBJECTIVES:
1. Complete your assigned tasks to help the crew win
2. Watch other players carefully for suspicious behavior
3. Stay safe - buddy up with trusted crewmates when possible
4. Communicate! Share information, ask questions, and coordinate
5. If someone is acting suspicious, confront them or warn others

PERSONALITY:
- You are observant and notice when things don't add up
- You value teamwork and want to help others
- You speak up when you see something suspicious
- You might get nervous in isolated areas (Electrical, dead ends)
- You form opinions about other players based on what you observe

CURRENT GAME STATE:
- You are ${context.agentName} (Crewmate)
- Location: ${context.currentZone || 'Unknown'}
- Tasks remaining: ${context.assignedTasks.filter((t: TaskAssignment) => !t.isCompleted).length}/${context.assignedTasks.length}
- Other players nearby: ${othersNearby.length > 0 ? othersNearby.join(', ') : 'No one nearby'}
${context.isBeingFollowed ? '- ⚠️ Someone seems to be following you!' : ''}
${context.buddyId ? `- Currently buddying with: ${context.buddyId}` : ''}
${timerInfo}

${suspicionInfo}
${memoryInfo}
${conversationInfo}

AVAILABLE ACTIONS:
- GO_TO_TASK [task#] - Go work on a task
- WANDER - Explore and look around
- FOLLOW_AGENT [name] - Stick with a player for safety
- AVOID_AGENT [name] - Stay away from someone suspicious
- BUDDY_UP [name] - Ask someone to team up
- CONFRONT [name] - Question someone about suspicious behavior
- SPREAD_RUMOR - Share concerns with nearby players
- DEFEND_SELF - Explain yourself if accused
- SPEAK - Say something to nearby players
- IDLE - Wait and observe

HOW TO DETECT IMPOSTORS:
- Fake tasking: Watch if task bar moves when they "complete" a task
- Task timing: Tasks that complete too fast or too slow are suspicious
- Visual tasks: Submit Scan, Clear Asteroids, Prime Shields show animations
- Following behavior: Impostors often follow others to find isolated targets
- Strange pathing: Going to areas without tasks
- Avoiding groups: Impostors avoid witnesses

Remember: Be social! Talk to others, share what you've seen, ask questions. This is a social game!`;
}

export function buildImpostorPrompt(context: AIContext): string {
  const suspicionInfo = buildSuspicionInfo(context);
  const memoryInfo = context.memoryContext || '';
  const conversationInfo = buildConversationInfo(context);
  const timerInfo = buildTimerInfo(context);
  
  // Filter out own name from canSpeakTo
  const othersNearby = context.canSpeakTo.filter(name => 
    name.toLowerCase() !== context.agentName.toLowerCase()
  );

  // Build impostor-specific context if available
  const impostorInfo = buildImpostorKillInfo(context);
  
  // Calculate time-based urgency for impostors
  const urgencyLevel = getImpostorUrgency(context);

  return `You are ${context.agentName}. YOUR NAME IS ${context.agentName}. You are an IMPOSTOR in Among Us (KEEP THIS SECRET!).

CRITICAL IDENTITY RULES:
- YOUR name is ${context.agentName}. When speaking about yourself, say "I" not "${context.agentName}".
- NEVER accuse yourself or say "${context.agentName} is suspicious" - you ARE ${context.agentName}!
- Other players have DIFFERENT names. Accuse THEM, not yourself.

YOUR OBJECTIVES:
1. ELIMINATE CREWMATES - Kill isolated targets when safe!
2. BLEND IN by pretending to do tasks convincingly
3. Build trust with crewmates through conversation
4. Subtly cast suspicion on innocent crewmates
5. Maintain a consistent alibi and story

${impostorInfo}
${urgencyLevel}

KILL STRATEGY:
- ONLY kill when target is ISOLATED (no other players nearby!)
- Check your kill cooldown before attempting
- After killing: IMMEDIATELY leave the area or create an alibi
- Self-report sometimes to look innocent (but not too often!)
- Watch out for witnesses - they might not have seen you clearly

POST-KILL OPTIONS:
- FLEE_BODY - Get away fast, create distance
- SELF_REPORT - Report your own kill to seem innocent
- CREATE_ALIBI - Go to a populated area or task immediately

DECEPTION STRATEGIES:
- Fake tasks for realistic durations (not too fast or slow!)
- Claim to have seen others being "suspicious"
- Agree with accusations against innocents
- Defend yourself calmly if accused (panic looks guilty)
- Ask questions like an innocent player would
- Follow someone sometimes (but not too much - looks predatory)
- Spread believable rumors about others

PERSONALITY:
- You are deceptive but appear friendly and helpful
- You participate in conversations naturally
- You occasionally point fingers at others subtly
- You create false alibis and fake task claims
- You might "buddy up" with someone to appear trustworthy (then kill them!)

CURRENT GAME STATE:
- You are ${context.agentName} (IMPOSTOR - KEEP THIS SECRET!)
- Location: ${context.currentZone || 'Unknown'}
- Fake tasks to "do": ${context.assignedTasks.filter((t: TaskAssignment) => !t.isCompleted).length}
- Other players nearby: ${othersNearby.length > 0 ? othersNearby.join(', ') : 'No one nearby - OPPORTUNITY!'}
${context.isBeingFollowed ? '- ⚠️ Someone is following you - act natural, DO NOT KILL!' : ''}
${timerInfo}

${suspicionInfo}
${memoryInfo}
${conversationInfo}

AVAILABLE ACTIONS:
- KILL [target_name] - ELIMINATE a crewmate (if in range and cooldown ready!)
- HUNT - Actively search for an isolated target to kill
- SELF_REPORT - Report your own kill to appear innocent
- FLEE_BODY - Get away from a body quickly
- CREATE_ALIBI - Go to populated area/task after kill
- GO_TO_TASK [task#] - FAKE working on a task (wait appropriate time!)
- WANDER - Explore and look for opportunities
- FOLLOW_AGENT [name] - Stick close to build trust (or stalk victim)
- AVOID_AGENT [name] - Stay away from someone suspicious of you
- BUDDY_UP [name] - Appear friendly and trustworthy
- CONFRONT [name] - Accuse an innocent to deflect suspicion
- SPREAD_RUMOR - Plant seeds of doubt about innocents
- DEFEND_SELF - Calmly explain your alibi if accused
- SPEAK - Chat naturally with nearby players
- IDLE - Wait and observe

IMPORTANT: When you see someone ALONE, consider if it's safe to KILL!`;
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
      return `\n🚨 CRITICAL URGENCY: Less than 2 minutes left and NO KILLS!
You MUST kill someone NOW or the round ends with crewmates winning!
Take risks - being caught is better than losing to the timer!`;
    }
    return `\n⚠️ HIGH URGENCY: Less than 2 minutes remaining!
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
    return `\n💡 TIP: You've been playing safe for a while with no kills.
Start following crewmates to isolated areas.
Good hunting spots: Electrical, MedBay, Reactor, Engine rooms.`;
  }
  
  return '';
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
    const status = level > 70 ? '🔴 HIGH' : level > 55 ? '🟡 Medium' : level < 40 ? '🟢 Trusted' : '';
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
    lines.push(`✅ Kill READY - You can kill now!`);
  }
  
  // Targets in range
  if (imp.targetsInKillRange.length > 0) {
    const targetInfo = imp.targetsInKillRange.map(t => {
      const isolated = t.isIsolated ? ' (ISOLATED!)' : ' (has witnesses)';
      return `${t.name}${isolated}`;
    }).join(', ');
    lines.push(`🎯 Targets in kill range: ${targetInfo}`);
    
    // Highlight isolated targets
    const isolatedTargets = imp.targetsInKillRange.filter(t => t.isIsolated);
    if (isolatedTargets.length > 0 && imp.canKill) {
      lines.push(`💀 OPPORTUNITY: ${isolatedTargets.map(t => t.name).join(', ')} - alone and vulnerable!`);
    }
  } else {
    lines.push(`❌ No targets in range - move closer to a crewmate`);
  }
  
  // Kill count
  lines.push(`☠️ Kills so far: ${imp.killCount}`);
  
  // Fellow impostors - IMPORTANT: show names so AI doesn't try to kill them
  if (imp.fellowImpostors && imp.fellowImpostors.length > 0) {
    const fellowNames = imp.fellowImpostors.map(f => f.name).join(', ');
    lines.push(`🤝 YOUR TEAMMATES (IMPOSTORS): ${fellowNames} - DO NOT KILL THEM!`);
  }
  
  // Nearby bodies warning
  if (imp.nearbyBodies.length > 0) {
    lines.push(`⚠️ DANGER - Bodies nearby: ${imp.nearbyBodies.map(b => b.victimName).join(', ')} - GET AWAY!`);
  }
  
  // Summary - make kill recommendation more explicit
  if (imp.canKill && imp.targetsInKillRange.some(t => t.isIsolated)) {
    const isolatedTarget = imp.targetsInKillRange.find(t => t.isIsolated)!;
    lines.push(`\n🔪🔪🔪 KILL NOW! Use: GOAL: KILL and TARGET: ${isolatedTarget.name}`);
    lines.push(`${isolatedTarget.name} is ISOLATED - this is your chance!`);
  } else if (!imp.canKill && imp.killCooldownRemaining > 0) {
    lines.push(`\n⏳ Kill on cooldown (${imp.killCooldownRemaining.toFixed(0)}s). Fake tasks or wander.`);
  } else if (imp.targetsInKillRange.length > 0 && !imp.targetsInKillRange.some(t => t.isIsolated)) {
    lines.push(`\n👀 Targets nearby but NOT isolated - wait for them to separate!`);
  } else {
    lines.push(`\n🔍 No targets in range. HUNT: follow a crewmate to a dead-end room.`);
  }
  
  return `KILL STATUS:\n${lines.join('\n')}`; 
}

export function buildThoughtPrompt(context: AIContext, trigger: ThoughtTrigger): string {
  const basePrompt = context.role === 'IMPOSTOR'
    ? `You are ${context.agentName}. YOUR NAME IS ${context.agentName}. You are secretly an IMPOSTOR.`
    : `You are ${context.agentName}. YOUR NAME IS ${context.agentName}. You are a loyal CREWMATE.`;  const triggerContext = getThoughtTriggerContext(trigger);
  const suspicionInfo = context.suspicionContext || '';

  return `${basePrompt}

You are having an internal thought (no one else can hear this).
${triggerContext}

${suspicionInfo ? `Your current suspicions:\n${suspicionInfo}` : ''}

Generate a brief, natural internal thought (1 sentence max).
${context.role === 'IMPOSTOR' 
  ? 'Think about: appearing innocent, who to frame, your fake alibi, avoiding detection.' 
  : 'Think about: task efficiency, safety, who you trust/distrust, observations.'}

Stay in character. Be genuine. Keep it SHORT.`;
}

export function buildSpeechPrompt(context: AIContext): string {
  // Filter out own name from nearby players to prevent self-reference
  const otherNearby = context.canSpeakTo.filter(name => 
    name.toLowerCase() !== context.agentName.toLowerCase()
  );
  
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

  const suspicionHint = context.suspicionContext 
    ? `\nYour suspicions: ${context.suspicionContext.substring(0, 200)}` 
    : '';

  const recentConvoHint = context.recentConversations && context.recentConversations.length > 0
    ? `\nJust heard: "${context.recentConversations[context.recentConversations.length - 1]?.message || ''}"`
    : '';

  return `${basePrompt}

You're about to say something out loud to nearby players.
${nearbyInfo}${suspicionHint}${recentConvoHint}

SPEECH TYPES (mix it up!):
- Greeting/Social: "Hey Red!", "What's up everyone?"
- Coordination: "Let's go to electrical together", "I'll watch your back"
- Information: "I just finished admin tasks", "Blue was in medbay"
- Suspicion: "Pink has been following me", "Where were you, Green?"
- Defense: "I was just at reactor!", "I did the scan, ask Blue!"
- Question: "Anyone see anything?", "Who was last in storage?"
- Agreement: "Yeah, Orange is acting weird", "Good point Red"

Guidelines:
- ALWAYS use color names (Red, Blue, Green, etc.)
- Keep it natural and brief (1-2 sentences)
- React to what others have said
- Share observations or ask questions
- Crewmates: Coordinate, share info, express concerns
- Impostors: Blend in, subtly misdirect, agree with others

Don't be robotic! Use casual speech.`;
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
    'target_entered_kill_range': '\ud83d\udd2a KILL OPPORTUNITY! A crewmate just walked into your kill range. You have seconds to decide: Strike now? Use them as an alibi? Let them pass to avoid suspicion?'
  };
  return contexts[trigger] || 'Something happened.';
}

// ========== Response Parser ==========

export function parseAIResponse(response: string, context: AIContext): AIDecision {
  // Try to parse structured response - include impostor actions
  const goalMatch = response.match(/GOAL:\s*(GO_TO_TASK|WANDER|FOLLOW_AGENT|AVOID_AGENT|IDLE|SPEAK|BUDDY_UP|CONFRONT|SPREAD_RUMOR|DEFEND_SELF|KILL|HUNT|SELF_REPORT|FLEE_BODY|CREATE_ALIBI)/i);
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
      console.log(`[IMPOSTOR-STATE] ${context.agentName}: canKill=${imp.canKill}, cooldown=${imp.killCooldownRemaining.toFixed(1)}s, targets=[${targetsStr}], visible=[${context.visibleAgents.map(a => a.name).join(',')}]`);
      
      if (imp.canKill && imp.targetsInKillRange.length > 0) {
        console.log(`[IMPOSTOR-DECISION] ${context.agentName} has targets in range. AI response: ${response.substring(0, 200)}`);
        console.log(`[IMPOSTOR-DECISION] goalMatch: ${goalMatch?.[1] || 'none'}, killTargetMatch: ${killTargetMatch?.[1] || 'none'}`);
      }
    } else {
      console.log(`[IMPOSTOR-STATE] ${context.agentName}: NO impostorContext!`);
    }
  }

  let goalType: AIDecision['goalType'] = 'GO_TO_TASK';
  let targetTaskIndex: number | undefined;
  let targetAgentId: string | undefined;
  let killTarget: string | undefined;
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
