import { AIAgentManager } from '@shared/engine/AIAgentManager.ts';
import { serializeWorld, type SerializeWorldOptions } from '@shared/engine/serialization.ts';
import { WALKABLE_ZONES, LABELED_ZONES, TASKS } from '@shared/data/poly3-map.ts';
import type { WorldSnapshot, ThoughtEvent, SpeechEvent, AIContext } from '@shared/types/simulation.types.ts';
import { AIDecisionService } from '../ai/AIDecisionService.js';

export interface SimulationOptions {
  numAgents?: number;
  numImpostors?: number;
  tasksPerAgent?: number;
  aiServerUrl?: string;
  enableAI?: boolean;
}

const DEFAULT_OPTIONS: Required<SimulationOptions> = {
  numAgents: 8,
  numImpostors: 2,
  tasksPerAgent: 5,
  aiServerUrl: 'http://192.168.86.48:8080',
  enableAI: true,
};

export class GameSimulation {
  private readonly manager: AIAgentManager;
  private readonly aiService: AIDecisionService | null;
  private lastTimestamp: number;
  private tick: number;
  private gamePhase: 'INITIALIZING' | 'PLAYING' | 'MEETING' | 'GAME_OVER';
  private recentThoughts: ThoughtEvent[];
  private recentSpeech: SpeechEvent[];

  constructor(options: SimulationOptions = {}) {
    const resolved = { ...DEFAULT_OPTIONS, ...options };
    
    this.manager = new AIAgentManager({
      walkableZones: WALKABLE_ZONES,
      labeledZones: LABELED_ZONES,
      tasks: TASKS,
      numAgents: resolved.numAgents,
      numImpostors: resolved.numImpostors,
      tasksPerAgent: resolved.tasksPerAgent,
    });

    // Initialize AI service if enabled
    if (resolved.enableAI) {
      this.aiService = new AIDecisionService(resolved.aiServerUrl);
      this.setupAICallbacks();
      console.log(`AI Decision Service initialized with server: ${resolved.aiServerUrl}`);
    } else {
      this.aiService = null;
      console.log('AI Decision Service disabled, using fallback behavior');
    }

    this.lastTimestamp = Date.now();
    this.tick = 0;
    this.gamePhase = 'PLAYING';
    this.recentThoughts = [];
    this.recentSpeech = [];
    
    // Log game setup
    console.log('='.repeat(50));
    console.log('GAME INITIALIZED');
    console.log(`Agents: ${resolved.numAgents}`);
    console.log(`Impostors: ${this.manager.getImpostorIds().join(', ')}`);
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
        return this.aiService!.getAgentDecision(context);
      },
      // Trigger callback - called to check for thought/speech triggers
      async (context: AIContext) => {
        const result = await this.aiService!.processAgentTriggers(context);
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

  step(timestamp = Date.now()): WorldSnapshot {
    const deltaSeconds = Math.max(0, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;

    if (deltaSeconds > 0) {
      this.manager.update(deltaSeconds);
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
    
    const options: SerializeWorldOptions = {
      gamePhase: this.gamePhase,
      taskProgress: this.manager.getTaskProgress(),
      recentThoughts: this.recentThoughts,
      recentSpeech: this.recentSpeech,
    };
    
    return serializeWorld(this.manager.getAgents(), this.tick, timestamp, options);
  }

  getAgentManager(): AIAgentManager {
    return this.manager;
  }
  
  getGamePhase(): string {
    return this.gamePhase;
  }
  
  getTaskProgress(): number {
    return this.manager.getTaskProgress();
  }
}
