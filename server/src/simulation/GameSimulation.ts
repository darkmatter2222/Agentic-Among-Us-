import { AIAgentManager } from '@shared/engine/AIAgentManager.ts';
import { serializeWorld, type SerializeWorldOptions } from '@shared/engine/serialization.ts';
import { WALKABLE_ZONES, LABELED_ZONES, TASKS, VENTS } from '@shared/data/poly3-map.ts';
import type { WorldSnapshot, ThoughtEvent, SpeechEvent, HeardSpeechEvent, AIContext, GameTimerSnapshot, GamePhase, BodyReportEvent } from '@shared/types/simulation.types.ts';
import { AIDecisionService } from '../ai/AIDecisionService.js';
import type { KillEvent } from '@shared/engine/KillSystem.ts';
import type { VentEvent } from '@shared/engine/VentSystem.ts';
import { simulationLogger, aiLogger, systemLogger } from '../logging/index.js';

export interface SimulationOptions {
  numAgents?: number;
  numImpostors?: number;
  tasksPerAgent?: number;
  aiServerUrl?: string;
  enableAI?: boolean;
  gameDurationMs?: number; // Game duration in ms (default 10 minutes)
}

const DEFAULT_OPTIONS: Required<SimulationOptions> = {
  numAgents: 8,
  numImpostors: 2,
  tasksPerAgent: 5,
  aiServerUrl: 'http://192.168.86.48:8080',
  enableAI: true,
  gameDurationMs: 10 * 60 * 1000, // 10 minutes
};

export class GameSimulation {
  private manager: AIAgentManager;
  private aiService: AIDecisionService | null;
  private lastTimestamp: number;
  private tick: number;
  private gamePhase: GamePhase;
  private recentThoughts: ThoughtEvent[];
  private recentSpeech: SpeechEvent[];
  private recentHeard: HeardSpeechEvent[];
  private recentKills: KillEvent[];
  private recentVentEvents: VentEvent[];
  
  // Body discovery tracking
  private firstBodyDiscovered: boolean;
  private recentBodyReport: BodyReportEvent | null;
  
  // Game timer
  private readonly gameDurationMs: number;
  private gameStartTime: number;
  private readonly options: Required<SimulationOptions>;

  constructor(options: SimulationOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    this.manager = new AIAgentManager({
      walkableZones: WALKABLE_ZONES,
      labeledZones: LABELED_ZONES,
      tasks: TASKS,
      vents: VENTS,
      numAgents: this.options.numAgents,
      numImpostors: this.options.numImpostors,
      tasksPerAgent: this.options.tasksPerAgent,
    });

    // Initialize AI service if enabled
    if (this.options.enableAI) {
      this.aiService = new AIDecisionService(this.options.aiServerUrl);
      this.setupAICallbacks();
      aiLogger.info('AI Decision Service initialized', { serverUrl: this.options.aiServerUrl });
    } else {
      this.aiService = null;
      aiLogger.info('AI Decision Service disabled, using fallback behavior');
    }

    this.lastTimestamp = Date.now();
    this.tick = 0;
    this.gamePhase = 'WORKING';
    this.firstBodyDiscovered = false;
    this.recentBodyReport = null;
    this.recentThoughts = [];
    this.recentSpeech = [];
    this.recentHeard = [];
    this.recentKills = [];
    this.recentVentEvents = [];

    // Initialize game timer
    this.gameDurationMs = this.options.gameDurationMs;
    this.gameStartTime = Date.now();

    // Log game setup
    this.logGameStart();
  }  private logGameStart(): void {
    const durationMinutes = Math.floor(this.gameDurationMs / 60000);
    simulationLogger.info('NEW GAME STARTED', {
      durationMinutes,
      numAgents: this.options.numAgents,
      impostors: this.manager.getImpostorIds(),
    });
  }

  /**
   * Set up AI callbacks for agent decision making
   */
  private setupAICallbacks(): void {
    if (!this.aiService) return;

    // Initialize AI state for each agent
    for (const agent of this.manager.getAgents()) {
      this.aiService.initializeAgent(agent.getId());
    }

    // Set up callback for heard speech events (for visual feedback)
    this.manager.setHeardSpeechCallback((event) => {
      this.addHeardEvent(event);
    });

    // Set up callback for body reports - delegates to this.reportBody()
    this.manager.setReportBodyCallback((reporterId) => {
      const result = this.reportBody(reporterId);
      return result !== null;
    });

    // Set up callbacks
    this.manager.setAICallbacks(
      // Decision callback - called when agent needs to make a decision
      async (context: AIContext) => {
        // Add game timer context
        const timerContext = this.getTimerContextForAgent();
        const enrichedContext: AIContext = {
          ...context,
          gameTimer: timerContext,
          gamePhase: this.gamePhase,
          firstBodyDiscovered: this.firstBodyDiscovered,
        };
        return this.aiService!.getAgentDecision(enrichedContext);
      },
      // Trigger callback - called to check for thought/speech triggers
      async (context: AIContext) => {
        // Add game timer context
        const timerContext = this.getTimerContextForAgent();
        const enrichedContext: AIContext = {
          ...context,
          gameTimer: timerContext,
          gamePhase: this.gamePhase,
          firstBodyDiscovered: this.firstBodyDiscovered,
        };
        const result = await this.aiService!.processAgentTriggers(enrichedContext);
        return {
          thought: result.thought ? {
            thought: result.thought.thought,
            trigger: result.thought.trigger 
          } : undefined,
          speech: result.speech ? {
            message: result.speech.message
          } : undefined,
          forceDecision: result.decision,  // Pass forced decision (e.g., REPORT_BODY)
        };
      }
    );
  }
  
  /**
   * Get timer context for agents
   */
  private getTimerContextForAgent(): { remainingMs: number; elapsedMs: number; timeSinceLastDecisionMs: number } {
    const now = Date.now();
    const elapsedMs = now - this.gameStartTime;
    const remainingMs = Math.max(0, this.gameDurationMs - elapsedMs);
    
    return {
      remainingMs,
      elapsedMs,
      timeSinceLastDecisionMs: 0, // Will be tracked per-agent in AIDecisionService
    };
  }
  
  /**
   * Get current game timer state for UI
   */
  getGameTimer(): GameTimerSnapshot {
    const now = Date.now();
    const elapsedMs = now - this.gameStartTime;
    const remainingMs = Math.max(0, this.gameDurationMs - elapsedMs);
    
    return {
      durationMs: this.gameDurationMs,
      elapsedMs,
      remainingMs,
      startedAt: this.gameStartTime,
    };
  }
  
  /**
   * Check if the game timer has expired
   */
  isTimerExpired(): boolean {
    return Date.now() - this.gameStartTime >= this.gameDurationMs;
  }
  
  /**
   * Restart the game with new agents and impostors
   */
  restart(): void {
    simulationLogger.info('GAME TIMER EXPIRED - RESTARTING GAME');
    
    // Create fresh manager with new impostor selection
    this.manager = new AIAgentManager({
      walkableZones: WALKABLE_ZONES,
      labeledZones: LABELED_ZONES,
      tasks: TASKS,
      vents: VENTS,
      numAgents: this.options.numAgents,
      numImpostors: this.options.numImpostors,
      tasksPerAgent: this.options.tasksPerAgent,
    });
    
    // Reset AI service if enabled
    if (this.options.enableAI && this.aiService) {
      // Re-initialize AI state for each agent
      for (const agent of this.manager.getAgents()) {
        this.aiService.initializeAgent(agent.getId());
      }
      this.setupAICallbacks();
    }

    // Reset game state
    this.lastTimestamp = Date.now();
    this.tick = 0;
    this.gamePhase = 'WORKING';
    this.firstBodyDiscovered = false;
    this.recentBodyReport = null;
    this.recentThoughts = [];
    this.recentSpeech = [];
    this.recentHeard = [];
    this.recentKills = [];
    this.recentVentEvents = [];

    // Reset timer
    this.gameStartTime = Date.now();

    this.logGameStart();
  }  step(timestamp = Date.now()): WorldSnapshot {
    // Check if game should restart
    if (this.isTimerExpired()) {
      this.restart();
    }
    
    const deltaSeconds = Math.max(0, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;

    if (deltaSeconds > 0) {
      this.manager.update(deltaSeconds);
      
      // Update sabotage system (timers, fix progress, etc.)
      this.manager.updateSabotage(deltaSeconds);
      
      // Update AI service with current agent positions for trace capture
      if (this.aiService) {
        const agents = this.manager.getAgents();
        const positions = agents.map(a => ({
          id: a.getId(),
          name: a.getName(),
          color: a.getColor(),
          position: a.getPosition(),
          zone: a.getCurrentZone(),
          activityState: a.getStateMachine().getActivityState() as string,
          currentGoal: a.getCurrentGoal(),
          role: a.getRole() as 'CREWMATE' | 'IMPOSTOR',
          state: a.getPlayerState() as 'ALIVE' | 'DEAD',
        }));
        this.aiService.updateAgentPositions(positions);
      }
    }

    // Collect AI events
    if (this.aiService) {
      const newThoughts = this.aiService.flushPendingThoughts();
      const newSpeech = this.aiService.flushPendingSpeech();
      
      // Keep recent events (last 20)
      this.recentThoughts = [...this.recentThoughts, ...newThoughts].slice(-20);
      this.recentSpeech = [...this.recentSpeech, ...newSpeech].slice(-20);
    }

    this.tick += 1;
    
    // Build kill status map for impostors
    const killStatusMap = new Map<string, { cooldownRemaining: number; canKill: boolean; hasTargetInRange: boolean; killCount: number }>();
    for (const agent of this.manager.getAgents()) {
      if (agent.getRole() === 'IMPOSTOR') {
        const status = this.manager.getKillStatus(agent.getId());
        if (status) {
          killStatusMap.set(agent.getId(), status);
        }
      }
    }
    
    const options: SerializeWorldOptions = {
      gamePhase: this.gamePhase,
      firstBodyDiscovered: this.firstBodyDiscovered,
      recentBodyReport: this.recentBodyReport ?? undefined,
      taskProgress: this.manager.getTaskProgress(),
      recentThoughts: this.recentThoughts,
      recentSpeech: this.recentSpeech,
      recentHeard: this.recentHeard,
      llmQueueStats: this.aiService?.getQueueStats(),
      bodies: this.manager.getBodies(),
      recentKills: this.recentKills,
      recentVentEvents: this.recentVentEvents,
      gameTimer: this.getGameTimer(),
      killStatusMap,
      sabotageState: this.buildSabotageSnapshot(),
    };
    
    // Clear the body report after one tick (it's only for UI animation trigger)
    this.recentBodyReport = null;
    
    // Clear old kills (keep only last 10)
    if (this.recentKills.length > 10) {
      this.recentKills = this.recentKills.slice(-10);
    }

    // Clear old vent events (keep only last 10)
    if (this.recentVentEvents.length > 10) {
      this.recentVentEvents = this.recentVentEvents.slice(-10);
    }

    // Clear old heard events (keep only last 20)
    if (this.recentHeard.length > 20) {
      this.recentHeard = this.recentHeard.slice(-20);
    }

    return serializeWorld(this.manager.getAgents(), this.tick, timestamp, options);
  }

  /**
   * Add a heard speech event (called when an agent hears another agent speak)
   */
  addHeardEvent(event: HeardSpeechEvent): void {
    this.recentHeard.push(event);
  }

  getAgentManager(): AIAgentManager {
    return this.manager;
  }
  
  getAIService(): AIDecisionService | null {
    return this.aiService;
  }
  
  getGamePhase(): string {
    return this.gamePhase;
  }
  
  getTaskProgress(): number {
    return this.manager.getTaskProgress();
  }
  
  /**
   * Attempt a kill from an impostor
   * @returns The kill event if successful, null if failed
   */
  attemptKill(impostorId: string, targetId: string): KillEvent | null {
    const killEvent = this.manager.attemptKill(impostorId, targetId);
    if (killEvent) {
      this.recentKills.push(killEvent);
    }
    return killEvent;
  }

  /**
   * Report a body - transitions game to ALERT phase if first discovery
   * Removes ALL bodies from the map and broadcasts to all agents
   * @returns The body report event if successful, null if failed
   */
  reportBody(reporterId: string): BodyReportEvent | null {
    simulationLogger.info('GameSimulation.reportBody called', { reporterId });

    const reporter = this.manager.getAgent(reporterId);
    if (!reporter) {
      simulationLogger.warn('Body report failed: Invalid reporter', { reporterId });
      return null;
    }

    // Get all unreported bodies
    const bodies = this.manager.getBodies();
    simulationLogger.info('Bodies found for report', { reporterId, bodyCount: bodies.length, bodyIds: bodies.map(b => b.id) });

    if (bodies.length === 0) {
      simulationLogger.warn('Body report failed: No bodies to report', { reporterId });
      return null;
    }

    const isFirstDiscovery = !this.firstBodyDiscovered;
    
    // Create the body report event with ALL bodies
    const reportEvent: BodyReportEvent = {
      reporterId: reporter.getId(),
      reporterName: reporter.getName(),
      bodies: bodies.map(body => ({
        victimId: body.victimId,
        victimName: body.victimName,
        victimColor: body.victimColor,
        location: body.zone,
      })),
      timestamp: Date.now(),
      isFirstDiscovery,
    };

    // Transition to ALERT phase if this is the first body discovered
    if (isFirstDiscovery) {
      this.firstBodyDiscovered = true;
      this.gamePhase = 'ALERT';
      simulationLogger.info('FIRST BODY DISCOVERED - GAME PHASE TRANSITION', {
        reporter: reporter.getName(),
        phase: 'WORKING -> ALERT',
        bodiesFound: bodies.length,
      });
    } else {
      simulationLogger.info('Body reported', {
        reporter: reporter.getName(),
        bodiesFound: bodies.length,
      });
    }

    // Broadcast the report to all agents' memories
    this.broadcastBodyReport(reportEvent);

    // Remove all bodies from the map
    simulationLogger.info('Clearing all bodies from map after report', { bodyCount: bodies.length });
    this.manager.clearAllBodies();

    // Verify bodies are cleared
    const remainingBodies = this.manager.getBodies();
    simulationLogger.info('Bodies remaining after clear', { remainingCount: remainingBodies.length });

    // Store for next tick's snapshot
    this.recentBodyReport = reportEvent;

    simulationLogger.info('Body report completed successfully', { 
      reporterId, 
      reporterName: reporter.getName(),
      bodiesReported: bodies.length 
    });

    return reportEvent;
  }

  /**
   * Broadcast body report to all agents' memories
   */
  private broadcastBodyReport(event: BodyReportEvent): void {
    const bodyNames = event.bodies.map(b => b.victimName).join(', ');
    const message = event.isFirstDiscovery
      ? `EMERGENCY! ${event.reporterName} found dead: ${bodyNames}. There is a killer among us!`
      : `${event.reporterName} reported: ${bodyNames} found dead.`;

    for (const agent of this.manager.getAgents()) {
      // Record in agent's memory
      agent.getMemory().recordObservation({
        type: 'body_reported',
        details: message,
        timestamp: event.timestamp,
        importance: event.isFirstDiscovery ? 100 : 80, // Very important memory
      });
    }

    simulationLogger.debug('Body report broadcast to all agents', { 
      agentCount: this.manager.getAgents().length,
      message 
    });
  }

  /**
   * Get current game phase
   */
  getGamePhase(): GamePhase {
    return this.gamePhase;
  }

  /**
   * Check if first body has been discovered
   */
  isFirstBodyDiscovered(): boolean {
    return this.firstBodyDiscovered;
  }
  
  /**
   * Check if an impostor can kill a specific target
   */
  canKill(impostorId: string, targetId: string): boolean {
    return this.manager.canKill(impostorId, targetId);
  }
  
  /**
   * Get targets in kill range for an impostor
   */
  getTargetsInRange(impostorId: string): string[] {
    return this.manager.getTargetsInRange(impostorId);
  }
  
  /**
   * Get kill cooldown remaining for an impostor
   */
  getKillCooldown(impostorId: string): number {
    return this.manager.getKillCooldown(impostorId);
  }

  // ==================== VENT SYSTEM METHODS ====================

  /**
   * Attempt to enter a vent (impostor only)
   */
  attemptEnterVent(impostorId: string, ventId: string): VentEvent | null {
    const ventEvent = this.manager.attemptEnterVent(impostorId, ventId);
    if (ventEvent) {
      this.recentVentEvents.push(ventEvent);
    }
    return ventEvent;
  }

  /**
   * Attempt to exit a vent (impostor only)
   */
  attemptExitVent(impostorId: string): VentEvent | null {
    const ventEvent = this.manager.attemptExitVent(impostorId);
    if (ventEvent) {
      this.recentVentEvents.push(ventEvent);
    }
    return ventEvent;
  }

  /**
   * Attempt to travel between connected vents (impostor only)
   */
  attemptVentTravel(impostorId: string, targetVentId: string): VentEvent | null {
    const ventEvent = this.manager.attemptVentTravel(impostorId, targetVentId);
    if (ventEvent) {
      this.recentVentEvents.push(ventEvent);
    }
    return ventEvent;
  }

  /**
   * Get vent context for AI decision making
   */
  getVentContext(impostorId: string) {
    return this.manager.getVentContext(impostorId);
  }

  /**
   * Get recent vent events
   */
  getRecentVentEvents(): VentEvent[] {
    return this.recentVentEvents;
  }

  /**
   * Get players currently in vents
   */
  getPlayersInVents(): string[] {
    return this.manager.getPlayersInVents();
  }

  // ==================== SABOTAGE SYSTEM METHODS ====================

  /**
   * Build sabotage snapshot for world state broadcast
   */
  private buildSabotageSnapshot(): import('@shared/types/simulation.types.ts').SabotageSnapshot {
    const context = this.manager.getSabotageContext();
    
    return {
      activeSabotage: context.activeSabotage ? {
        type: context.activeSabotage.type,
        timeRemaining: context.activeSabotage.timeRemaining,
        fixProgress: context.activeSabotage.fixProgress,
        fixLocations: context.activeSabotage.fixLocations,
      } : undefined,
      lightsOn: context.lightsOn,
      commsActive: context.commsActive,
    };
  }
}
