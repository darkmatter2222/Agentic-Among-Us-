import type { Point } from '../data/poly3-map.ts';
import type { PlayerActivityState, PlayerLocationState } from '../engine/PlayerStateMachine.ts';

export interface MovementSnapshot {
  position: Point;
  velocity: Point;
  facing: number;
  path: Point[];
  isMoving: boolean;
  speed: number;
}

export interface AgentSnapshot {
  id: string;
  color: number;
  visionRadius: number;
  actionRadius: number;
  movement: MovementSnapshot;
  activityState: PlayerActivityState;
  locationState: PlayerLocationState;
  currentZone: string | null;
  currentGoal: string | null;
  timeInStateMs: number;
}

export interface AgentSummarySnapshot {
  id: string;
  activityState: PlayerActivityState;
  locationState: PlayerLocationState;
  currentZone: string | null;
  currentGoal: string | null;
}

export interface WorldSnapshot {
  tick: number;
  timestamp: number;
  agents: AgentSnapshot[];
}
