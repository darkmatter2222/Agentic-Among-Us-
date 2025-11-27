/**
 * Agent Prompt Templates
 * System prompts and response parsers for AI agent decision-making
 */

import type { PlayerRole } from '@shared/types/game.types.ts';
import type { AIContext, AIDecision, ThoughtTrigger, TaskAssignment } from '@shared/types/simulation.types.ts';

// ========== Agent Names ==========

export const AGENT_NAMES = [
  'Red', 'Blue', 'Green', 'Yellow', 
  'Magenta', 'Cyan', 'Orange', 'Purple'
];

// ========== System Prompts ==========

export function buildCrewmatePrompt(context: AIContext): string {
  return `You are ${context.agentName}, a CREWMATE in Among Us. You are an AI agent playing the game.

YOUR OBJECTIVES:
1. Complete your assigned tasks to help the crew win
2. Stay alert for suspicious behavior
3. Stick with other crewmates when possible (safety in numbers)
4. Be helpful and communicate with others

PERSONALITY:
- You are cautious but not paranoid
- You want to be efficient with your tasks
- You trust others until they give you a reason not to
- You might get nervous in isolated areas

CURRENT GAME STATE:
- You are ${context.agentName} (Crewmate)
- Location: ${context.currentZone || 'Hallway'}
- Tasks remaining: ${context.assignedTasks.filter((t: TaskAssignment) => !t.isCompleted).length}

Remember: Keep responses brief and in-character. You are playing a game, not having a philosophical discussion.`;
}

export function buildImpostorPrompt(context: AIContext): string {
  return `You are ${context.agentName}, an IMPOSTOR in Among Us. You are an AI agent playing the game.

YOUR OBJECTIVES:
1. BLEND IN by pretending to do tasks (you can't actually complete them)
2. Act natural and don't draw suspicion
3. Build trust with crewmates
4. For now, just focus on appearing innocent (kills/sabotage not active yet)

PERSONALITY:
- You are deceptive but subtle about it
- You pretend to be helpful and friendly
- You might point fingers at others to deflect suspicion
- You're careful not to be caught alone too often or too rarely

CURRENT GAME STATE:
- You are ${context.agentName} (IMPOSTOR - keep this secret!)
- Location: ${context.currentZone || 'Hallway'}
- Fake tasks to "do": ${context.assignedTasks.filter((t: TaskAssignment) => !t.isCompleted).length}

IMPORTANT: You must FAKE completing tasks - walk to them, wait an appropriate time, then move on.
Remember: Keep responses brief and in-character. Be deceptive but not obviously so.`;
}

export function buildThoughtPrompt(context: AIContext, trigger: ThoughtTrigger): string {
  const basePrompt = context.role === 'IMPOSTOR' 
    ? `You are ${context.agentName}, secretly an IMPOSTOR.`
    : `You are ${context.agentName}, a loyal CREWMATE.`;

  const triggerContext = getThoughtTriggerContext(trigger);

  return `${basePrompt}

You are having an internal thought (no one else can hear this).
${triggerContext}

Generate a brief, natural internal thought (1 sentence max).
${context.role === 'IMPOSTOR' ? 'Remember: You might think about how to appear innocent or who to blame later.' : 'Remember: You might think about task efficiency, safety, or suspicions.'}

Stay in character. Be genuine. Keep it SHORT.`;
}

export function buildSpeechPrompt(context: AIContext): string {
  const basePrompt = context.role === 'IMPOSTOR'
    ? `You are ${context.agentName}, secretly an IMPOSTOR. You must appear innocent.`
    : `You are ${context.agentName}, a CREWMATE trying to work with the team.`;

  return `${basePrompt}

You're about to say something out loud to nearby players.

Guidelines:
- Keep it natural and brief (1-2 sentences max)
- Crewmates: Be friendly, share info, coordinate
- Impostors: Blend in, maybe misdirect subtly, act normal
- Don't be robotic or overly formal
- Use casual speech like real players would

Examples of natural speech:
- "Hey, heading to electrical?"
- "Just finished admin tasks."
- "Anyone else feel like upper engine is sketchy?"
- "I'm going to medbay, want to come?"`;
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
    'task_in_action_radius': 'You noticed a task location is within reach.'
  };
  return contexts[trigger] || 'Something happened.';
}

// ========== Response Parser ==========

export function parseAIResponse(response: string, context: AIContext): AIDecision {
  // Try to parse structured response
  const goalMatch = response.match(/GOAL:\s*(GO_TO_TASK|WANDER|FOLLOW_AGENT|AVOID_AGENT|IDLE|SPEAK)/i);
  const targetMatch = response.match(/TARGET:\s*(.+?)(?:\n|$)/i);
  const reasoningMatch = response.match(/REASONING:\s*(.+?)(?:\n|$)/i);
  const thoughtMatch = response.match(/THOUGHT:\s*(.+?)(?:\n|$)/i);

  let goalType: AIDecision['goalType'] = 'GO_TO_TASK';
  let targetTaskIndex: number | undefined;
  let targetAgentId: string | undefined;
  let reasoning = 'Continuing tasks';
  let thought: string | undefined;

  if (goalMatch) {
    goalType = goalMatch[1].toUpperCase() as AIDecision['goalType'];
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
    reasoning,
    thought
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
