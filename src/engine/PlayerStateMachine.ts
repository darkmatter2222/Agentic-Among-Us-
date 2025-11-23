/**
 * Player State Machine
 * Manages player states and transitions (IDLE, WALKING, IN_ROOM, etc.)
 */

import type { Point } from '../data/poly3-map.ts';
import type { ZoneType } from './ZoneDetector.ts';

export const PlayerActivityState = {
  IDLE: 'IDLE',
  WALKING: 'WALKING',
  DOING_TASK: 'DOING_TASK',
  IN_VENT: 'IN_VENT',
  IN_MEETING: 'IN_MEETING'
} as const;
export type PlayerActivityState = typeof PlayerActivityState[keyof typeof PlayerActivityState];

export const PlayerLocationState = {
  IN_ROOM: 'IN_ROOM',
  IN_HALLWAY: 'IN_HALLWAY',
  UNKNOWN: 'UNKNOWN'
} as const;
export type PlayerLocationState = typeof PlayerLocationState[keyof typeof PlayerLocationState];

export interface StateTransitionEvent {
  playerId: string;
  fromState: PlayerActivityState;
  toState: PlayerActivityState;
  timestamp: number;
  reason?: string;
}

export interface PlayerStateMachineState {
  playerId: string;
  activityState: PlayerActivityState;
  locationState: PlayerLocationState;
  currentZone: string | null;
  position: Point;
  lastStateChange: number;
  stateHistory: StateTransitionEvent[];
}

export class PlayerStateMachine {
  private state: PlayerStateMachineState;
  private listeners: Map<PlayerActivityState, ((event: StateTransitionEvent) => void)[]>;
  
  constructor(playerId: string, initialPosition: Point) {
    this.state = {
      playerId,
      activityState: PlayerActivityState.IDLE,
      locationState: PlayerLocationState.UNKNOWN,
      currentZone: null,
      position: initialPosition,
      lastStateChange: Date.now(),
      stateHistory: []
    };
    
    this.listeners = new Map();
  }
  
  /**
   * Transition to a new activity state
   */
  transitionTo(newState: PlayerActivityState, reason?: string): void {
    if (this.state.activityState === newState) {
      return; // No change
    }
    
    const event: StateTransitionEvent = {
      playerId: this.state.playerId,
      fromState: this.state.activityState,
      toState: newState,
      timestamp: Date.now(),
      reason
    };
    
    // Update state
    this.state.activityState = newState;
    this.state.lastStateChange = event.timestamp;
    this.state.stateHistory.push(event);
    
    // Keep history limited to last 20 transitions
    if (this.state.stateHistory.length > 20) {
      this.state.stateHistory.shift();
    }
    
    // Trigger listeners
    this.triggerListeners(newState, event);
  }
  
  /**
   * Update location state based on zone type
   */
  updateLocation(zoneName: string | null, zoneType: ZoneType): void {
    this.state.currentZone = zoneName;
    
    // Map zone type to location state
    if (zoneType === 'ROOM') {
      this.state.locationState = PlayerLocationState.IN_ROOM;
    } else if (zoneType === 'HALLWAY') {
      this.state.locationState = PlayerLocationState.IN_HALLWAY;
    } else {
      this.state.locationState = PlayerLocationState.UNKNOWN;
    }
  }
  
  /**
   * Update player position
   */
  updatePosition(position: Point): void {
    this.state.position = position;
  }
  
  /**
   * Get current activity state
   */
  getActivityState(): PlayerActivityState {
    return this.state.activityState;
  }
  
  /**
   * Get current location state
   */
  getLocationState(): PlayerLocationState {
    return this.state.locationState;
  }
  
  /**
   * Get current zone name
   */
  getCurrentZone(): string | null {
    return this.state.currentZone;
  }
  
  /**
   * Get full state
   */
  getState(): PlayerStateMachineState {
    return { ...this.state };
  }
  
  /**
   * Check if in a specific state
   */
  isInState(state: PlayerActivityState): boolean {
    return this.state.activityState === state;
  }
  
  /**
   * Check if currently moving
   */
  isMoving(): boolean {
    return this.state.activityState === PlayerActivityState.WALKING;
  }
  
  /**
   * Check if currently idle
   */
  isIdle(): boolean {
    return this.state.activityState === PlayerActivityState.IDLE;
  }
  
  /**
   * Check if in a room
   */
  isInRoom(): boolean {
    return this.state.locationState === PlayerLocationState.IN_ROOM;
  }
  
  /**
   * Check if in a hallway
   */
  isInHallway(): boolean {
    return this.state.locationState === PlayerLocationState.IN_HALLWAY;
  }
  
  /**
   * Get time in current state (milliseconds)
   */
  getTimeInCurrentState(): number {
    return Date.now() - this.state.lastStateChange;
  }
  
  /**
   * Add state change listener
   */
  onStateChange(state: PlayerActivityState, callback: (event: StateTransitionEvent) => void): void {
    if (!this.listeners.has(state)) {
      this.listeners.set(state, []);
    }
    this.listeners.get(state)!.push(callback);
  }
  
  /**
   * Trigger all listeners for a state
   */
  private triggerListeners(state: PlayerActivityState, event: StateTransitionEvent): void {
    const stateListeners = this.listeners.get(state);
    if (stateListeners) {
      for (const listener of stateListeners) {
        listener(event);
      }
    }
  }
  
  /**
   * Get state history
   */
  getStateHistory(): StateTransitionEvent[] {
    return [...this.state.stateHistory];
  }
  
  /**
   * Reset state machine
   */
  reset(): void {
    const currentPosition = this.state.position;
    const playerId = this.state.playerId;
    
    this.state = {
      playerId,
      activityState: PlayerActivityState.IDLE,
      locationState: PlayerLocationState.UNKNOWN,
      currentZone: null,
      position: currentPosition,
      lastStateChange: Date.now(),
      stateHistory: []
    };
  }
}
