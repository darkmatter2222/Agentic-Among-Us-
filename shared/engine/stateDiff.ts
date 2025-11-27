import type { AgentSnapshot, WorldSnapshot } from '../types/simulation.types.ts';
import type { AgentDelta, WorldDelta } from '../types/protocol.types.ts';

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
      });
      continue;
    }

    const movementChanged = !movementEqual(agent.movement, previousAgent.movement);
    const summaryChanged = !summaryEqual(agent, previousAgent);

    if (movementChanged || summaryChanged) {
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
  };
}
