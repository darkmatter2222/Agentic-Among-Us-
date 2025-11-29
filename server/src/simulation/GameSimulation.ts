import { AIAgentManager } from '@shared/engine/AIAgentManager.ts';
import { serializeWorld, type SerializeWorldOptions } from '@shared/engine/serialization.ts';
import { WALKABLE_ZONES, LABELED_ZONES, TASKS } from '@shared/data/poly3-map.ts';
import type { WorldSnapshot, ThoughtEvent, SpeechEvent, AIContext, GameTimerSnapshot } from '@shared/types/simulation.types.ts';
import { AIDecisionService } from '../ai/AIDecisionService.js';
import type { KillEvent } from '@shared/engine/KillSystem.ts';

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
  private gamePhase: 'INITIALIZING' | 'PLAYING' | 'MEETING' | 'GAME_OVER';
  private recentThoughts: ThoughtEvent[];
  private recentSpeech: SpeechEvent[];
  private recentKills: KillEvent[];
  
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
      numAgents: this.options.numAgents,
      numImpostors: this.options.numImpostors,
      tasksPerAgent: this.options.tasksPerAgent,
    });

    // Initialize AI service if enabled
    if (this.options.enableAI) {
      this.aiService = new AIDecisionService(this.options.aiServerUrl);
      this.setupAICallbacks();
      console.log(`AI Decision Service initialized with server: ${this.options.aiServerUrl}`);
    } else {
      this.aiService = null;
      console.log('AI Decision Service disabled, using fallback behavior');
    }

    this.lastTimestamp = Date.now();
    this.tick = 0;
    this.gamePhase = 'PLAYING';
    this.recentThoughts = [];
    this.recentSpeech = [];
    this.recentKills = [];
    
    // Initialize game timer
    this.gameDurationMs = this.options.gameDurationMs;
    this.gameStartTime = Date.now();
    
    // Log game setup
    this.logGameStart();
  }
  
  private logGameStart(): void {
    const durationMinutes = Math.floor(this.gameDurationMs / 60000);
    console.log('='.repeat(50));
    console.log('🎮 NEW GAME STARTED');
    console.log(`⏱️  Duration: ${durationMinutes} minutes`);
    console.log(`👥 Agents: ${this.options.numAgents}`);
    console.log(`🔪 Impostors: ${this.manager.getImpostorIds().join(', ')}`);
    console.log('='.repeat(50));
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

    // Set up callbacks
    this.manager.setAICallbacks(
      // Decision callback - called when agent needs to make a decision
      async (context: AIContext) => {
        // Add game timer context
        const timerContext = this.getTimerContextForAgent();
        const enrichedContext: AIContext = {
          ...context,
          gameTimer: timerContext,
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
    console.log('\n' + '🔄'.repeat(25));
    console.log('⏰ GAME TIMER EXPIRED - RESTARTING GAME');
    console.log('🔄'.repeat(25) + '\n');
    
    // Create fresh manager with new impostor selection
    this.manager = new AIAgentManager({
      walkableZones: WALKABLE_ZONES,
      labeledZones: LABELED_ZONES,
      tasks: TASKS,
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
    this.gamePhase = 'PLAYING';
    this.recentThoughts = [];
    this.recentSpeech = [];
    this.recentKills = [];
    
    // Reset timer
    this.gameStartTime = Date.now();
    
    this.logGameStart();
  }

  step(timestamp = Date.now()): WorldSnapshot {
    // Check if game should restart
    if (this.isTimerExpired()) {
      this.restart();
    }
    
    const deltaSeconds = Math.max(0, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;

    if (deltaSeconds > 0) {
      this.manager.update(deltaSeconds);
      
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
      taskProgress: this.manager.getTaskProgress(),
      recentThoughts: this.recentThoughts,
      recentSpeech: this.recentSpeech,
      llmQueueStats: this.aiService?.getQueueStats(),
      bodies: this.manager.getBodies(),
      recentKills: this.recentKills,
      gameTimer: this.getGameTimer(),
      killStatusMap,
    };
    
    // Clear old kills (keep only last 10)
    if (this.recentKills.length > 10) {
      this.recentKills = this.recentKills.slice(-10);
    }
    
    return serializeWorld(this.manager.getAgents(), this.tick, timestamp, options);
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
}
