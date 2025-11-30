/**
 * Ghost System - Manages ghost state and ghost-specific mechanics
 *
 * Official Among Us Ghost Mechanics:
 * - Movement: Same speed as alive, pass through walls
 * - Vision: Unlimited range, see everything
 * - Tasks: Can complete remaining tasks (counts toward victory)
 * - Sabotage: Cannot trigger or fix
 * - Communication: Can only chat with other ghosts
 * - Visibility: Partially transparent to other ghosts only (living players can't see)
 *
 * Implementation Notes:
 * - DEAD state = body on ground, not yet transitioned
 * - GHOST state = floating spirit, can continue tasks
 * - Transition happens after body is reported OR after a timeout
 */

import type { PlayerState } from '../types/game.types.ts';
import { aiLog } from '../logging/index.ts';

// ========== Configuration ==========

export interface GhostSystemConfig {
  /** Time in seconds before a dead player automatically becomes a ghost (if body not reported) */
  autoGhostDelay: number;
  /** Vision radius multiplier for ghosts (applied to base vision) - very large for "unlimited" */
  ghostVisionMultiplier: number;
  /** Whether ghosts can complete tasks */
  ghostsCanCompleteTasks: boolean;
  /** Whether ghosts can hear living players */
  ghostsCanHearLiving: boolean;
  /** Whether living players can see ghosts (normally false) */
  livingCanSeeGhosts: boolean;
}

export const DEFAULT_GHOST_CONFIG: GhostSystemConfig = {
  autoGhostDelay: 30, // 30 seconds before auto-ghosting
  ghostVisionMultiplier: 10, // Effectively unlimited vision
  ghostsCanCompleteTasks: true,
  ghostsCanHearLiving: true, // Ghosts can hear living players
  livingCanSeeGhosts: false, // Living players cannot see ghosts
};

// ========== Types ==========

export interface GhostState {
  agentId: string;
  diedAt: number;
  becameGhostAt: number | null;
  tasksCompleted: number; // Tasks completed while ghost
  lastPosition: { x: number; y: number };
  killedBy: string | null; // ID of killer (if known)
}

export interface GhostEvent {
  type: 'BECAME_GHOST' | 'GHOST_TASK_COMPLETED' | 'GHOST_SPOKE';
  agentId: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

// ========== Main Ghost System Class ==========

export class GhostSystem {
  private config: GhostSystemConfig;
  private ghostStates: Map<string, GhostState>;
  private ghostEvents: GhostEvent[];
  private pendingGhostTransitions: Map<string, { diedAt: number; killedBy: string | null }>;

  // Callbacks for integration
  private onBecomeGhost: ((agentId: string) => void) | null = null;

  constructor(config: Partial<GhostSystemConfig> = {}) {
    this.config = { ...DEFAULT_GHOST_CONFIG, ...config };
    this.ghostStates = new Map();
    this.ghostEvents = [];
    this.pendingGhostTransitions = new Map();
  }

  /**
   * Set callback for when an agent becomes a ghost
   */
  setOnBecomeGhostCallback(callback: (agentId: string) => void): void {
    this.onBecomeGhost = callback;
  }

  /**
   * Register a death - agent becomes a pending ghost
   * The agent stays DEAD until body is reported or timeout
   */
  registerDeath(agentId: string, killedBy: string | null = null): void {
    const now = Date.now();
    this.pendingGhostTransitions.set(agentId, {
      diedAt: now,
      killedBy,
    });

    aiLog.get().info('Death registered, pending ghost transition', {
      agentId,
      killedBy,
      autoGhostIn: `${this.config.autoGhostDelay}s`,
    });
  }

  /**
   * Force immediate ghost transition (called when body is reported)
   */
  transitionToGhost(agentId: string): void {
    const pending = this.pendingGhostTransitions.get(agentId);
    if (!pending) {
      // Not a pending death - might be a direct ghost transition
      aiLog.get().warn('Ghost transition for non-pending death', { agentId });
      return;
    }

    this.pendingGhostTransitions.delete(agentId);

    const now = Date.now();
    const ghostState: GhostState = {
      agentId,
      diedAt: pending.diedAt,
      becameGhostAt: now,
      tasksCompleted: 0,
      lastPosition: { x: 0, y: 0 },
      killedBy: pending.killedBy,
    };

    this.ghostStates.set(agentId, ghostState);

    // Record event
    this.ghostEvents.push({
      type: 'BECAME_GHOST',
      agentId,
      timestamp: now,
      details: { diedAt: pending.diedAt, killedBy: pending.killedBy },
    });

    // Notify via callback
    this.onBecomeGhost?.(agentId);

    aiLog.get().info('Agent became ghost', { agentId });
  }

  /**
   * Transition all pending ghosts (called when body is reported, all bodies are cleared)
   */
  transitionAllPendingToGhosts(): void {
    const pendingIds = Array.from(this.pendingGhostTransitions.keys());
    for (const agentId of pendingIds) {
      this.transitionToGhost(agentId);
    }
  }

  /**
   * Update - check for auto-ghost transitions
   */
  update(deltaSeconds: number): void {
    const now = Date.now();

    // Check for agents that should auto-ghost
    for (const [agentId, pending] of this.pendingGhostTransitions) {
      const timeSinceDeath = (now - pending.diedAt) / 1000; // seconds

      if (timeSinceDeath >= this.config.autoGhostDelay) {
        aiLog.get().debug('Auto-ghosting agent after timeout', {
          agentId,
          timeSinceDeath: `${timeSinceDeath.toFixed(1)}s`,
        });
        this.transitionToGhost(agentId);
      }
    }
  }

  /**
   * Check if an agent is a ghost
   */
  isGhost(agentId: string): boolean {
    return this.ghostStates.has(agentId);
  }

  /**
   * Check if an agent is pending ghost transition (dead but not yet ghost)
   */
  isPendingGhost(agentId: string): boolean {
    return this.pendingGhostTransitions.has(agentId);
  }

  /**
   * Get ghost state for an agent
   */
  getGhostState(agentId: string): GhostState | undefined {
    return this.ghostStates.get(agentId);
  }

  /**
   * Record a task completed by a ghost
   */
  recordGhostTaskCompletion(agentId: string): void {
    const state = this.ghostStates.get(agentId);
    if (!state) return;

    state.tasksCompleted++;

    this.ghostEvents.push({
      type: 'GHOST_TASK_COMPLETED',
      agentId,
      timestamp: Date.now(),
    });
  }

  /**
   * Get vision multiplier for an agent (ghosts get massive vision)
   */
  getVisionMultiplier(agentId: string): number {
    if (this.isGhost(agentId)) {
      return this.config.ghostVisionMultiplier;
    }
    return 1.0;
  }

  /**
   * Check if source agent can see target agent
   * Living players can see living players
   * Ghosts can see everyone
   * Living players cannot see ghosts (unless config says otherwise)
   */
  canSee(sourceId: string, sourceState: PlayerState, targetId: string, targetState: PlayerState): boolean {
    // Same agent
    if (sourceId === targetId) return false;

    // Ghosts can see everyone
    if (sourceState === 'GHOST') {
      return true;
    }

    // Living players cannot see ghosts
    if (targetState === 'GHOST' && !this.config.livingCanSeeGhosts) {
      return false;
    }

    // Dead bodies are always visible to living players
    if (targetState === 'DEAD') {
      return true;
    }

    // Living can see living
    return true;
  }

  /**
   * Check if source agent can hear target agent
   * Ghosts can only talk to ghosts
   * Living can only hear living
   */
  canHear(sourceId: string, sourceState: PlayerState, targetId: string, targetState: PlayerState): boolean {
    // Same agent
    if (sourceId === targetId) return false;

    // Ghost hearing ghost
    if (sourceState === 'GHOST' && targetState === 'GHOST') {
      return true;
    }

    // Ghost hearing living (if configured)
    if (sourceState === 'GHOST' && targetState === 'ALIVE') {
      return this.config.ghostsCanHearLiving;
    }

    // Living cannot hear ghosts
    if (sourceState === 'ALIVE' && targetState === 'GHOST') {
      return false;
    }

    // Living hearing living
    if (sourceState === 'ALIVE' && targetState === 'ALIVE') {
      return true;
    }

    return false;
  }

  /**
   * Check if a ghost can complete tasks
   */
  canCompleteTasks(): boolean {
    return this.config.ghostsCanCompleteTasks;
  }

  /**
   * Check if a ghost should have collision disabled
   * (Ghosts pass through walls)
   */
  shouldDisableCollision(agentId: string): boolean {
    return this.isGhost(agentId);
  }

  /**
   * Get all ghost IDs
   */
  getAllGhostIds(): string[] {
    return Array.from(this.ghostStates.keys());
  }

  /**
   * Get total tasks completed by all ghosts
   */
  getTotalGhostTasksCompleted(): number {
    let total = 0;
    for (const state of this.ghostStates.values()) {
      total += state.tasksCompleted;
    }
    return total;
  }

  /**
   * Get config
   */
  getConfig(): GhostSystemConfig {
    return { ...this.config };
  }

  /**
   * Get recent ghost events
   */
  getRecentEvents(count: number = 10): GhostEvent[] {
    return this.ghostEvents.slice(-count);
  }

  /**
   * Reset the system (for new game)
   */
  reset(): void {
    this.ghostStates.clear();
    this.ghostEvents = [];
    this.pendingGhostTransitions.clear();
  }
}
