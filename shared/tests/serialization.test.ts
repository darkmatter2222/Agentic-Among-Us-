import { structuredClone } from 'node:util';
import { describe, expect, it } from 'vitest';
import { serializeAgent, serializeAgentSummary, serializeWorld } from '../engine/serialization.ts';
import { diffWorldSnapshots } from '../engine/stateDiff.ts';
import type { AIAgent } from '../engine/AIAgent.ts';
import type { MovementState } from '../engine/MovementController.ts';
import type { PlayerStateMachineState } from '../engine/PlayerStateMachine.ts';
import { PlayerActivityState, PlayerLocationState } from '../engine/PlayerStateMachine.ts';
import type { AgentSnapshot, WorldSnapshot } from '../types/simulation.types.ts';

describe('serialization helpers', () => {
  const baseMovementState: MovementState = {
    currentPosition: { x: 10, y: 20 },
    targetPosition: { x: 40, y: 60 },
    path: [
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      { x: 40, y: 60 }
    ],
    pathIndex: 1,
    distanceTraveled: 5,
    isMoving: true,
    speed: 120,
    facing: Math.PI / 4,
    velocity: { x: 3, y: 4 }
  };

  const baseStateMachine: PlayerStateMachineState = {
    playerId: 'agent-1',
    activityState: PlayerActivityState.WALKING,
    locationState: PlayerLocationState.IN_HALLWAY,
    currentZone: 'Hallway',
    position: { x: 10, y: 20 },
    lastStateChange: 1_700_000_000_000,
    stateHistory: []
  };

  function createMockAgent(overrides: Partial<{ movement: MovementState; machine: PlayerStateMachineState; goal: string | null }> = {}): AIAgent {
    const movementState = overrides.movement ?? structuredClone(baseMovementState);
    const machineState = overrides.machine ?? structuredClone(baseStateMachine);
    const goal = overrides.goal ?? 'Test goal';

    const mockMovementController = {
      getState: () => structuredClone(movementState),
    };

    const mockStateMachine = {
      getState: () => structuredClone(machineState),
    };

    const agent: Partial<AIAgent> = {
      getId: () => machineState.playerId,
      getColor: () => 0xff3366,
      getVisionRadius: () => 120,
      getActionRadius: () => 45,
      getCurrentGoal: () => goal,
      getMovementController: () => mockMovementController as never,
      getStateMachine: () => mockStateMachine as never,
    };

    return agent as AIAgent;
  }

  it('serializes agent state with deep copies', () => {
    const timestamp = 1_700_000_000_800;
    const mutableMovement = structuredClone(baseMovementState);
    const agent = createMockAgent({ movement: mutableMovement });

    const snapshot = serializeAgent(agent, timestamp);

    expect(snapshot).toMatchObject({
      id: 'agent-1',
      color: 0xff3366,
      visionRadius: 120,
      actionRadius: 45,
      activityState: PlayerActivityState.WALKING,
      locationState: PlayerLocationState.IN_HALLWAY,
      currentZone: 'Hallway',
      currentGoal: 'Test goal',
      timeInStateMs: timestamp - baseStateMachine.lastStateChange,
    });

    expect(snapshot.movement.position).toEqual({ x: 10, y: 20 });
    expect(snapshot.movement.path).toHaveLength(3);

    // Ensure deep copy behaviour to prevent shared references
    mutableMovement.path[0].x = 999;
    expect(snapshot.movement.path[0].x).toBe(10);
  });

  it('serializes world snapshots for multiple agents', () => {
    const timestamp = 1_700_000_000_900;
    const agents: AIAgent[] = [
      createMockAgent(),
      createMockAgent({ machine: { ...baseStateMachine, playerId: 'agent-2' } })
    ];

    const world = serializeWorld(agents, 12, timestamp);

    expect(world.tick).toBe(12);
    expect(world.timestamp).toBe(timestamp);
    expect(world.agents).toHaveLength(2);
    expect(new Set(world.agents.map(agent => agent.id))).toEqual(new Set(['agent-1', 'agent-2']));
  });
});

describe('diffWorldSnapshots', () => {
  const baseAgent: AgentSnapshot = {
    id: 'agent-1',
    name: 'Agent 1',
    color: 0xff3366,
    visionRadius: 120,
    actionRadius: 45,
    movement: {
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      facing: 0,
      path: [],
      isMoving: false,
      speed: 0,
    },
    activityState: PlayerActivityState.IDLE,
    locationState: PlayerLocationState.UNKNOWN,
    currentZone: null,
    currentGoal: null,
    timeInStateMs: 0,
  };

  it('emits full deltas when no previous snapshot exists', () => {
    const current: WorldSnapshot = {
      tick: 1,
      timestamp: 123,
      agents: [structuredClone(baseAgent)],
    };

    const delta = diffWorldSnapshots(null, current);

    expect(delta.tick).toBe(1);
    expect(delta.agents).toHaveLength(1);
    expect(delta.agents[0]).toMatchObject({
      id: 'agent-1',
      summaryChanged: true,
      movementChanged: true,
    });
  });

  it('emits targeted deltas for changed agents only', () => {
    const previous: WorldSnapshot = {
      tick: 3,
      timestamp: 200,
      agents: [structuredClone(baseAgent)],
    };

    const movedAgent: AgentSnapshot = {
      ...baseAgent,
      movement: {
        ...baseAgent.movement,
        position: { x: 15, y: 25 },
        velocity: { x: 1, y: 1 },
        path: [{ x: 15, y: 25 }],
      },
      activityState: PlayerActivityState.WALKING,
      currentZone: 'Cafeteria',
    };

    const current: WorldSnapshot = {
      tick: 4,
      timestamp: 260,
      agents: [movedAgent],
    };

    const delta = diffWorldSnapshots(previous, current);

    expect(delta.tick).toBe(4);
    expect(delta.removedAgents).toHaveLength(0);
    expect(delta.agents).toHaveLength(1);

    const entry = delta.agents[0];
    expect(entry.summaryChanged).toBe(true);
    expect(entry.movementChanged).toBe(true);
    expect(entry.summary?.currentZone).toBe('Cafeteria');
    expect(entry.movement?.position).toEqual({ x: 15, y: 25 });
  });

  it('tracks removed agents', () => {
    const previous: WorldSnapshot = {
      tick: 2,
      timestamp: 150,
      agents: [structuredClone(baseAgent)],
    };

    const current: WorldSnapshot = {
      tick: 3,
      timestamp: 180,
      agents: [],
    };

    const delta = diffWorldSnapshots(previous, current);
    expect(delta.removedAgents).toEqual(['agent-1']);
    expect(delta.agents).toHaveLength(0);
  });
});
