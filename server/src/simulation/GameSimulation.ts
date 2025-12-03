import { AIAgentManager } from '@shared/engine/AIAgentManager.ts';
import { MeetingSystem, type MeetingStartedEvent, type MeetingEndedEvent, type MeetingPhaseChangedEvent } from '@shared/engine/MeetingSystem.ts';
import { MeetingAIManager } from '../ai/MeetingAIManager.js';
import { serializeWorld, type SerializeWorldOptions } from '@shared/engine/serialization.ts';
import { WALKABLE_ZONES, LABELED_ZONES, TASKS, VENTS, EMERGENCY_BUTTON } from '@shared/data/poly3-map.ts';
import type { WorldSnapshot, ThoughtEvent, SpeechEvent, HeardSpeechEvent, AIContext, GameTimerSnapshot, GamePhase, BodyReportEvent, GameEndReason, GameEndState, MeetingSnapshot } from '@shared/types/simulation.types.ts';
import type { MeetingPhase } from '@shared/types/game.types.ts';
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
  private meetingSystem: MeetingSystem;
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

  // Meeting tracking
  private activeMeetingSnapshot: MeetingSnapshot | null;
  private meetingPhase: MeetingPhase | null;
  private meetingAIManager: MeetingAIManager | null;

  // Game timer
  private readonly gameDurationMs: number;
  private gameStartTime: number;
  private readonly options: Required<SimulationOptions>;

  // Game end state
  private gameEndReason: GameEndReason;
  private gameEndState: GameEndState | null;
  private restartCountdown: number; // Time until next match starts (ms)
  private totalKills: number;
  private readonly RESTART_DELAY_MS = 8000; // 8 seconds between matches

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
    
    // Initialize meeting system
    this.meetingSystem = new MeetingSystem({
      discussionTime: 60,
      votingTime: 120,
      preMeetingTime: 3,
      voteResultsTime: 5,
      ejectionTime: 5,
      anonymousVoting: false,
      confirmEjects: true,
      voteLockTime: 5,
      emergencyCooldown: 30,
      emergencyMeetingsPerPlayer: 1,
      gameStartCooldown: 15,
    });
    this.setupMeetingCallbacks();
    this.activeMeetingSnapshot = null;
    this.meetingPhase = null;
    this.meetingAIManager = null; // Initialized when meeting starts

    // Initialize game timer
    this.gameDurationMs = this.options.gameDurationMs;
    this.gameStartTime = Date.now();

    // Start meeting system game timer (for emergency button cooldown)
    this.meetingSystem.onGameStart(this.gameStartTime);

    // Initialize game end state
    this.gameEndReason = 'ONGOING';
    this.gameEndState = null;
    this.restartCountdown = 0;
    this.totalKills = 0;

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
   * Set up meeting system callbacks
   */
  private setupMeetingCallbacks(): void {
    // Provide player info to meeting system
    this.meetingSystem.setGetPlayersCallback(() => {
      return this.manager.getAgents().map(agent => ({
        id: agent.getId(),
        name: agent.getName(),
        color: agent.getColor(),
        isAlive: agent.getPlayerState() === 'ALIVE',
        isGhost: agent.getPlayerState() === 'GHOST',
        isImpostor: agent.getRole() === 'IMPOSTOR',
        position: agent.getPosition(),
      }));
    });

    // Provide impostor count callback
    this.meetingSystem.setGetImpostorCountCallback(() => {
      return this.manager.getAgents().filter(
        a => a.getRole() === 'IMPOSTOR' && a.getPlayerState() === 'ALIVE'
      ).length;
    });

    // Handle meeting started
    this.meetingSystem.setMeetingStartedCallback((event: MeetingStartedEvent) => {
      simulationLogger.info('Meeting started', {
        type: event.meeting.type,
        calledBy: event.meeting.calledByName,
        participants: event.meeting.participants.length,
      });

      // Transition game phase to MEETING
      this.gamePhase = 'MEETING';
      this.meetingPhase = event.meeting.phase;

      // Initialize meeting AI manager
      const agentMap = new Map<string, import('@shared/engine/AIAgent.ts').AIAgent>();
      for (const agent of this.manager.getAgents()) {
        agentMap.set(agent.getId(), agent);
      }
      this.meetingAIManager = new MeetingAIManager(this.meetingSystem, agentMap);
      this.meetingAIManager.initializeMeeting(event.meeting);

      // Teleport all living players to meeting positions
      this.teleportPlayersToMeeting();

      // Notify all agents about the meeting
      this.broadcastMeetingStart(event);
    });

    // Handle phase changes
    this.meetingSystem.setPhaseChangedCallback((event: MeetingPhaseChangedEvent) => {
      simulationLogger.info('Meeting phase changed', {
        meetingId: event.meetingId,
        phase: event.phase,
      });
      this.meetingPhase = event.phase;
    });

    // Handle meeting ended
    this.meetingSystem.setMeetingEndedCallback((event: MeetingEndedEvent) => {
      simulationLogger.info('Meeting ended', {
        meetingId: event.meetingId,
        ejected: event.result.ejectedPlayerName,
        reason: event.result.reason,
      });

      // Handle ejection if someone was voted out
      if (event.result.ejectedPlayerId) {
        this.handleEjection(event.result.ejectedPlayerId);
      }

      // Transition game phase back
      this.gamePhase = this.firstBodyDiscovered ? 'ALERT' : 'WORKING';
      this.meetingPhase = null;
      this.activeMeetingSnapshot = null;
      this.meetingAIManager = null; // Clean up meeting AI manager

      // Teleport players back to their pre-meeting positions or spawn
      this.teleportPlayersFromMeeting();

      // Check win conditions after ejection
      // (Will be checked on next step() call)
    });
  }

  /**
   * Teleport all living players to circular meeting positions around cafeteria table
   */
  private teleportPlayersToMeeting(): void {
    const livingAgents = this.manager.getAgents().filter(
      a => a.getPlayerState() === 'ALIVE'
    );

    // Cafeteria table center (based on emergency button position)
    const centerX = EMERGENCY_BUTTON?.position.x ?? 1584;
    const centerY = EMERGENCY_BUTTON?.position.y ?? 506;
    const radius = 80; // Distance from center for seating

    // Distribute players evenly around the circle
    livingAgents.forEach((agent, index) => {
      const angle = (2 * Math.PI * index) / livingAgents.length;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      
      // Teleport to meeting position using existing setPosition method
      agent.setPosition({ x, y });
    });

    simulationLogger.debug('Players teleported to meeting', {
      playerCount: livingAgents.length,
      centerX,
      centerY,
    });
  }

  /**
   * Teleport players back after meeting ends
   */
  private teleportPlayersFromMeeting(): void {
    // For now, players stay where they are (at meeting positions)
    // In a full implementation, we might teleport them to spawn or restore positions
    simulationLogger.debug('Meeting ended, players remain at meeting positions');
  }

  /**
   * Process AI decisions during a meeting (discussion statements and voting)
   */
  private async processMeetingAI(meeting: import('@shared/types/game.types.ts').Meeting, timestamp: number): Promise<void> {
    if (!this.meetingAIManager || !this.aiService) return;

    // Create a context getter function that builds context for each agent
    const getAgentContext = (agentId: string): AIContext | null => {
      const agent = this.manager.getAgent(agentId);
      if (!agent) return null;

      // Get the base context from the agent
      const baseContext = agent.buildContext();
      
      // Enrich with game timer and phase info
      const timerContext = this.getTimerContextForAgent();
      return {
        ...baseContext,
        gameTimer: timerContext,
        gamePhase: this.gamePhase,
        firstBodyDiscovered: this.firstBodyDiscovered,
      };
    };

    // Get decisions from meeting AI manager
    const results = await this.meetingAIManager.update(meeting, timestamp, getAgentContext);

    // Process discussion statements
    for (const { agentId, decision } of results.statements) {
      const agent = this.manager.getAgent(agentId);
      if (!agent) continue;

      // Add statement to meeting
      this.meetingSystem.addStatement(
        agentId,
        agent.getName(),
        decision.statement,
        timestamp,
        {
          accusesPlayer: decision.accusesPlayer,
          defendsPlayer: decision.defendsPlayer,
          claimsLocation: decision.claimsLocation,
          claimsTask: decision.claimsTask,
        }
      );

      // Create a speech event for the statement (shows in UI)
      // During meetings, use agent's current position (at meeting table)
      const speechEvent: SpeechEvent = {
        id: `meeting_speech_${agentId}_${timestamp}`,
        speakerId: agentId,
        timestamp,
        message: decision.statement,
        targetAgentId: decision.accusesPlayer,
        position: agent.getPosition(),
        hearingRadius: 1000, // Meeting speech heard by everyone
      };
      this.recentSpeech.push(speechEvent);

      simulationLogger.debug('Agent made discussion statement', {
        agent: agent.getName(),
        statement: decision.statement.substring(0, 50),
        accuses: decision.accusesPlayer,
        defends: decision.defendsPlayer,
      });
    }

    // Process votes
    for (const { agentId, decision } of results.votes) {
      const agent = this.manager.getAgent(agentId);
      if (!agent) continue;

      // Cast vote in meeting system
      this.meetingSystem.castVote(
        agentId,
        agent.getName(),
        decision.vote,
        decision.reasoning,
        timestamp
      );

      // If agent made a statement with their vote, add it as speech
      if (decision.statement) {
        const speechEvent: SpeechEvent = {
          id: `vote_speech_${agentId}_${timestamp}`,
          speakerId: agentId,
          timestamp,
          message: decision.statement,
          targetAgentId: decision.vote !== 'SKIP' ? decision.vote : undefined,
          position: agent.getPosition(),
          hearingRadius: 1000, // Vote speech heard by everyone
        };
        this.recentSpeech.push(speechEvent);
      }

      simulationLogger.debug('Agent cast vote', {
        agent: agent.getName(),
        vote: decision.vote,
        reasoning: decision.reasoning.substring(0, 50),
      });
    }
  }

  /**
   * Broadcast meeting start to all agents
   */
  private broadcastMeetingStart(event: MeetingStartedEvent): void {
    const meeting = event.meeting;
    let description: string;

    if (meeting.type === 'EMERGENCY') {
      description = `EMERGENCY MEETING! ${meeting.calledByName} pressed the emergency button!`;
    } else {
      const bodyNames = meeting.bodyVictimName || 'someone';
      description = `BODY REPORTED! ${meeting.calledByName} found ${bodyNames} dead in ${meeting.bodyZone || 'unknown location'}!`;
    }

    for (const agent of this.manager.getAgents()) {
      agent.getMemory().recordObservation({
        type: 'meeting_started',
        subjectId: meeting.calledBy,
        subjectName: meeting.calledByName,
        zone: 'Cafeteria',
        description,
      });
    }
  }

  /**
   * Handle ejection of a player
   */
  private handleEjection(playerId: string): void {
    const agent = this.manager.getAgent(playerId);
    if (agent) {
      // Mark player as ejected (dead)
      agent.setPlayerState('DEAD');
      
      simulationLogger.info('Player ejected', {
        playerId,
        playerName: agent.getName(),
        wasImpostor: agent.getRole() === 'IMPOSTOR',
      });
    }
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
    simulationLogger.info('GAME RESTARTING - NEW MATCH STARTING');

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

    // Reset meeting system
    this.meetingSystem.reset();
    this.meetingSystem.onGameStart(Date.now());
    this.activeMeetingSnapshot = null;
    this.meetingPhase = null;

    // Reset timer
    this.gameStartTime = Date.now();

    // Reset game end state
    this.gameEndReason = 'ONGOING';
    this.gameEndState = null;
    this.restartCountdown = 0;
    this.totalKills = 0;

    this.logGameStart();
  }

  /**
   * Check win conditions and return the reason if game should end
   */
  private checkWinConditions(): GameEndReason {
    // Don't check if game already ended
    if (this.gameEndReason !== 'ONGOING') {
      return this.gameEndReason;
    }

    const agents = this.manager.getAgents();
    
    // Count living players by role
    let livingCrewmates = 0;
    let livingImpostors = 0;
    
    for (const agent of agents) {
      const state = agent.getPlayerState();
      if (state === 'ALIVE') {
        if (agent.getRole() === 'CREWMATE') {
          livingCrewmates++;
        } else if (agent.getRole() === 'IMPOSTOR') {
          livingImpostors++;
        }
      }
    }

    // Check impostor parity victory (impostors >= crewmates while at least 1 impostor alive)
    if (livingImpostors > 0 && livingImpostors >= livingCrewmates) {
      simulationLogger.info('GAME OVER: Impostor Parity Victory!', { livingImpostors, livingCrewmates });
      return 'IMP_WIN_PARITY';
    }

    // Check if all impostors are dead (crewmate vote win - future voting feature)
    if (livingImpostors === 0 && livingCrewmates > 0) {
      simulationLogger.info('GAME OVER: Crewmates eliminated all impostors!', { livingCrewmates });
      return 'CREW_WIN_VOTE';
    }

    // Check task completion victory
    const taskProgress = this.manager.getTaskProgress();
    if (taskProgress >= 100) {
      simulationLogger.info('GAME OVER: Crewmates completed all tasks!', { taskProgress });
      return 'CREW_WIN_TASKS';
    }

    // Check sabotage victory (reactor or O2 timeout)
    const sabotage = this.manager.getSabotageContext();
    if (sabotage?.activeSabotage) {
      const { type, timeRemaining } = sabotage.activeSabotage;
      if ((type === 'REACTOR' || type === 'O2') && timeRemaining <= 0) {
        simulationLogger.info('GAME OVER: Critical sabotage not fixed!', { type });
        return 'IMP_WIN_SABOTAGE';
      }
    }

    // Check timer expiry
    if (this.isTimerExpired()) {
      simulationLogger.info('GAME OVER: Time expired!');
      return 'TIME_UP';
    }

    return 'ONGOING';
  }

  /**
   * Build game end state for UI display
   */
  private buildGameEndState(reason: GameEndReason): GameEndState {
    const agents = this.manager.getAgents();
    
    const survivingCrewmates: string[] = [];
    const survivingImpostors: string[] = [];
    const impostorReveal: string[] = [];
    
    for (const agent of agents) {
      if (agent.getRole() === 'IMPOSTOR') {
        impostorReveal.push(agent.getName());
        if (agent.getPlayerState() === 'ALIVE') {
          survivingImpostors.push(agent.getName());
        }
      } else if (agent.getPlayerState() === 'ALIVE') {
        survivingCrewmates.push(agent.getName());
      }
    }

    // Determine winner
    let winner: 'CREWMATES' | 'IMPOSTORS' | 'NONE';
    if (reason === 'CREW_WIN_TASKS' || reason === 'CREW_WIN_VOTE') {
      winner = 'CREWMATES';
    } else if (reason === 'IMP_WIN_PARITY' || reason === 'IMP_WIN_SABOTAGE') {
      winner = 'IMPOSTORS';
    } else {
      winner = 'NONE'; // TIME_UP
    }

    return {
      reason,
      winner,
      survivingCrewmates,
      survivingImpostors,
      impostorReveal,
      taskProgress: this.manager.getTaskProgress(),
      totalKills: this.totalKills,
      matchDuration: Date.now() - this.gameStartTime,
      nextMatchCountdown: this.restartCountdown,
    };
  }

  step(timestamp = Date.now()): WorldSnapshot {
    const deltaSeconds = Math.max(0, (timestamp - this.lastTimestamp) / 1000);
    const deltaMs = deltaSeconds * 1000;
    this.lastTimestamp = timestamp;

    // Handle game-over countdown and restart
    if (this.gameEndReason !== 'ONGOING') {
      this.restartCountdown -= deltaMs;
      if (this.gameEndState) {
        this.gameEndState.nextMatchCountdown = Math.max(0, this.restartCountdown);
      }
      if (this.restartCountdown <= 0) {
        this.restart();
        // Return fresh state after restart
        return serializeWorld(this.manager.getAgents(), this.tick, timestamp, {
          gamePhase: this.gamePhase,
          gameTimer: this.getGameTimer(),
        });
      }
    } else {
      // Check win conditions only when game is ongoing
      const winCheck = this.checkWinConditions();
      if (winCheck !== 'ONGOING') {
        this.gameEndReason = winCheck;
        this.gamePhase = 'GAME_OVER';
        this.restartCountdown = this.RESTART_DELAY_MS;
        this.gameEndState = this.buildGameEndState(winCheck);
        simulationLogger.info('MATCH ENDED', { 
          reason: winCheck, 
          winner: this.gameEndState.winner,
          matchDuration: Math.floor(this.gameEndState.matchDuration / 1000) + 's'
        });
      }
    }

    // Only update simulation if game is still running
    if (this.gameEndReason === 'ONGOING' && deltaSeconds > 0) {
      // Update meeting system first (handles phase transitions)
      if (this.meetingSystem.isMeetingActive()) {
        this.meetingSystem.update(timestamp);

        // Update meeting snapshot for client sync
        this.activeMeetingSnapshot = this.meetingSystem.createMeetingSnapshot(timestamp);
        this.meetingPhase = this.meetingSystem.getCurrentPhase();

        // Process meeting AI (discussion statements, voting)
        if (this.meetingAIManager && this.aiService) {
          const meeting = this.meetingSystem.getActiveMeeting();
          if (meeting && (meeting.phase === 'DISCUSSION' || meeting.phase === 'VOTING')) {
            // Process AI decisions asynchronously
            this.processMeetingAI(meeting, timestamp).catch(err => {
              simulationLogger.error('Error in meeting AI processing', { error: err });
            });
          }
        }
      }

      // Only update agent movement/AI if NOT in a meeting
      if (!this.meetingSystem.isMeetingActive()) {
        this.manager.update(deltaSeconds);

        // Update sabotage system (timers, fix progress, etc.)
        this.manager.updateSabotage(deltaSeconds);
      }      // Update AI service with current agent positions for trace capture
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
    }    // Collect AI events
    if (this.aiService) {
      const newThoughts = this.aiService.flushPendingThoughts();
      const newSpeech = this.aiService.flushPendingSpeech();

      // Apply thought side effects (suspicion updates, pending questions)
      for (const thought of newThoughts) {
        const agent = this.manager.getAgent(thought.agentId);
        if (agent) {
          // Apply suspicion updates from thought to agent's memory
          if (thought.suspicionUpdates && thought.suspicionUpdates.length > 0) {
            for (const update of thought.suspicionUpdates) {
              // Find the target agent by name (color)
              const targetAgent = this.manager.getAgents().find(a => 
                a.getName().toLowerCase() === update.targetName.toLowerCase()
              );
              if (targetAgent) {
                agent.getMemory().adjustSuspicion(targetAgent.getId(), targetAgent.getName(), update.delta, update.reason, 'speech');
              }
            }
          }
          
          // Update pending questions on the agent
          if (thought.pendingQuestions && thought.pendingQuestions.length > 0) {
            agent.addPendingQuestions(thought.pendingQuestions);
          }
        }
      }

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
      meetingPhase: this.meetingPhase ?? undefined,
      activeMeeting: this.activeMeetingSnapshot ?? undefined,
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
      gameEndState: this.gameEndState ?? undefined,
    };    // Clear the body report after one tick (it's only for UI animation trigger)
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
      this.totalKills++;
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

    // Mark first body discovered
    if (isFirstDiscovery) {
      this.firstBodyDiscovered = true;
    }

    // Get first body info for meeting
    const firstBody = bodies[0];

    // Start body report meeting
    const meeting = this.meetingSystem.startBodyReportMeeting(
      reporter.getId(),
      reporter.getName(),
      reportEvent.timestamp,
      {
        bodyId: firstBody.id,
        victimId: firstBody.victimId,
        victimName: firstBody.victimName,
        victimColor: firstBody.victimColor,
        location: firstBody.position,
        zone: firstBody.zone || 'Unknown',
      }
    );

    if (meeting) {
      simulationLogger.info('BODY REPORT MEETING STARTED', {
        reporter: reporter.getName(),
        victim: firstBody.victimName,
        bodiesFound: bodies.length,
        meetingId: meeting.id,
      });
    } else {
      // Fallback to ALERT phase if meeting couldn't start
      if (isFirstDiscovery) {
        this.gamePhase = 'ALERT';
        simulationLogger.info('FIRST BODY DISCOVERED - GAME PHASE TRANSITION (no meeting)', {
          reporter: reporter.getName(),
          phase: 'WORKING -> ALERT',
          bodiesFound: bodies.length,
        });
      }
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
    const bodyZone = event.bodies.length > 0 ? event.bodies[0].location : null;
    const description = event.isFirstDiscovery
      ? `EMERGENCY! ${event.reporterName} found dead: ${bodyNames}. There is a killer among us!`
      : `${event.reporterName} reported: ${bodyNames} found dead.`;

    for (const agent of this.manager.getAgents()) {
      // Record in agent's memory
      agent.getMemory().recordObservation({
        type: 'body_reported',
        subjectId: event.reporterId,
        subjectName: event.reporterName,
        zone: bodyZone,
        description,
      });
    }

    simulationLogger.debug('Body report broadcast to all agents', {
      agentCount: this.manager.getAgents().length,
      description 
    });
  }  /**
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

  // ==================== MEETING SYSTEM METHODS ====================

  /**
   * Attempt to call an emergency meeting
   * @returns true if meeting was started, false otherwise
   */
  callEmergencyMeeting(playerId: string): boolean {
    const player = this.manager.getAgent(playerId);
    if (!player) {
      simulationLogger.warn('Emergency meeting failed: Invalid player', { playerId });
      return false;
    }

    // Check if player is alive
    if (player.getPlayerState() !== 'ALIVE') {
      simulationLogger.warn('Emergency meeting failed: Player not alive', { playerId });
      return false;
    }

    // Check if player is near the emergency button
    const buttonPos = EMERGENCY_BUTTON?.position;
    if (buttonPos) {
      const playerPos = player.getPosition();
      const distance = Math.sqrt(
        Math.pow(playerPos.x - buttonPos.x, 2) +
        Math.pow(playerPos.y - buttonPos.y, 2)
      );
      const BUTTON_RANGE = 50; // Distance required to press button
      if (distance > BUTTON_RANGE) {
        simulationLogger.warn('Emergency meeting failed: Too far from button', {
          playerId,
          distance,
          required: BUTTON_RANGE,
        });
        return false;
      }
    }

    const timestamp = Date.now();
    const meeting = this.meetingSystem.startEmergencyMeeting(
      player.getId(),
      player.getName(),
      timestamp
    );

    if (meeting) {
      simulationLogger.info('EMERGENCY MEETING STARTED', {
        caller: player.getName(),
        meetingId: meeting.id,
      });
      return true;
    }

    return false;
  }

  /**
   * Check if a player can call an emergency meeting
   */
  canCallEmergencyMeeting(playerId: string): { canCall: boolean; reason?: string } {
    const player = this.manager.getAgent(playerId);
    if (!player) {
      return { canCall: false, reason: 'Invalid player' };
    }

    if (player.getPlayerState() !== 'ALIVE') {
      return { canCall: false, reason: 'Player not alive' };
    }

    // Check distance to button
    const buttonPos = EMERGENCY_BUTTON?.position;
    if (buttonPos) {
      const playerPos = player.getPosition();
      const distance = Math.sqrt(
        Math.pow(playerPos.x - buttonPos.x, 2) +
        Math.pow(playerPos.y - buttonPos.y, 2)
      );
      const BUTTON_RANGE = 50;
      if (distance > BUTTON_RANGE) {
        return { canCall: false, reason: `Too far from button (${Math.floor(distance)} units)` };
      }
    }

    return this.meetingSystem.canCallEmergencyMeeting(playerId, Date.now());
  }

  /**
   * Get remaining emergency meetings for a player
   */
  getRemainingEmergencyMeetings(playerId: string): number {
    return this.meetingSystem.getRemainingMeetings(playerId);
  }

  /**
   * Get the meeting system (for advanced operations)
   */
  getMeetingSystem(): MeetingSystem {
    return this.meetingSystem;
  }

  /**
   * Check if a meeting is currently active
   */
  isMeetingActive(): boolean {
    return this.meetingSystem.isMeetingActive();
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
