/**
 * Sabotage System
 * Manages impostor sabotage abilities including Lights, Reactor, O2, and Communications
 */

import { sabotageLog } from '../logging/index.ts';

export type SabotageType = 'LIGHTS' | 'REACTOR' | 'O2' | 'COMMS';

export interface SabotageConfig {
  /** How long until the sabotage auto-resolves (or causes loss for REACTOR/O2) */
  duration: number;
  /** Cooldown between sabotages */
  cooldown: number;
  /** Number of players required to fix (1 for lights/comms, 2 for reactor/O2) */
  playersToFix: number;
  /** Location(s) where the sabotage can be fixed */
  fixLocations: string[];
}

export interface ActiveSabotage {
  type: SabotageType;
  startTime: number;
  remainingTime: number;
  fixProgress: number; // 0-100
  playersFixing: Set<string>;
}

export interface SabotageEvent {
  type: 'SABOTAGE';
  sabotageType: SabotageType;
  action: 'START' | 'FIX' | 'FAIL';
  timestamp: number;
  saboteurId?: string;
  fixerId?: string;
}

const DEFAULT_CONFIGS: Record<SabotageType, SabotageConfig> = {
  LIGHTS: {
    duration: 45000, // 45 seconds until auto-resolve (or stays until fixed)
    cooldown: 30000, // 30 second cooldown
    playersToFix: 1,
    fixLocations: ['Electrical'],
  },
  REACTOR: {
    duration: 30000, // 30 seconds until meltdown
    cooldown: 30000,
    playersToFix: 2, // Requires 2 players at once
    fixLocations: ['Reactor'], // Both panels in Reactor
  },
  O2: {
    duration: 30000, // 30 seconds until suffocation
    cooldown: 30000,
    playersToFix: 1, // Can be fixed at either location
    fixLocations: ['O2', 'Admin'], // Two separate locations
  },
  COMMS: {
    duration: 60000, // Can stay sabotaged until fixed
    cooldown: 30000,
    playersToFix: 1,
    fixLocations: ['Communications'],
  },
};

export class SabotageSystem {
  private configs: Record<SabotageType, SabotageConfig>;
  private activeSabotage: ActiveSabotage | null = null;
  private lastSabotageTime: number = 0;
  
  // State tracking for UI
  private lightsOn: boolean = true;
  private commsActive: boolean = true;
  private globalCooldown: number = 10000; // 10 seconds at game start

  // Callbacks for game state changes
  private lightsChangedCallback: ((lightsOn: boolean) => void) | null = null;
  private commsDisabledCallback: ((disabled: boolean) => void) | null = null;
  private criticalSabotageCallback: ((type: SabotageType, remainingMs: number) => void) | null = null;
  private sabotageFailedCallback: ((type: SabotageType) => void) | null = null;

  constructor(configs?: Partial<Record<SabotageType, Partial<SabotageConfig>>>) {
    // Merge custom configs with defaults
    this.configs = { ...DEFAULT_CONFIGS };
    if (configs) {
      for (const [type, config] of Object.entries(configs) as [SabotageType, Partial<SabotageConfig>][]) {
        this.configs[type] = { ...DEFAULT_CONFIGS[type], ...config };
      }
    }

    sabotageLog.get().info('SabotageSystem initialized', { configs: this.configs });
  }

  // ========== Callbacks ==========

  setLightsChangedCallback(callback: (lightsOn: boolean) => void): void {
    this.lightsChangedCallback = callback;
  }

  setCommsDisabledCallback(callback: (disabled: boolean) => void): void {
    this.commsDisabledCallback = callback;
  }

  setCriticalSabotageCallback(callback: (type: SabotageType, remainingMs: number) => void): void {
    this.criticalSabotageCallback = callback;
  }

  setSabotageFailedCallback(callback: (type: SabotageType) => void): void {
    this.sabotageFailedCallback = callback;
  }

  // ========== Sabotage Actions ==========

  /**
   * Attempt to start a sabotage
   */
  startSabotage(saboteurId: string, type: SabotageType, currentTime: number = Date.now()): SabotageEvent | null {
    // Check if there's already an active sabotage
    if (this.activeSabotage) {
      sabotageLog.get().debug('Cannot sabotage - another sabotage is active', { 
        activeType: this.activeSabotage.type, 
        requestedType: type 
      });
      return null;
    }

    // Check cooldown
    const timeSinceLastSabotage = currentTime - this.lastSabotageTime;
    if (timeSinceLastSabotage < this.globalCooldown) {
      sabotageLog.get().debug('Cannot sabotage - on cooldown', { 
        cooldownRemaining: this.globalCooldown - timeSinceLastSabotage 
      });
      return null;
    }

    // Start the sabotage
    this.activeSabotage = {
      type,
      startTime: currentTime,
      remainingTime: this.configs[type].duration,
      fixProgress: 0,
      playersFixing: new Set(),
    };
    this.lastSabotageTime = currentTime;

    // Trigger effects
    if (type === 'LIGHTS') {
      this.lightsChangedCallback?.(false);
      this.lightsOn = false;
    } else if (type === 'COMMS') {
      this.commsDisabledCallback?.(true);
      this.commsActive = false;
    }

    sabotageLog.get().info('Sabotage started', { type, saboteurId });

    return {
      type: 'SABOTAGE',
      sabotageType: type,
      action: 'START',
      timestamp: currentTime,
      saboteurId,
    };
  }

  /**
   * Update sabotage state (call every tick)
   */
  update(deltaMs: number, currentTime: number = Date.now()): SabotageEvent | null {
    if (!this.activeSabotage) return null;

    this.activeSabotage.remainingTime -= deltaMs;

    // Check for critical sabotage countdown
    if (this.activeSabotage.type === 'REACTOR' || this.activeSabotage.type === 'O2') {
      this.criticalSabotageCallback?.(this.activeSabotage.type, this.activeSabotage.remainingTime);

      // Check for failure (time ran out)
      if (this.activeSabotage.remainingTime <= 0) {
        const failedType = this.activeSabotage.type;
        this.activeSabotage = null;
        this.sabotageFailedCallback?.(failedType);

        sabotageLog.get().warn('Critical sabotage failed!', { type: failedType });

        return {
          type: 'SABOTAGE',
          sabotageType: failedType,
          action: 'FAIL',
          timestamp: currentTime,
        };
      }
    } else if (this.activeSabotage.type === 'LIGHTS') {
      // Lights sabotage doesn't auto-resolve but also doesn't cause game loss
      // It just stays until fixed
    }

    return null;
  }

  /**
   * Attempt to fix the active sabotage
   * @returns The fix progress (0-100) or null if not at fix location
   */
  attemptFix(playerId: string, playerZone: string | null, currentTime: number = Date.now()): number | null {
    if (!this.activeSabotage || !playerZone) return null;

    const config = this.configs[this.activeSabotage.type];
    
    // Check if player is at a valid fix location
    if (!config.fixLocations.some(loc => playerZone.toLowerCase().includes(loc.toLowerCase()))) {
      return null;
    }

    // Add player to fixing set
    this.activeSabotage.playersFixing.add(playerId);

    // Check if enough players are fixing
    if (this.activeSabotage.playersFixing.size >= config.playersToFix) {
      // Progress the fix (10% per tick when conditions are met)
      this.activeSabotage.fixProgress += 10;
    }

    return this.activeSabotage.fixProgress;
  }

  /**
   * Player stopped fixing (left the area or stopped interacting)
   */
  stopFixing(playerId: string): void {
    if (this.activeSabotage) {
      this.activeSabotage.playersFixing.delete(playerId);
    }
  }

  /**
   * Complete the fix for a sabotage
   */
  completeFix(fixerId: string, currentTime: number = Date.now()): SabotageEvent | null {
    if (!this.activeSabotage) return null;

    const fixedType = this.activeSabotage.type;

    // Restore effects
    if (fixedType === 'LIGHTS') {
      this.lightsChangedCallback?.(true);
      this.lightsOn = true;
    } else if (fixedType === 'COMMS') {
      this.commsDisabledCallback?.(false);
      this.commsActive = true;
    }

    this.activeSabotage = null;

    sabotageLog.get().info('Sabotage fixed', { type: fixedType, fixerId });

    return {
      type: 'SABOTAGE',
      sabotageType: fixedType,
      action: 'FIX',
      timestamp: currentTime,
      fixerId,
    };
  }

  // ========== Queries ==========

  /**
   * Get the currently active sabotage
   */
  getActiveSabotage(): ActiveSabotage | null {
    return this.activeSabotage;
  }

  /**
   * Check if a specific sabotage type is active
   */
  isSabotageActive(type?: SabotageType): boolean {
    if (!this.activeSabotage) return false;
    if (type) return this.activeSabotage.type === type;
    return true;
  }

  /**
   * Check if lights are sabotaged
   */
  areLightsSabotaged(): boolean {
    return this.activeSabotage?.type === 'LIGHTS';
  }

  /**
   * Check if comms are sabotaged
   */
  areCommsSabotaged(): boolean {
    return this.activeSabotage?.type === 'COMMS';
  }

  /**
   * Get remaining time for active sabotage
   */
  getSabotageTimeRemaining(): number | null {
    return this.activeSabotage?.remainingTime ?? null;
  }

  /**
   * Get global sabotage cooldown remaining
   */
  getCooldownRemaining(currentTime: number = Date.now()): number {
    if (this.activeSabotage) return Infinity; // Can't sabotage during another sabotage
    const elapsed = currentTime - this.lastSabotageTime;
    return Math.max(0, this.globalCooldown - elapsed);
  }

  /**
   * Check if sabotage is available
   */
  canSabotage(currentTime: number = Date.now()): boolean {
    return !this.activeSabotage && this.getCooldownRemaining(currentTime) <= 0;
  }

  /**
   * Get sabotage context for AI decisions
   */
  getSabotageContext(currentTime: number = Date.now()): {
    activeSabotage: { 
      type: SabotageType; 
      remainingTime: number;
      timeRemaining: number;
      fixProgress: number;
    } | null;
    cooldownRemaining: number;
    canSabotage: boolean;
    availableSabotages: SabotageType[];
    lightsOn: boolean;
    commsActive: boolean;
  } {
    return {
      activeSabotage: this.activeSabotage ? {
        type: this.activeSabotage.type,
        remainingTime: this.activeSabotage.remainingTime,
        timeRemaining: this.activeSabotage.remainingTime,
        fixProgress: this.activeSabotage.fixProgress,
      } : null,
      cooldownRemaining: this.getCooldownRemaining(currentTime),
      canSabotage: this.canSabotage(currentTime),
      availableSabotages: this.canSabotage(currentTime)
        ? ['LIGHTS', 'REACTOR', 'O2', 'COMMS'] as SabotageType[]
        : [],
      lightsOn: this.lightsOn,
      commsActive: this.commsActive,
    };
  }
}