/**
 * Vent System
 * Handles impostor vent mechanics: entry, exit, travel, and witness detection
 * 
 * Game Mechanics:
 * - Entry Time: 0.3 seconds animation
 * - Exit Time: 0.3 seconds animation
 * - Travel Time: Instant between connected vents
 * - Detection: Vent animation visible for 0.3s on entry/exit
 * - Cooldown: 2 seconds between vent uses
 * - Vision in Vents: Player cannot see outside world
 */

import type { Point } from '../data/poly3-map.ts';
import type { Vent } from '../data/poly3-map.ts';
import { ventLog } from '../logging/index.ts';

// ========== Configuration ==========

export interface VentSystemConfig {
  /** Time to enter vent (seconds) */
  entryTime: number;
  /** Time to exit vent (seconds) */
  exitTime: number;
  /** Cooldown between vent uses (seconds) */
  cooldownTime: number;
  /** Range to interact with vent (units) */
  interactionRange: number;
  /** Range at which players can witness vent usage (units) - typically vision radius */
  witnessDetectionMultiplier: number; // Multiplied by witness's vision radius
}

export const DEFAULT_VENT_CONFIG: VentSystemConfig = {
  entryTime: 0.3,
  exitTime: 0.3,
  cooldownTime: 2.0,
  interactionRange: 1.5, // ~30 pixels at 20px/unit scale
  witnessDetectionMultiplier: 1.0, // Use full vision radius
};

// ========== Vent State Types ==========

export type VentAnimationType = 'entry' | 'exit' | null;

export interface VentState {
  ventId: string;
  /** Player currently in this vent (null if empty) */
  occupantId: string | null;
  /** Whether vent grate is animating */
  isAnimating: boolean;
  /** Current animation type */
  animationType: VentAnimationType;
  /** When animation started (ms timestamp) */
  animationStartTime: number | null;
}

export interface VentEvent {
  id: string;
  timestamp: number;
  playerId: string;
  playerName: string;
  ventId: string;
  ventRoom: string;
  eventType: 'ENTER' | 'EXIT' | 'TRAVEL';
  /** For EXIT events - where they came from. For TRAVEL - where they went */
  relatedVentId?: string;
  /** Position of the vent for distance calculations */
  ventPosition: Point;
  /** Witnesses who saw this event */
  witnesses: VentWitness[];
}

export interface VentWitness {
  id: string;
  name: string;
  distance: number;
  /** Can they actually see the vent (line of sight) */
  hasLineOfSight: boolean;
}

// ========== Validation Types ==========

export interface VentValidation {
  canVent: boolean;
  reason?: string;
  /** For entry - the vent ID. For exit - destination vent ID */
  ventId?: string;
  /** Distance to vent (for UI feedback) */
  distance?: number;
}

// ========== Player Location Interface (for witness detection) ==========

export interface PlayerLocationInfo {
  id: string;
  name: string;
  position: Point;
  visionRadius: number;
  isAlive: boolean;
  role: 'CREWMATE' | 'IMPOSTOR';
  isInVent: boolean;
}

// ========== Main VentSystem Class ==========

export class VentSystem {
  private config: VentSystemConfig;
  private vents: Map<string, Vent>;
  private ventStates: Map<string, VentState>;
  private ventEvents: VentEvent[];
  private playerCooldowns: Map<string, number>; // playerId -> next available time (ms)
  private playersInVents: Map<string, string>; // playerId -> ventId

  /** Callback for line-of-sight checks (injected for decoupling from NavMesh) */
  private lineOfSightChecker?: (from: Point, to: Point) => boolean;

  constructor(
    vents: Vent[],
    lineOfSightChecker?: (from: Point, to: Point) => boolean,
    config: Partial<VentSystemConfig> = {}
  ) {
    this.config = { ...DEFAULT_VENT_CONFIG, ...config };
    this.vents = new Map(vents.map(v => [v.id, v]));
    this.lineOfSightChecker = lineOfSightChecker;
    this.ventStates = new Map();
    this.ventEvents = [];
    this.playerCooldowns = new Map();
    this.playersInVents = new Map();

    // Initialize vent states
    vents.forEach(vent => {
      this.ventStates.set(vent.id, {
        ventId: vent.id,
        occupantId: null,
        isAnimating: false,
        animationType: null,
        animationStartTime: null,
      });
    });

    ventLog.get().info('VentSystem initialized', { ventCount: vents.length });
  }

  /**
   * Set the line-of-sight checker function (inject from NavMesh or similar)
   */
  setLineOfSightChecker(checker: (from: Point, to: Point) => boolean): void {
    this.lineOfSightChecker = checker;
  }

  // ========== Core Vent Actions ==========

  /**
   * Check if a player can enter a specific vent
   */
  canEnterVent(
    playerId: string,
    playerPosition: Point,
    playerRole: 'CREWMATE' | 'IMPOSTOR',
    ventId: string,
    currentTime: number = Date.now()
  ): VentValidation {
    // Only impostors can vent
    if (playerRole !== 'IMPOSTOR') {
      return { canVent: false, reason: 'Only impostors can use vents' };
    }

    // Check if already in a vent
    if (this.playersInVents.has(playerId)) {
      return { canVent: false, reason: 'Already in a vent' };
    }

    // Check if vent exists
    const vent = this.vents.get(ventId);
    if (!vent) {
      return { canVent: false, reason: 'Vent not found' };
    }

    // Check cooldown
    const cooldownEnd = this.playerCooldowns.get(playerId) || 0;
    if (currentTime < cooldownEnd) {
      const remaining = ((cooldownEnd - currentTime) / 1000).toFixed(1);
      return { canVent: false, reason: `Vent cooldown: ${remaining}s remaining` };
    }

    // Check distance
    const distance = this.calculateDistance(playerPosition, vent.position);
    if (distance > this.config.interactionRange) {
      return {
        canVent: false,
        reason: `Too far from vent (${distance.toFixed(1)} > ${this.config.interactionRange})`,
        distance,
        ventId,
      };
    }

    // Check if vent is occupied
    const ventState = this.ventStates.get(ventId);
    if (ventState?.occupantId && ventState.occupantId !== playerId) {
      return { canVent: false, reason: 'Vent is occupied' };
    }

    return { canVent: true, ventId, distance };
  }

  /**
   * Check if a player can exit to a specific vent
   */
  canExitVent(
    playerId: string,
    destinationVentId: string,
    currentTime: number = Date.now()
  ): VentValidation {
    // Check if player is in a vent
    const currentVentId = this.playersInVents.get(playerId);
    if (!currentVentId) {
      return { canVent: false, reason: 'Not in a vent' };
    }

    // Check if destination exists
    const destinationVent = this.vents.get(destinationVentId);
    if (!destinationVent) {
      return { canVent: false, reason: 'Destination vent not found' };
    }

    // Check if destination is connected
    const currentVent = this.vents.get(currentVentId);
    if (!currentVent) {
      return { canVent: false, reason: 'Current vent not found' };
    }

    if (!currentVent.connectedTo.includes(destinationVentId) && destinationVentId !== currentVentId) {
      return { canVent: false, reason: 'Destination not connected to current vent' };
    }

    // Check cooldown
    const cooldownEnd = this.playerCooldowns.get(playerId) || 0;
    if (currentTime < cooldownEnd) {
      const remaining = ((cooldownEnd - currentTime) / 1000).toFixed(1);
      return { canVent: false, reason: `Vent cooldown: ${remaining}s remaining` };
    }

    // Check if destination is occupied by someone else
    const destState = this.ventStates.get(destinationVentId);
    if (destState?.occupantId && destState.occupantId !== playerId) {
      return { canVent: false, reason: 'Destination vent is occupied' };
    }

    return { canVent: true, ventId: destinationVentId };
  }

  /**
   * Enter a vent (returns event if successful, null otherwise)
   */
  enterVent(
    playerId: string,
    playerName: string,
    playerPosition: Point,
    playerRole: 'CREWMATE' | 'IMPOSTOR',
    ventId: string,
    allPlayers: PlayerLocationInfo[],
    currentTime: number = Date.now()
  ): VentEvent | null {
    const validation = this.canEnterVent(playerId, playerPosition, playerRole, ventId, currentTime);
    if (!validation.canVent) {
      ventLog.get().debug('Vent entry denied', { playerName, reason: validation.reason });
      return null;
    }

    const vent = this.vents.get(ventId)!;
    const ventState = this.ventStates.get(ventId)!;

    // Update state
    ventState.occupantId = playerId;
    ventState.isAnimating = true;
    ventState.animationType = 'entry';
    ventState.animationStartTime = currentTime;

    this.playersInVents.set(playerId, ventId);
    
    // Set cooldown for next vent use
    this.playerCooldowns.set(playerId, currentTime + this.config.cooldownTime * 1000);

    // Detect witnesses
    const witnesses = this.detectWitnesses(vent.position, playerId, allPlayers);

    // Create event
    const event: VentEvent = {
      id: `vent_${currentTime}_${playerId}`,
      timestamp: currentTime,
      playerId,
      playerName,
      ventId,
      ventRoom: vent.room ?? 'unknown',
      eventType: 'ENTER',
      ventPosition: vent.position,
      witnesses,
    };

    this.ventEvents.push(event);

    ventLog.get().info('Player entered vent', { playerName, ventId, room: vent.room ?? 'unknown', witnessCount: witnesses.length });

    // Schedule animation end
    setTimeout(() => {
      ventState.isAnimating = false;
      ventState.animationType = null;
      ventState.animationStartTime = null;
    }, this.config.entryTime * 1000);

    return event;
  }

  /**
   * Exit a vent (returns event if successful, null otherwise)
   */
  exitVent(
    playerId: string,
    playerName: string,
    destinationVentId: string,
    allPlayers: PlayerLocationInfo[],
    currentTime: number = Date.now()
  ): VentEvent | null {
    const validation = this.canExitVent(playerId, destinationVentId, currentTime);
    if (!validation.canVent) {
      ventLog.get().debug('Vent exit denied', { playerName, reason: validation.reason });
      return null;
    }

    const currentVentId = this.playersInVents.get(playerId)!;
    const destinationVent = this.vents.get(destinationVentId)!;
    const destVentState = this.ventStates.get(destinationVentId)!;

    // If traveling to different vent, create travel event first
    if (currentVentId !== destinationVentId) {
      // Clear current vent
      const currentVentState = this.ventStates.get(currentVentId)!;
      currentVentState.occupantId = null;

      // Move to destination
      destVentState.occupantId = playerId;
      this.playersInVents.set(playerId, destinationVentId);

      // Record internal travel (not witnessed)
      const travelEvent: VentEvent = {
        id: `vent_travel_${currentTime}_${playerId}`,
        timestamp: currentTime,
        playerId,
        playerName,
        ventId: destinationVentId,
        ventRoom: destinationVent.room ?? 'unknown',
        eventType: 'TRAVEL',
        relatedVentId: currentVentId,
        ventPosition: destinationVent.position,
        witnesses: [], // Travel inside vents is not witnessed
      };
      this.ventEvents.push(travelEvent);
    }

    // Start exit animation
    destVentState.isAnimating = true;
    destVentState.animationType = 'exit';
    destVentState.animationStartTime = currentTime;

    // Detect witnesses for exit
    const witnesses = this.detectWitnesses(destinationVent.position, playerId, allPlayers);

    // Create exit event
    const event: VentEvent = {
      id: `vent_exit_${currentTime}_${playerId}`,
      timestamp: currentTime,
      playerId,
      playerName,
      ventId: destinationVentId,
      ventRoom: destinationVent.room ?? 'unknown',
      eventType: 'EXIT',
      relatedVentId: currentVentId !== destinationVentId ? currentVentId : undefined,
      ventPosition: destinationVent.position,
      witnesses,
    };

    this.ventEvents.push(event);

    // Set cooldown
    this.playerCooldowns.set(playerId, currentTime + this.config.cooldownTime * 1000);

    ventLog.get().info('Player exiting vent', { playerName, ventId: destinationVentId, room: destinationVent.room ?? 'unknown', witnessCount: witnesses.length });

    // Schedule state clear after animation
    setTimeout(() => {
      destVentState.occupantId = null;
      destVentState.isAnimating = false;
      destVentState.animationType = null;
      destVentState.animationStartTime = null;
      this.playersInVents.delete(playerId);
    }, this.config.exitTime * 1000);

    return event;
  }

  /**
   * Travel within the vent network without exiting
   * (Used when AI chooses a different connected vent as destination)
   */
  travelInVent(playerId: string, toVentId: string, currentTime: number = Date.now()): boolean {
    const currentVentId = this.playersInVents.get(playerId);
    if (!currentVentId) return false;

    const currentVent = this.vents.get(currentVentId);
    if (!currentVent) return false;

    // Must be connected
    if (!currentVent.connectedTo.includes(toVentId)) return false;

    const toVent = this.vents.get(toVentId);
    if (!toVent) return false;

    // Check destination not occupied
    const toState = this.ventStates.get(toVentId);
    if (toState?.occupantId && toState.occupantId !== playerId) return false;

    // Update states
    const fromState = this.ventStates.get(currentVentId)!;
    fromState.occupantId = null;

    const destState = this.ventStates.get(toVentId)!;
    destState.occupantId = playerId;

    this.playersInVents.set(playerId, toVentId);

    ventLog.get().debug('Player traveled through vents', { playerId, from: currentVentId, to: toVentId });

    return true;
  }

  // ========== Witness Detection ==========

  /**
   * Detect players who can see a vent event
   */
  private detectWitnesses(
    ventPosition: Point,
    excludePlayerId: string,
    allPlayers: PlayerLocationInfo[]
  ): VentWitness[] {
    const witnesses: VentWitness[] = [];

    for (const player of allPlayers) {
      // Skip self
      if (player.id === excludePlayerId) continue;

      // Skip dead players
      if (!player.isAlive) continue;

      // Skip players in vents (can't see outside)
      if (player.isInVent) continue;

      // Calculate distance
      const distance = this.calculateDistance(player.position, ventPosition);

      // Check if within vision radius (with multiplier from config)
      const effectiveVisionRange = player.visionRadius * this.config.witnessDetectionMultiplier;
      if (distance > effectiveVisionRange) continue;

      // Check line of sight if checker is available
      let hasLineOfSight = true;
      if (this.lineOfSightChecker) {
        hasLineOfSight = this.lineOfSightChecker(player.position, ventPosition);
      }

      if (hasLineOfSight) {
        witnesses.push({
          id: player.id,
          name: player.name,
          distance,
          hasLineOfSight,
        });
      }
    }

    return witnesses;
  }

  // ========== Query Methods ==========

  /**
   * Get all vents in the system
   */
  getAllVents(): Vent[] {
    return Array.from(this.vents.values());
  }

  /**
   * Get a vent by ID
   */
  getVent(ventId: string): Vent | undefined {
    return this.vents.get(ventId);
  }

  /**
   * Get connected vents for a given vent
   */
  getConnectedVents(ventId: string): Vent[] {
    const vent = this.vents.get(ventId);
    if (!vent) return [];

    return vent.connectedTo
      .map(id => this.vents.get(id))
      .filter((v): v is Vent => v !== undefined);
  }

  /**
   * Get nearby vents within a certain range of a position
   */
  getNearbyVents(position: Point, range: number): Array<{ vent: Vent; distance: number }> {
    const nearby: Array<{ vent: Vent; distance: number }> = [];

    for (const vent of this.vents.values()) {
      const distance = this.calculateDistance(position, vent.position);
      if (distance <= range) {
        nearby.push({ vent, distance });
      }
    }

    // Sort by distance
    nearby.sort((a, b) => a.distance - b.distance);
    return nearby;
  }

  /**
   * Get the nearest vent to a position
   */
  getNearestVent(position: Point): { vent: Vent; distance: number } | null {
    let nearest: { vent: Vent; distance: number } | null = null;

    for (const vent of this.vents.values()) {
      const distance = this.calculateDistance(position, vent.position);
      if (!nearest || distance < nearest.distance) {
        nearest = { vent, distance };
      }
    }

    return nearest;
  }

  /**
   * Get vents in a specific room
   */
  getVentsByRoom(roomId: string): Vent[] {
    return Array.from(this.vents.values()).filter(v => v.room && v.room === roomId);
  }

  /**
   * Check if a player is currently in a vent
   */
  isPlayerInVent(playerId: string): boolean {
    return this.playersInVents.has(playerId);
  }

  /**
   * Get the vent a player is currently in
   */
  getPlayerVent(playerId: string): string | undefined {
    return this.playersInVents.get(playerId);
  }

  /**
   * Get all players currently in vents
   */
  getPlayersInVents(): Map<string, string> {
    return new Map(this.playersInVents);
  }

  /**
   * Get vent cooldown remaining for a player
   */
  getCooldownRemaining(playerId: string, currentTime: number = Date.now()): number {
    const cooldownEnd = this.playerCooldowns.get(playerId) || 0;
    return Math.max(0, (cooldownEnd - currentTime) / 1000);
  }

  /**
   * Get the state of a vent (for animation rendering)
   */
  getVentState(ventId: string): VentState | undefined {
    return this.ventStates.get(ventId);
  }

  /**
   * Get a player's vent status (for AI decision making)
   */
  getPlayerVentState(playerId: string): {
    isInVent: boolean;
    currentVentId: string | null;
    cooldownRemaining: number;
  } {
    const currentVentId = this.playersInVents.get(playerId) || null;
    const cooldownEnd = this.playerCooldowns.get(playerId) || 0;
    const cooldownRemaining = Math.max(0, (cooldownEnd - Date.now()) / 1000);

    return {
      isInVent: currentVentId !== null,
      currentVentId,
      cooldownRemaining,
    };
  }

  /**
   * Alias for getNearbyVents - get vents within interaction range of a position
   */
  getVentsInRange(position: Point, range: number = 150): Vent[] {
    return this.getNearbyVents(position, range).map(v => v.vent);
  }

  // ========== Event History ==========

  /**
   * Get all vent events
   */
  getVentEvents(): VentEvent[] {
    return [...this.ventEvents];
  }

  /**
   * Get recent vent events
   */
  getRecentVentEvents(count: number = 10): VentEvent[] {
    return this.ventEvents.slice(-count);
  }

  /**
   * Get events since a timestamp
   */
  getEventsSince(timestamp: number): VentEvent[] {
    return this.ventEvents.filter(e => e.timestamp > timestamp);
  }

  /**
   * Clear old events (for memory management)
   */
  clearOldEvents(olderThan: number): void {
    const cutoff = Date.now() - olderThan;
    this.ventEvents = this.ventEvents.filter(e => e.timestamp >= cutoff);
  }

  // ========== Utility Methods ==========

  private calculateDistance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Reset the system (for new games)
   */
  reset(): void {
    this.ventEvents = [];
    this.playerCooldowns.clear();
    this.playersInVents.clear();

    // Reset all vent states
    for (const [ventId, state] of this.ventStates) {
      state.occupantId = null;
      state.isAnimating = false;
      state.animationType = null;
      state.animationStartTime = null;
    }

    ventLog.get().debug('VentSystem reset');
  }
}

// ========== Helper Functions ==========

/**
 * Check if two vents are connected (bidirectional check)
 */
export function areVentsConnected(ventA: Vent, ventB: Vent): boolean {
  return ventA.connectedTo.includes(ventB.id) || ventB.connectedTo.includes(ventA.id);
}

/**
 * Get all vents in the same network as a given vent
 * (Uses BFS to find all reachable vents)
 */
export function getVentNetwork(startVentId: string, allVents: Vent[]): Vent[] {
  const ventMap = new Map(allVents.map(v => [v.id, v]));
  const startVent = ventMap.get(startVentId);
  if (!startVent) return [];

  const visited = new Set<string>();
  const network: Vent[] = [];
  const queue: string[] = [startVentId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;

    visited.add(currentId);
    const vent = ventMap.get(currentId);
    if (!vent) continue;

    network.push(vent);

    // Add connected vents to queue
    for (const connectedId of vent.connectedTo) {
      if (!visited.has(connectedId)) {
        queue.push(connectedId);
      }
    }
  }

  return network;
}

/**
 * Calculate witness risk for exiting at a vent
 * Returns 0-100 based on nearby players
 */
export function calculateWitnessRisk(
  ventPosition: Point,
  playerLocations: Array<{ position: Point; visionRadius: number; isAlive: boolean }>,
  excludeSelf: boolean = true
): number {
  let maxRisk = 0;

  for (const player of playerLocations) {
    if (!player.isAlive) continue;

    const dx = player.position.x - ventPosition.x;
    const dy = player.position.y - ventPosition.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Calculate risk based on how close player is relative to their vision
    if (distance <= player.visionRadius) {
      // Direct line of sight - high risk
      const proximityFactor = 1 - (distance / player.visionRadius);
      const risk = Math.round(proximityFactor * 100);
      maxRisk = Math.max(maxRisk, risk);
    }
  }

  return maxRisk;
}
