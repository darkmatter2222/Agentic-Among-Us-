import type { AgentSnapshot, WorldSnapshot } from '../types/simulation.types.ts';
import type { AgentAIStateDelta, AgentDelta, WorldDelta } from '../types/protocol.types.ts';

function compareNumbers(a: number, b: number, epsilon = 0.001): boolean {
  return Math.abs(a - b) <= epsilon;
}

function positionsEqual(a: AgentSnapshot['movement']['position'], b: AgentSnapshot['movement']['position']): boolean {
  return compareNumbers(a.x, b.x) && compareNumbers(a.y, b.y);
}

function velocitiesEqual(a: AgentSnapshot['movement']['velocity'], b: AgentSnapshot['movement']['velocity']): boolean {
  return compareNumbers(a.x, b.x) && compareNumbers(a.y, b.y);
}

function pathsEqual(a: AgentSnapshot['movement']['path'], b: AgentSnapshot['movement']['path']): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!positionsEqual(a[i], b[i])) {
      return false;
    }
  }
  return true;
}

function movementEqual(a: AgentSnapshot['movement'], b: AgentSnapshot['movement']): boolean {
  return (
    positionsEqual(a.position, b.position) &&
    velocitiesEqual(a.velocity, b.velocity) &&
    compareNumbers(a.facing, b.facing) &&
    compareNumbers(a.speed, b.speed) &&
    a.isMoving === b.isMoving &&
    pathsEqual(a.path, b.path)
  );
}

function summaryEqual(a: AgentSnapshot, b: AgentSnapshot): boolean {
  return (
    a.activityState === b.activityState &&
    a.locationState === b.locationState &&
    a.currentZone === b.currentZone &&
    a.currentGoal === b.currentGoal
  );
}

function arraysEqual<T>(a: T[] | undefined, b: T[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function tasksEqual(a: AgentSnapshot['assignedTasks'], b: AgentSnapshot['assignedTasks']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const taskA = a[i];
    const taskB = b[i];
    if (taskA.taskType !== taskB.taskType ||
        taskA.room !== taskB.room ||
        taskA.isCompleted !== taskB.isCompleted ||
        taskA.isFaking !== taskB.isFaking ||
        taskA.startedAt !== taskB.startedAt ||
        taskA.completedAt !== taskB.completedAt) {
      return false;
    }
  }
  return true;
}

function aiStateEqual(a: AgentSnapshot, b: AgentSnapshot): boolean {
  return (
    a.isThinking === b.isThinking &&
    a.currentThought === b.currentThought &&
    a.recentSpeech === b.recentSpeech &&
    a.currentTaskIndex === b.currentTaskIndex &&
    a.tasksCompleted === b.tasksCompleted &&
    a.role === b.role &&
    a.playerState === b.playerState &&
    arraysEqual(a.visibleAgentIds, b.visibleAgentIds) &&
    tasksEqual(a.assignedTasks, b.assignedTasks)
  );
}

function buildAIStateDelta(agent: AgentSnapshot): AgentAIStateDelta {
  return {
    isThinking: agent.isThinking,
    currentThought: agent.currentThought,
    recentSpeech: agent.recentSpeech,
    visibleAgentIds: agent.visibleAgentIds,
    assignedTasks: agent.assignedTasks,
    currentTaskIndex: agent.currentTaskIndex,
    tasksCompleted: agent.tasksCompleted,
    role: agent.role,
    playerState: agent.playerState,
  };
}

function buildLookup(snapshot: WorldSnapshot): Map<string, AgentSnapshot> {
  const map = new Map<string, AgentSnapshot>();
  for (const agent of snapshot.agents) {
    map.set(agent.id, agent);
  }
  return map;
}

export function diffWorldSnapshots(previous: WorldSnapshot | null, current: WorldSnapshot): WorldDelta {
  if (!previous) {
    return {
      tick: current.tick,
      timestamp: current.timestamp,
      agents: current.agents.map<AgentDelta>(agent => ({
        id: agent.id,
        summaryChanged: true,
        summary: {
          id: agent.id,
          activityState: agent.activityState,
          locationState: agent.locationState,
          currentZone: agent.currentZone,
          currentGoal: agent.currentGoal,
        },
        movementChanged: true,
        movement: agent.movement,
        aiStateChanged: true,
        aiState: buildAIStateDelta(agent),
      })),
      removedAgents: [],
    };
  }

  const previousLookup = buildLookup(previous);
  const currentLookup = buildLookup(current);

  const deltas: AgentDelta[] = [];

  for (const agent of current.agents) {
    const previousAgent = previousLookup.get(agent.id);
    if (!previousAgent) {
      deltas.push({
        id: agent.id,
        summaryChanged: true,
        summary: {
          id: agent.id,
          activityState: agent.activityState,
          locationState: agent.locationState,
          currentZone: agent.currentZone,
          currentGoal: agent.currentGoal,
        },
        movementChanged: true,
        movement: agent.movement,
        aiStateChanged: true,
        aiState: buildAIStateDelta(agent),
      });
      continue;
    }

    const movementChanged = !movementEqual(agent.movement, previousAgent.movement);
    const summaryChanged = !summaryEqual(agent, previousAgent);
    const aiStateChanged = !aiStateEqual(agent, previousAgent);

    if (movementChanged || summaryChanged || aiStateChanged) {
      deltas.push({
        id: agent.id,
        summaryChanged,
        summary: summaryChanged
          ? {
              id: agent.id,
              activityState: agent.activityState,
              locationState: agent.locationState,
              currentZone: agent.currentZone,
              currentGoal: agent.currentGoal,
            }
          : undefined,
        movementChanged,
        movement: movementChanged ? agent.movement : undefined,
        aiStateChanged,
        aiState: aiStateChanged ? buildAIStateDelta(agent) : undefined,
      });
    }
  }

  const removedAgents: string[] = [];
  for (const agent of previous.agents) {
    if (!currentLookup.has(agent.id)) {
      removedAgents.push(agent.id);
    }
  }

  return {
    tick: current.tick,
    timestamp: current.timestamp,
    agents: deltas,
    removedAgents,
    taskProgress: current.taskProgress,
    gamePhase: current.gamePhase,
    recentThoughts: current.recentThoughts,
    recentSpeech: current.recentSpeech,
    bodies: current.bodies,
    llmQueueStats: current.llmQueueStats,
    sabotageState: current.sabotageState,
  };
}
