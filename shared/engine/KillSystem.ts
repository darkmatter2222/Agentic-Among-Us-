/**
 * Kill System - Manages impostor kill mechanics, witnesses, and body generation
 * 
 * Official Among Us Kill Mechanics:
 * - Kill Range: Short (1.0 units), Medium (1.8 units), Long (2.5 units)
 * - Kill Cooldown: 10-60 seconds (configurable)
 * - Kill Animation Duration: 0.5 seconds (killer frozen)
 * - Multi-Kill Prevention: Cannot kill during animation
 * - Report Distance: 2.5 units from body center
 */

import type { Point } from '../data/poly3-map.ts';
import type { PlayerRole, PlayerState } from '../types/game.types.ts';

// ========== Configuration ==========

export interface KillSystemConfig {
  killCooldown: number; // seconds
  killRange: 'short' | 'medium' | 'long';
  killAnimationDuration: number; // seconds
  reportRange: number; // units
  visionRadiusForWitness: number; // units
}

export const DEFAULT_KILL_CONFIG: KillSystemConfig = {
  killCooldown: 25, // 25 seconds default
  killRange: 'medium',
  killAnimationDuration: 0.5, // 0.5 seconds
  reportRange: 2.5, // units (scaled to game units)
  visionRadiusForWitness: 150, // Same as agent vision
};

// Kill range values in game units (scaled from Among Us)
export const KILL_RANGES: Record<string, number> = {
  short: 50,   // Approximately 1.0 Among Us units * our scale
  medium: 90,  // Approximately 1.8 Among Us units * our scale
  long: 125,   // Approximately 2.5 Among Us units * our scale
};

// ========== Types ==========

export interface DeadBody {
  id: string;
  victimId: string;
  victimName: string;
  victimColor: number;
  killerId: string;
  killerName: string;
  position: Point;
  killedAt: number;
  zone: string | null;
  // Reporting
  isReported: boolean;
  reportedBy: string | null;
  reportedAt: number | null;
}

export interface KillAttempt {
  success: boolean;
  reason?: string;
  body?: DeadBody;
  witnesses?: WitnessRecord[];
}

export interface WitnessRecord {
  witnessId: string;
  witnessName: string;
  sawKill: boolean;           // Directly saw the kill happen
  sawBody: boolean;           // Saw the body (but not the kill)
  sawKillerNearBody: boolean; // Saw someone near the body
  perceivedKillerColor: number | null; // Color they think they saw (may be wrong)
  colorConfidence: number;    // 0-1 how sure they are about the color
  heardSound: boolean;        // Heard the kill sound
  distance: number;           // Distance from the kill
  position: Point;            // Where the witness was
  timestamp: number;
}

export interface KillEvent {
  id: string;
  killerId: string;
  killerName: string;
  victimId: string;
  victimName: string;
  position: Point;
  zone: string | null;
  timestamp: number;
  witnesses: WitnessRecord[];
  bodyId: string;
}

export interface ImpostorKillState {
  agentId: string;
  killCooldownRemaining: number; // seconds
  isInKillAnimation: boolean;
  killAnimationEndTime: number;
  lastKillTime: number;
  killCount: number;
  // Potential targets in range
  targetsInRange: string[];
}

// ========== Helper Functions ==========

/**
 * Calculate distance between two points
 */
function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Generate unique ID
 */
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Determine if a witness accurately perceives the killer's color
 * - Distance affects accuracy
 * - Panic/stress can cause misperception
 * - Very close = high accuracy, far away = lower accuracy
 */
function calculateColorPerception(
  witnessDistance: number,
  actualColor: number,
  visionRadius: number
): { perceivedColor: number | null; confidence: number } {
  // If very close, high accuracy
  if (witnessDistance < visionRadius * 0.3) {
    return { perceivedColor: actualColor, confidence: 0.95 };
  }
  
  // Medium distance - usually correct but some doubt
  if (witnessDistance < visionRadius * 0.6) {
    return { perceivedColor: actualColor, confidence: 0.75 };
  }
  
  // Far away - might get color wrong or not see at all
  if (witnessDistance < visionRadius * 0.85) {
    // 70% chance to see correct color, 30% chance to be unsure
    if (Math.random() < 0.7) {
      return { perceivedColor: actualColor, confidence: 0.5 };
    }
    return { perceivedColor: null, confidence: 0.2 };
  }
  
  // Very far - probably didn't see clearly
  if (Math.random() < 0.3) {
    return { perceivedColor: actualColor, confidence: 0.25 };
  }
  return { perceivedColor: null, confidence: 0.1 };
}

// ========== Main Kill System Class ==========

export class KillSystem {
  private config: KillSystemConfig;
  private bodies: Map<string, DeadBody>;
  private killEvents: KillEvent[];
  private impostorStates: Map<string, ImpostorKillState>;
  private killRange: number;
  
  constructor(config: Partial<KillSystemConfig> = {}) {
    this.config = { ...DEFAULT_KILL_CONFIG, ...config };
    this.bodies = new Map();
    this.killEvents = [];
    this.impostorStates = new Map();
    this.killRange = KILL_RANGES[this.config.killRange];
  }
  
  /**
   * Initialize kill state for an impostor
   */
  initializeImpostor(agentId: string): void {
    this.impostorStates.set(agentId, {
      agentId,
      killCooldownRemaining: 0, // Start with no cooldown - impostors can kill immediately
      isInKillAnimation: false,
      killAnimationEndTime: 0,
      lastKillTime: 0,
      killCount: 0,
      targetsInRange: [],
    });
  }
  
  /**
   * Update kill cooldowns and animation states
   */
  update(deltaSeconds: number): void {
    const now = Date.now();
    
    for (const [_, state] of this.impostorStates) {
      // Update cooldown
      if (state.killCooldownRemaining > 0) {
        state.killCooldownRemaining = Math.max(0, state.killCooldownRemaining - deltaSeconds);
      }
      
      // Check if kill animation ended
      if (state.isInKillAnimation && now >= state.killAnimationEndTime) {
        state.isInKillAnimation = false;
      }
    }
  }
  
  /**
   * Check if an impostor can kill right now
   */
  canKill(impostorId: string): { canKill: boolean; reason?: string } {
    const state = this.impostorStates.get(impostorId);
    
    if (!state) {
      return { canKill: false, reason: 'Not registered as impostor' };
    }
    
    if (state.isInKillAnimation) {
      return { canKill: false, reason: 'Currently in kill animation' };
    }
    
    if (state.killCooldownRemaining > 0) {
      return { canKill: false, reason: `Kill on cooldown (${state.killCooldownRemaining.toFixed(1)}s remaining)` };
    }
    
    return { canKill: true };
  }
  
  /**
   * Get potential kill targets for an impostor
   */
  updateTargetsInRange(
    impostorId: string,
    impostorPosition: Point,
    otherAgents: Array<{ id: string; position: Point; role: PlayerRole; state: PlayerState }>
  ): string[] {
    const state = this.impostorStates.get(impostorId);
    if (!state) return [];
    
    const targets: string[] = [];
    
    for (const agent of otherAgents) {
      // Can only kill alive crewmates
      if (agent.role === 'IMPOSTOR' || agent.state !== 'ALIVE') continue;
      
      const dist = distance(impostorPosition, agent.position);
      if (dist <= this.killRange) {
        targets.push(agent.id);
      }
    }
    
    state.targetsInRange = targets;
    return targets;
  }
  
  /**
   * Get current targets in range for an impostor
   */
  getTargetsInRange(impostorId: string): string[] {
    return this.impostorStates.get(impostorId)?.targetsInRange || [];
  }
  
  /**
   * Attempt to kill a target
   */
  attemptKill(
    impostorId: string,
    impostorName: string,
    impostorPosition: Point,
    targetId: string,
    targetName: string,
    targetColor: number,
    targetPosition: Point,
    zone: string | null,
    // For witness detection
    nearbyAgents: Array<{
      id: string;
      name: string;
      position: Point;
      facing: number; // radians
      visionRadius: number;
    }>
  ): KillAttempt {
    // Check if can kill
    const canKillResult = this.canKill(impostorId);
    if (!canKillResult.canKill) {
      return { success: false, reason: canKillResult.reason };
    }
    
    // Check target is in range
    const dist = distance(impostorPosition, targetPosition);
    if (dist > this.killRange) {
      return { success: false, reason: `Target out of range (${dist.toFixed(1)} > ${this.killRange})` };
    }
    
    const now = Date.now();
    
    // Create body
    const bodyId = generateId('body');
    const body: DeadBody = {
      id: bodyId,
      victimId: targetId,
      victimName: targetName,
      victimColor: targetColor,
      killerId: impostorId,
      killerName: impostorName,
      position: { ...targetPosition },
      killedAt: now,
      zone,
      isReported: false,
      reportedBy: null,
      reportedAt: null,
    };
    
    this.bodies.set(bodyId, body);
    
    // Determine witnesses
    const witnesses = this.detectWitnesses(
      impostorId,
      targetId,
      targetPosition,
      nearbyAgents,
      now
    );
    
    // Create kill event
    const killEvent: KillEvent = {
      id: generateId('kill'),
      killerId: impostorId,
      killerName: impostorName,
      victimId: targetId,
      victimName: targetName,
      position: { ...targetPosition },
      zone,
      timestamp: now,
      witnesses,
      bodyId,
    };
    
    this.killEvents.push(killEvent);
    
    // Update impostor state
    const state = this.impostorStates.get(impostorId)!;
    state.killCooldownRemaining = this.config.killCooldown;
    state.isInKillAnimation = true;
    state.killAnimationEndTime = now + this.config.killAnimationDuration * 1000;
    state.lastKillTime = now;
    state.killCount++;
    
    console.log(`[KillSystem] ${impostorName} killed ${targetName} in ${zone || 'unknown'}. Witnesses: ${witnesses.length}`);
    
    return {
      success: true,
      body,
      witnesses,
    };
  }
  
  /**
   * Detect who witnessed the kill
   */
  private detectWitnesses(
    killerId: string,
    victimId: string,
    killPosition: Point,
    nearbyAgents: Array<{
      id: string;
      name: string;
      position: Point;
      facing: number;
      visionRadius: number;
    }>,
    timestamp: number
  ): WitnessRecord[] {
    const witnesses: WitnessRecord[] = [];
    
    for (const agent of nearbyAgents) {
      // Skip killer and victim
      if (agent.id === killerId || agent.id === victimId) continue;
      
      const dist = distance(agent.position, killPosition);
      
      // Outside vision radius - can't witness anything
      if (dist > agent.visionRadius) continue;
      
      // Calculate angle from agent to kill position
      const angleToKill = Math.atan2(
        killPosition.y - agent.position.y,
        killPosition.x - agent.position.x
      );
      
      // Calculate angle difference (how much they'd need to turn to see it)
      let angleDiff = Math.abs(angleToKill - agent.facing);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
      
      // Field of view is roughly 180 degrees (π radians)
      const FOV = Math.PI; // 180 degrees
      const isInFOV = angleDiff <= FOV / 2;
      
      // Determine what they saw
      const sawKill = isInFOV && dist < agent.visionRadius * 0.7;
      const sawBody = !sawKill && isInFOV && dist < agent.visionRadius * 0.9;
      const sawKillerNearBody = sawKill || (isInFOV && dist < agent.visionRadius * 0.5);
      
      // Calculate color perception
      // We need the actual killer color, but we'll pass null here and let the caller fill it
      // For now, we'll record that they might have seen someone
      const heardSound = dist < agent.visionRadius * 0.8; // Can hear if reasonably close
      
      // Only add as witness if they perceived something
      if (sawKill || sawBody || sawKillerNearBody || heardSound) {
        witnesses.push({
          witnessId: agent.id,
          witnessName: agent.name,
          sawKill,
          sawBody,
          sawKillerNearBody,
          perceivedKillerColor: null, // Will be filled by caller with actual color
          colorConfidence: sawKill ? 0.9 : sawKillerNearBody ? 0.6 : 0.2,
          heardSound,
          distance: dist,
          position: { ...agent.position },
          timestamp,
        });
      }
    }
    
    return witnesses;
  }
  
  /**
   * Update witness color perception with actual killer color
   */
  updateWitnessColorPerception(witnesses: WitnessRecord[], killerColor: number): WitnessRecord[] {
    return witnesses.map(w => {
      const perception = calculateColorPerception(w.distance, killerColor, this.config.visionRadiusForWitness);
      return {
        ...w,
        perceivedKillerColor: perception.perceivedColor,
        colorConfidence: perception.confidence,
      };
    });
  }
  
  /**
   * Report a body
   */
  reportBody(bodyId: string, reporterId: string, reporterPosition: Point): boolean {
    const body = this.bodies.get(bodyId);
    if (!body || body.isReported) return false;
    
    // Check reporter is in range
    const dist = distance(reporterPosition, body.position);
    if (dist > this.config.reportRange * 50) { // Scale report range to game units
      return false;
    }
    
    body.isReported = true;
    body.reportedBy = reporterId;
    body.reportedAt = Date.now();
    
    return true;
  }
  
  /**
   * Get all unreported bodies
   */
  getUnreportedBodies(): DeadBody[] {
    return Array.from(this.bodies.values()).filter(b => !b.isReported);
  }
  
  /**
   * Get all bodies
   */
  getAllBodies(): DeadBody[] {
    return Array.from(this.bodies.values());
  }
  
  /**
   * Get body by ID
   */
  getBody(bodyId: string): DeadBody | undefined {
    return this.bodies.get(bodyId);
  }
  
  /**
   * Get all dead bodies
   */
  getBodies(): DeadBody[] {
    return Array.from(this.bodies.values());
  }
  
  /**
   * Get bodies in range of a position
   */
  getBodiesInRange(position: Point, range: number): DeadBody[] {
    return Array.from(this.bodies.values()).filter(
      body => distance(position, body.position) <= range
    );
  }
  
  /**
   * Get impostor kill state
   */
  getImpostorState(impostorId: string): ImpostorKillState | undefined {
    return this.impostorStates.get(impostorId);
  }
  
  /**
   * Get cooldown remaining for an impostor
   */
  getCooldownRemaining(impostorId: string): number {
    return this.impostorStates.get(impostorId)?.killCooldownRemaining ?? 0;
  }
  
  /**
   * Check if an impostor is in kill animation
   */
  isInKillAnimation(impostorId: string): boolean {
    return this.impostorStates.get(impostorId)?.isInKillAnimation ?? false;
  }
  
  /**
   * Get kill count for an impostor
   */
  getKillCount(impostorId: string): number {
    return this.impostorStates.get(impostorId)?.killCount ?? 0;
  }
  
  /**
   * Get all kill events
   */
  getKillEvents(): KillEvent[] {
    return [...this.killEvents];
  }
  
  /**
   * Get recent kill events (for UI/debugging)
   */
  getRecentKillEvents(count: number = 5): KillEvent[] {
    return this.killEvents.slice(-count);
  }
  
  /**
   * Get kill range in game units
   */
  getKillRange(): number {
    return this.killRange;
  }
  
  /**
   * Get config
   */
  getConfig(): KillSystemConfig {
    return { ...this.config };
  }
}
