/**
 * AI Agent Controller (Enhanced with LLM Integration)
 * Manages AI behavior, decision making, tasks, thoughts, and communication
 */

import type { Point } from '../data/poly3-map.ts';
import { MovementController } from './MovementController.ts';
import { PlayerStateMachine, PlayerActivityState } from './PlayerStateMachine.ts';
import type { Zone } from './ZoneDetector.ts';
import type { DestinationSelector } from './DestinationSelector.ts';
import type { Pathfinder } from './Pathfinder.ts';
import { PathSmoother } from './PathSmoother.ts';
import { AgentMemory, type ObservationEntry, type ConversationEntry, type SuspicionRecord } from './AgentMemory.ts';
import type { PlayerRole, PlayerState } from '../types/game.types.ts';
import type { 
  TaskAssignment, 
  AIContext, 
  AIDecision,
  ThoughtTrigger 
} from '../types/simulation.types.ts';

// ========== Configuration ==========

export interface AIAgentConfig {
  id: string;
  name: string;
  color: number;
  startPosition: Point;
  baseSpeed: number;
  visionRadius: number;
  actionRadius: number;
}

export interface AIAgentRoleConfig {
  role: PlayerRole;
  assignedTasks: TaskAssignment[];
}

// ========== Behavior State ==========

export interface AIBehaviorState {
  isThinking: boolean;
  nextDecisionTime: number;
  idleTimeRemaining: number;
  currentGoal: string | null;
  currentGoalType: AIDecision['goalType'] | null;
  targetTaskIndex: number | null;
  targetAgentId: string | null;
  lastTriggerCheckTime: number; // Throttle trigger processing
  // Social tracking
  buddyId: string | null; // Current buddy we're sticking with
  lastSocialActionTime: number; // Track when we last did something social
  confrontationTarget: string | null; // Who we're confronting
  isBeingFollowed: boolean; // Detect if someone is following us
  followersIds: string[]; // Who's been following us
  // Kill tracking (impostor only)
  lastKillPosition: Point | null; // Where the last kill happened
  recentKillTimestamp: number | null; // When the last kill happened
  isInKillAnimation: boolean; // Currently in kill animation
  killAnimationEndTime: number; // When kill animation ends
}

// ========== AI State (Thoughts, Speech, etc.) ==========

export interface AIAgentState {
  role: PlayerRole;
  playerState: PlayerState;
  assignedTasks: TaskAssignment[];
  currentTaskIndex: number | null;
  isDoingTask: boolean;
  taskStartTime: number | null;

  // Perception
  visibleAgentIds: string[];
  visibleAgentNames: string[];
  agentsInSpeechRange: string[];  // Internal state
  currentThought: string | null;
  lastThoughtTime: number;
  recentSpeech: string | null;
  lastSpeechTime: number;
  
  // Social
  suspicionLevels: Record<string, number>;
  recentEvents: string[];
  
  // Witness/Kill memory
  witnessedKill: {
    timestamp: number;
    victimId: string;
    victimName: string;
    suspectedKillerColor: number | null;
    colorConfidence: number;
    location: string | null;
    sawKillDirectly: boolean;
  } | null;
  visibleBodies: Array<{
    id: string;
    victimName: string;
    victimColor: number;
    position: Point;
    distance: number;
    zone: string | null;
  }>;
}

// ========== Decision Callback Type ==========

export type AIDecisionCallback = (context: AIContext) => Promise<AIDecision>;
export type AITriggerCallback = (context: AIContext) => Promise<{
  thought?: { thought: string; trigger: ThoughtTrigger };
  speech?: { message: string };
}>;

// ========== Main Class ==========

export class AIAgent {
  private config: AIAgentConfig;
  private movementController: MovementController;
  private stateMachine: PlayerStateMachine;
  private pathfinder: Pathfinder;
  private destinationSelector: DestinationSelector;
  private pathSmoother: PathSmoother;
  private behaviorState: AIBehaviorState;
  private aiState: AIAgentState;
  private zones: Zone[];
  private memory: AgentMemory;
  
  // AI callbacks (set by manager)
  private decisionCallback: AIDecisionCallback | null = null;
  private triggerCallback: AITriggerCallback | null = null;
  
  // Reference to other agents for visibility checks
  private otherAgents: AIAgent[] = [];

  // Speech broadcast callback (set by manager)
  private speechBroadcastCallback: ((speakerId: string, message: string, zone: string | null) => void) | null = null;

  // Kill request callback (set by manager) - returns true if kill succeeded
  private killRequestCallback: ((killerId: string, targetId: string) => boolean) | null = null;

  // Conversation state - tracks pending replies
  private pendingConversationReply: {
    speakerId: string;
    speakerName: string;
    message: string;
    zone: string | null;
    timestamp: number;
  } | null = null;
  private shouldRespondToConversation: boolean = false;  constructor(
    config: AIAgentConfig,
    pathfinder: Pathfinder,
    destinationSelector: DestinationSelector,
    zones: Zone[]
  ) {
    this.config = config;
    this.pathfinder = pathfinder;
    this.destinationSelector = destinationSelector;
    this.zones = zones;
    
    // Initialize components
    this.movementController = new MovementController(config.startPosition, config.baseSpeed);
    this.stateMachine = new PlayerStateMachine(config.id, config.startPosition);
    this.pathSmoother = new PathSmoother(20);
    this.memory = new AgentMemory(config.id, config.name);
    
    this.behaviorState = {
      isThinking: false,
      nextDecisionTime: Date.now() + 1000 + Math.random() * 3000,
      idleTimeRemaining: 0,
      currentGoal: null,
      currentGoalType: null,
      targetTaskIndex: null,
      targetAgentId: null,
      lastTriggerCheckTime: Date.now() - Math.random() * 2000, // Randomize to desync agents
      // Social state
      buddyId: null,
      lastSocialActionTime: 0,
      confrontationTarget: null,
      isBeingFollowed: false,
      followersIds: [],
      // Kill state (impostor only)
      lastKillPosition: null,
      recentKillTimestamp: null,
      isInKillAnimation: false,
      killAnimationEndTime: 0,
    };
    
    // Initialize AI state with defaults
    this.aiState = {
      role: 'CREWMATE',
      playerState: 'ALIVE',
      assignedTasks: [],
      currentTaskIndex: null,
      isDoingTask: false,
      taskStartTime: null,
      visibleAgentIds: [],
      visibleAgentNames: [],
      agentsInSpeechRange: [],
      currentThought: null,
      lastThoughtTime: 0,
      recentSpeech: null,
      lastSpeechTime: 0,
      suspicionLevels: {},
      recentEvents: [],
      // Kill/witness state
      witnessedKill: null,
      visibleBodies: [],
    };
  }
  
  // ========== Initialization ==========
  
  /**
   * Set role and tasks after construction
   */
  initializeRole(roleConfig: AIAgentRoleConfig): void {
    this.aiState.role = roleConfig.role;
    this.aiState.assignedTasks = roleConfig.assignedTasks;
    console.log(`[${this.config.id}] Initialized as ${roleConfig.role} with ${roleConfig.assignedTasks.length} tasks`);
  }
  
  /**
   * Set AI callbacks for LLM integration
   */
  setAICallbacks(
    decisionCallback: AIDecisionCallback,
    triggerCallback: AITriggerCallback
  ): void {
    this.decisionCallback = decisionCallback;
    this.triggerCallback = triggerCallback;
  }
  
  /**
   * Set reference to other agents for visibility calculations
   */
  setOtherAgents(agents: AIAgent[]): void {
    this.otherAgents = agents.filter(a => a.getId() !== this.config.id);
    // Initialize suspicion for all other agents
    for (const agent of this.otherAgents) {
      this.memory.adjustSuspicion(agent.getId(), agent.getName(), 0, 'Initial neutral', 'movement');
    }
  }
  
  /**
   * Set callback for broadcasting speech to nearby agents
   */
  setSpeechBroadcastCallback(callback: (speakerId: string, message: string, zone: string | null) => void): void {
    this.speechBroadcastCallback = callback;
  }
  
  /**
   * Set callback for requesting kills (impostors only)
   * Callback returns true if the kill was successful
   */
  setKillRequestCallback(callback: (killerId: string, targetId: string) => boolean): void {
    this.killRequestCallback = callback;
  }
  
    /**
   * Receive speech from another agent
   * This may trigger a conversation response
   */
  hearSpeech(speakerId: string, speakerName: string, message: string, zone: string | null): void {
    // Record in memory
    this.memory.recordHeardSpeech(speakerId, speakerName, message, zone);

    // Add to recent events
    this.addRecentEvent(`Heard ${speakerName} say: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);

    // Store the pending conversation for potential reply
    this.pendingConversationReply = {
      speakerId,
      speakerName,
      message,
      zone,
      timestamp: Date.now()
    };

    // Trigger thought/reaction for important messages
    const lowerMsg = message.toLowerCase();
    const isAddressed = lowerMsg.includes(this.config.name.toLowerCase());
    const isImportant = lowerMsg.includes('sus') || lowerMsg.includes('impostor') || lowerMsg.includes('vent') ||
                        lowerMsg.includes('where') || lowerMsg.includes('saw') || lowerMsg.includes('help') ||
                        lowerMsg.includes('?'); // Questions deserve responses
    
    if (isAddressed || isImportant) {
      // Likely being addressed or something important - force immediate trigger check
      this.behaviorState.lastTriggerCheckTime = 0;
      
      // Higher chance to respond when directly addressed
      if (isAddressed) {
        this.shouldRespondToConversation = true;
      } else {
        // Random chance to join conversation on important topics
        this.shouldRespondToConversation = Math.random() < 0.6; // 60% chance
      }
    } else {
      // Small talk - lower response chance
      this.shouldRespondToConversation = Math.random() < 0.35; // 35% chance
    }
  }

  // ========== Main Update Loop ==========
  
  /**
   * Update AI agent (called each frame) - NON-BLOCKING
   */
  update(deltaTime: number): void {
    const now = Date.now();
    
    // Update movement (always happens, never blocked)
    this.movementController.update(deltaTime);
    
    // Update state machine position
    const position = this.movementController.getPosition();
    this.stateMachine.updatePosition(position);
    
    // Update visibility
    this.updateVisibility();
    
    // Check task completion
    if (this.aiState.isDoingTask) {
      this.updateTaskProgress(now);
    }
    
    // Check if movement finished
    if (this.stateMachine.isMoving() && !this.movementController.isMoving()) {
      this.onArriveAtDestination();
    }

    // Detect and recover from stuck movement
    if (this.stateMachine.isMoving() && this.movementController.isStuck()) {
      this.handleMovementStuck();
    }
    
    // Make decisions (non-blocking - fires and forgets)
    if (now >= this.behaviorState.nextDecisionTime && !this.behaviorState.isThinking) {
      this.makeDecisionAsync();
    }
    
    // Process AI triggers (thoughts, speech) - throttled and non-blocking
    // Use variable interval (1.8-2.2s) to prevent agents from synchronizing over time
    const TRIGGER_CHECK_INTERVAL = 1800 + Math.random() * 400;
    if (now - this.behaviorState.lastTriggerCheckTime >= TRIGGER_CHECK_INTERVAL) {
      this.behaviorState.lastTriggerCheckTime = now;
      this.processTriggersAsync();
    }
    
    // Update idle countdown
    if (this.behaviorState.idleTimeRemaining > 0) {
      this.behaviorState.idleTimeRemaining -= deltaTime * 1000;
      if (this.behaviorState.idleTimeRemaining <= 0) {
        this.behaviorState.nextDecisionTime = now;
      }
    }
  }
  
  // ========== Visibility System ==========
  
  /**
   * Update which agents are visible to this agent
   */
  private updateVisibility(): void {
    const visibleIds: string[] = [];
    const visibleNames: string[] = []; // Names (colors) for UI display
    const speechRangeNames: string[] = []; // Use names (colors) for natural conversation
    const speechRange = 150; // Units for speech hearing

    for (const other of this.otherAgents) {
      const otherPos = other.getPosition();
      const distance = this.distanceTo(otherPos);

      if (distance <= this.config.visionRadius) {
        visibleIds.push(other.getId());
        visibleNames.push(other.getName());
      }

      if (distance <= speechRange) {
        speechRangeNames.push(other.getName()); // Use color name for natural speech
      }
    }    // Detect changes for triggers
    const newlyVisible = visibleIds.filter(id => !this.aiState.visibleAgentIds.includes(id));
    const newlyLost = this.aiState.visibleAgentIds.filter(id => !visibleIds.includes(id));
    
    if (newlyVisible.length > 0) {
      // Convert IDs to names for the event message
      const newlyVisibleNames = newlyVisible.map(id => {
        const agent = this.otherAgents.find(a => a.getId() === id);
        return agent ? agent.getName() : id;
      });
      this.addRecentEvent(`Spotted: ${newlyVisibleNames.join(', ')}`);
      // Record observations for newly visible agents
      for (const agentId of newlyVisible) {
        const other = this.otherAgents.find(a => a.getId() === agentId);
        if (other) {
          this.observeAgent(other);
        }
      }
    }
    if (newlyLost.length > 0) {
      // Convert IDs to names for the event message
      const lostNames = newlyLost.map(id => {
        const agent = this.otherAgents.find(a => a.getId() === id);
        return agent ? agent.getName() : id;
      });
      this.addRecentEvent(`Lost sight of: ${lostNames.join(', ')}`);
      // Check if they were doing a task when we lost sight
      for (const agentId of newlyLost) {
        const other = this.otherAgents.find(a => a.getId() === agentId);
        if (other && other.getStateMachine().getActivityState() === PlayerActivityState.DOING_TASK) {
          // They were doing a task - record it ended (we didn't see it finish)
          this.memory.recordTaskEnd(agentId, false);
        }
      }
    }
    
    // Observe all visible agents for their activities
    for (const agentId of visibleIds) {
      const other = this.otherAgents.find(a => a.getId() === agentId);
      if (other) {
        this.observeAgentActivity(other);
      }
    }
    
    // Detect if we're being followed
    this.detectFollowers();

    this.aiState.visibleAgentIds = visibleIds;
    this.aiState.visibleAgentNames = visibleNames;
    this.aiState.agentsInSpeechRange = speechRangeNames;

    // Update suspicion levels from memory
    this.aiState.suspicionLevels = this.memory.getAllSuspicionLevels();
  }
  
  /**
   * Observe an agent and record their activity
   */
  private observeAgent(other: AIAgent): void {
    const zone = other.getCurrentZone();
    const activityState = other.getStateMachine().getActivityState();
    
    this.memory.recordObservation({
      type: 'location',
      subjectId: other.getId(),
      subjectName: other.getName(),
      zone,
      position: other.getPosition(),
      description: `Saw ${other.getName()} in ${zone ?? 'unknown area'} (${activityState})`,
    });
  }
  
  /**
   * Observe ongoing agent activity (check for task behavior)
   */
  private observeAgentActivity(other: AIAgent): void {
    const activityState = other.getStateMachine().getActivityState();
    const otherId = other.getId();
    
    // Check if they started doing a task
    if (activityState === PlayerActivityState.DOING_TASK) {
      const taskIndex = other.getCurrentTaskIndex();
      if (taskIndex !== null) {
        const tasks = other.getAssignedTasks();
        const task = tasks[taskIndex];
        if (task) {
          // Check if we're already tracking this task
          const existingObs = this.memory.getTaskObservationsForAgent(otherId);
          const lastObs = existingObs[existingObs.length - 1];
          
          if (!lastObs || lastObs.endTime !== undefined) {
            // New task observation
            const isVisual = this.isVisualTask(task.taskType);
            this.memory.recordTaskStart(
              otherId, 
              other.getName(), 
              task.taskType, 
              task.room, 
              task.duration,
              isVisual
            );
          }
        }
      }
    } else {
      // They're not doing a task - check if they just finished
      const existingObs = this.memory.getTaskObservationsForAgent(otherId);
      const lastObs = existingObs[existingObs.length - 1];
      
      if (lastObs && lastObs.endTime === undefined) {
        // They were doing a task and now aren't - record completion
        const sawAnimation = lastObs.wasVisual ? Math.random() > 0.3 : false; // Simulate seeing animation
        this.memory.recordTaskEnd(otherId, sawAnimation);
      }
    }
  }
  
  /**
   * Check if a task type has a visual indicator
   */
  private isVisualTask(taskType: string): boolean {
    const visualTasks = ['Submit Scan', 'Clear Asteroids', 'Prime Shields', 'Empty Garbage'];
    return visualTasks.includes(taskType);
  }
  
  /**
   * Detect if someone is following us
   */
  private detectFollowers(): void {
    const followers: string[] = [];
    const myPos = this.getPosition();
    
    for (const other of this.otherAgents) {
      if (!this.aiState.visibleAgentIds.includes(other.getId())) continue;
      
      const otherGoal = other.getCurrentGoal();
      const distance = this.distanceTo(other.getPosition());
      
      // Check if they're following us
      if (otherGoal?.includes(this.config.id) || otherGoal?.includes('Following')) {
        followers.push(other.getId());
      } else if (distance < 80 && other.isMoving() && this.isMoving()) {
        // Very close and both moving - might be following
        const timesSeenClose = this.behaviorState.followersIds.filter(id => id === other.getId()).length;
        if (timesSeenClose > 3) {
          followers.push(other.getId());
        }
      }
    }
    
    this.behaviorState.isBeingFollowed = followers.length > 0;
    this.behaviorState.followersIds = followers;
    
    // If being followed, might increase suspicion or trigger confrontation
    if (followers.length > 0) {
      for (const followerId of followers) {
        const follower = this.otherAgents.find(a => a.getId() === followerId);
        if (follower) {
          this.memory.adjustSuspicion(
            followerId,
            follower.getName(),
            5,
            'Following me around',
            'following'
          );
        }
      }
    }
  }
  
  private distanceTo(point: Point): number {
    const pos = this.getPosition();
    const dx = point.x - pos.x;
    const dy = point.y - pos.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  
  // ========== Decision Making ==========
  
  /**
   * Make a behavioral decision (non-blocking - fires async and continues)
   */
  private makeDecisionAsync(): void {
    const currentState = this.stateMachine.getActivityState();
    
    if (currentState === PlayerActivityState.IDLE && !this.aiState.isDoingTask) {
      this.behaviorState.isThinking = true;
      // Fire and forget - don't await
      this.decideNextActionAsync().catch(err => {
        console.warn(`[${this.config.id}] Decision error:`, err);
      }).finally(() => {
        this.behaviorState.isThinking = false;
      });
    }
  }
  
  /**
   * Use AI (or fallback) to decide next action - async but called fire-and-forget
   */
  private async decideNextActionAsync(): Promise<void> {
    let decision: AIDecision;
    
    if (this.decisionCallback) {
      try {
        const context = this.buildAIContext();
        decision = await this.decisionCallback(context);
      } catch {
        // AI failed - use fallback immediately, don't log verbose errors
        decision = this.fallbackDecision();
      }
    } else {
      decision = this.fallbackDecision();
    }
    
    // Execute the decision
    await this.executeDecision(decision);
  }
  
  /**
   * Execute an AI decision
   */
  private async executeDecision(decision: AIDecision): Promise<void> {
    console.log(`[${this.config.id}] Decision: ${decision.goalType} - ${decision.reasoning}`);
    
    if (decision.thought) {
      this.aiState.currentThought = decision.thought;
      this.aiState.lastThoughtTime = Date.now();
    }
    
    this.behaviorState.currentGoalType = decision.goalType;
    
    switch (decision.goalType) {
      case 'GO_TO_TASK':
        await this.goToTask(decision.targetTaskIndex ?? this.findNextTask());
        break;
        
      case 'FOLLOW_AGENT':
        await this.followAgent(decision.targetAgentId);
        break;
        
      case 'AVOID_AGENT':
        await this.avoidAgent(decision.targetAgentId);
        break;
        
      case 'WANDER':
        this.wanderRandomly();
        break;
        
      case 'SPEAK':
        if (decision.speech) {
          this.speak(decision.speech);
        }
        this.behaviorState.nextDecisionTime = Date.now() + 2000;
        break;
      
      case 'BUDDY_UP':
        await this.buddyUp(decision.targetAgentId);
        break;
        
      case 'CONFRONT':
        await this.confrontAgent(decision.targetAgentId, decision.accusation);
        break;
        
      case 'SPREAD_RUMOR':
        this.spreadRumor(decision.rumor, decision.targetAgentId);
        break;
        
      case 'DEFEND_SELF':
        this.defendSelf(decision.defense);
        break;
      
      // ===== Impostor-only actions =====
      case 'KILL':
        // Request the kill through the callback
        console.log(`[KILL-ACTION] ${this.config.name} attempting KILL on target: ${decision.killTarget || 'none'}, callback set: ${!!this.killRequestCallback}`);
        if (decision.killTarget && this.killRequestCallback) {
          const targetId = decision.killTarget;
          const success = this.killRequestCallback(this.config.id, targetId);
          console.log(`[KILL-ACTION] ${this.config.name} kill result: ${success ? 'SUCCESS' : 'FAILED'}`);
          
          if (success) {
            // Kill succeeded - the callback should have called onKillSuccess
            this.behaviorState.currentGoal = `Killed ${targetId}`;
          } else {
            // Kill failed - target out of range or on cooldown
            this.behaviorState.currentGoal = `Kill failed - stalking ${targetId}`;
            this.behaviorState.targetAgentId = targetId;
          }
        } else if (decision.killTarget) {
          // No callback set, just track intent
          console.log(`[KILL-ACTION] ${this.config.name} no callback set - tracking intent only`);
          this.behaviorState.targetAgentId = decision.killTarget;
          this.behaviorState.currentGoal = `Kill target: ${decision.killTarget}`;
        } else {
          console.log(`[KILL-ACTION] ${this.config.name} KILL goal but no target specified!`);
        }
        break;
        
      case 'HUNT':
        await this.huntForTarget();
        break;
        
      case 'SELF_REPORT':
        this.selfReport();
        break;
        
      case 'FLEE_BODY':
        await this.fleeFromBody();
        break;
        
      case 'CREATE_ALIBI':
        await this.createAlibi();
        break;
        
      case 'IDLE':
      default:
        this.behaviorState.idleTimeRemaining = 2000 + Math.random() * 3000;
        this.behaviorState.nextDecisionTime = Date.now() + this.behaviorState.idleTimeRemaining;
        this.behaviorState.currentGoal = 'Waiting';
        break;
    }
  }
  
  /**
   * Fallback decision when AI is unavailable
   */
  private fallbackDecision(): AIDecision {
    const nextTaskIndex = this.findNextTask();
    
    if (nextTaskIndex !== -1) {
      return {
        goalType: 'GO_TO_TASK',
        targetTaskIndex: nextTaskIndex,
        reasoning: 'Working on tasks'
      };
    }
    
    return {
      goalType: 'WANDER',
      reasoning: 'All tasks done, exploring'
    };
  }
  
  // ========== Action Execution ==========
  
  /**
   * Navigate to a task location
   */
  private async goToTask(taskIndex: number, attemptedTasks: Set<number> = new Set()): Promise<void> {
    if (taskIndex < 0 || taskIndex >= this.aiState.assignedTasks.length) {
      this.wanderRandomly();
      return;
    }

    const task = this.aiState.assignedTasks[taskIndex];
    if (task.isCompleted) {
      // Find next incomplete task
      const nextIndex = this.findNextTask();
      if (nextIndex !== -1) {
        return this.goToTask(nextIndex, attemptedTasks);
      }
      this.wanderRandomly();
      return;
    }

    this.behaviorState.targetTaskIndex = taskIndex;
    this.aiState.currentTaskIndex = taskIndex;

    const success = this.navigateTo(task.position);
    if (success) {
      this.behaviorState.currentGoal = `Going to ${task.taskType} in ${task.room}`;
    } else {
      // Can't path to this task - try another task first
      attemptedTasks.add(taskIndex);
      console.warn(`[${this.config.id}] Cannot reach task ${task.taskType} in ${task.room}, trying alternatives...`);
      
      // Try to find another reachable task
      for (let i = 0; i < this.aiState.assignedTasks.length; i++) {
        if (attemptedTasks.has(i)) continue;
        const altTask = this.aiState.assignedTasks[i];
        if (altTask.isCompleted) continue;
        
        // Test if we can reach this task
        const currentPos = this.movementController.getPosition();
        const testPath = this.pathfinder.findPath(currentPos, altTask.position);
        if (testPath.success) {
          console.log(`[${this.config.id}] Found reachable alternative task: ${altTask.taskType} in ${altTask.room}`);
          return this.goToTask(i, attemptedTasks);
        }
        attemptedTasks.add(i);
      }
      
      // No reachable tasks - wander to a safe location
      console.warn(`[${this.config.id}] No reachable tasks found, wandering instead`);
      this.wanderRandomly();
    }
  }  /**
   * Follow another agent
   */
  private async followAgent(agentId: string | undefined): Promise<void> {
    if (!agentId) {
      this.wanderRandomly();
      return;
    }
    
    const target = this.otherAgents.find(a => a.getId() === agentId);
    if (!target) {
      this.wanderRandomly();
      return;
    }
    
    this.behaviorState.targetAgentId = agentId;
    const success = this.navigateTo(target.getPosition());
    
    if (success) {
      this.behaviorState.currentGoal = `Following ${agentId}`;
    } else {
      this.wanderRandomly();
    }
  }
  
  /**
   * Move away from an agent
   */
  private async avoidAgent(agentId: string | undefined): Promise<void> {
    if (!agentId) {
      this.wanderRandomly();
      return;
    }
    
    // Find a direction away from the agent
    const target = this.otherAgents.find(a => a.getId() === agentId);
    if (!target) {
      this.wanderRandomly();
      return;
    }
    
    // Move in opposite direction
    const myPos = this.getPosition();
    const theirPos = target.getPosition();
    const dx = myPos.x - theirPos.x;
    const dy = myPos.y - theirPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    
    // Try to move ~200 units away
    const escapePoint: Point = {
      x: myPos.x + (dx / dist) * 200,
      y: myPos.y + (dy / dist) * 200
    };
    
    // Find nearest walkable point
    const destination = this.destinationSelector.selectRandomDestination(
      escapePoint,
      this.zones,
      { avoidEdges: true }
    );
    
    if (destination) {
      this.navigateTo(destination);
      this.behaviorState.currentGoal = `Avoiding ${agentId}`;
    } else {
      this.wanderRandomly();
    }
  }
  
  // ========== Social Actions ==========
  
  /**
   * Buddy up with another agent for safety
   */
  private async buddyUp(agentId: string | undefined): Promise<void> {
    if (!agentId) {
      // Find a trusted (low suspicion) agent to buddy with
      const trusted = this.memory.getLeastSuspicious(3);
      const available = trusted.find(t => 
        this.aiState.visibleAgentIds.includes(t.agentId) && t.level < 60
      );
      if (available) {
        agentId = available.agentId;
      }
    }
    
    if (!agentId) {
      this.wanderRandomly();
      return;
    }
    
    const target = this.otherAgents.find(a => a.getId() === agentId);
    if (!target) {
      this.wanderRandomly();
      return;
    }
    
    this.behaviorState.buddyId = agentId;
    this.behaviorState.targetAgentId = agentId;
    const success = this.navigateTo(target.getPosition());
    
    if (success) {
      this.behaviorState.currentGoal = `Buddying with ${target.getName()}`;
      // Maybe say something social
      if (Math.random() < 0.4) {
        this.speak(`Hey ${target.getName()}, let's stick together!`);
      }
    } else {
      this.wanderRandomly();
    }
  }
  
  /**
   * Confront a suspicious agent
   */
  private async confrontAgent(agentId: string | undefined, accusation?: string): Promise<void> {
    if (!agentId) {
      // Find most suspicious visible agent
      const suspicious = this.memory.getMostSuspicious(3);
      const target = suspicious.find(s => 
        this.aiState.visibleAgentIds.includes(s.agentId) && s.level > 65
      );
      if (target) {
        agentId = target.agentId;
        const topReason = target.reasons[target.reasons.length - 1];
        accusation = topReason?.reason ?? 'acting suspicious';
      }
    }
    
    if (!agentId) {
      this.wanderRandomly();
      return;
    }
    
    const target = this.otherAgents.find(a => a.getId() === agentId);
    if (!target) {
      this.wanderRandomly();
      return;
    }
    
    this.behaviorState.confrontationTarget = agentId;
    this.behaviorState.targetAgentId = agentId;
    
    // Navigate toward them
    const distance = this.distanceTo(target.getPosition());
    if (distance > 100) {
      const success = this.navigateTo(target.getPosition());
      if (success) {
        this.behaviorState.currentGoal = `Confronting ${target.getName()}`;
      }
    }
    
    // If close enough, speak the accusation
    if (distance <= 150) {
      const message = accusation 
        ? `${target.getName()}, you've been ${accusation}. What's going on?`
        : `${target.getName()}, I've got my eye on you. You're acting sus.`;
      this.speak(message);
      
      // Record accusation in memory
      this.memory.recordAccusation({
        accuserId: this.config.id,
        accuserName: this.config.name,
        accusedId: agentId,
        accusedName: target.getName(),
        reason: accusation ?? 'suspicious behavior',
        zone: this.getCurrentZone(),
        resolved: false,
      });
      
      this.behaviorState.lastSocialActionTime = Date.now();
      this.behaviorState.nextDecisionTime = Date.now() + 3000;
    }
  }
  
  /**
   * Spread a rumor about another agent
   */
  private spreadRumor(rumor?: string, aboutAgentId?: string): void {
    if (!rumor && aboutAgentId) {
      const suspicious = this.memory.getSuspicionRecord(aboutAgentId);
      if (suspicious && suspicious.level > 50) {
        const topReason = suspicious.reasons[suspicious.reasons.length - 1];
        rumor = `I saw ${suspicious.agentName} ${topReason?.reason ?? 'being suspicious'}`;
      }
    }
    
    if (!rumor) {
      // No rumor to spread, just make small talk
      this.speak("Anyone see anything suspicious?");
    } else {
      this.speak(rumor);
      
      // If impostor, track the lie
      if (this.aiState.role === 'IMPOSTOR') {
        this.memory.recordMyLie(rumor);
      }
    }
    
    this.behaviorState.lastSocialActionTime = Date.now();
    this.behaviorState.nextDecisionTime = Date.now() + 2500;
  }
  
  /**
   * Defend yourself against accusations
   */
  private defendSelf(defense?: string): void {
    if (!defense) {
      // Generate a basic alibi
      const zone = this.getCurrentZone();
      const taskIndex = this.findLastCompletedTask();
      if (taskIndex !== -1) {
        const task = this.aiState.assignedTasks[taskIndex];
        defense = `I was just at ${task.room} doing ${task.taskType}!`;
      } else {
        defense = `I was just in ${zone ?? 'here'} the whole time!`;
      }
    }
    
    this.speak(defense);
    
    // Record alibi
    this.memory.recordAlibi({
      agentId: this.config.id,
      agentName: this.config.name,
      claimedZone: this.getCurrentZone() ?? 'unknown',
      claimedActivity: defense,
      timeRange: { start: Date.now() - 30000, end: Date.now() },
    });
    
    this.behaviorState.lastSocialActionTime = Date.now();
    this.behaviorState.nextDecisionTime = Date.now() + 2000;
  }
  
  // ========== Kill Actions (Impostor Only) ==========
  
  /**
   * Attempt to kill a target (called by KillSystem via callback)
   * This method handles the impostor's state during and after a kill
   */
  onKillSuccess(victimId: string, victimName: string, position: Point): void {
    if (this.aiState.role !== 'IMPOSTOR') return;
    
    const now = Date.now();
    
    // Update behavior state
    this.behaviorState.isInKillAnimation = true;
    this.behaviorState.killAnimationEndTime = now + 500; // 0.5s animation
    this.behaviorState.lastKillPosition = { ...position };
    this.behaviorState.recentKillTimestamp = now;
    
    // Stop movement during kill animation
    this.movementController.stop();
    this.stateMachine.transitionTo(PlayerActivityState.IDLE, 'Kill animation');
    
    // Add to memory/events
    this.addRecentEvent(`Killed ${victimName}`);
    this.memory.recordMyLie(`I wasn't near ${victimName}`); // Pre-record potential alibi lie
    
    console.log(`[${this.config.id}] Kill animation started for ${victimName}`);
    
    // Force immediate decision after kill animation
    this.behaviorState.nextDecisionTime = now + 600;
  }
  
  /**
   * Check if currently in kill animation
   */
  isInKillAnimation(): boolean {
    if (!this.behaviorState.isInKillAnimation) return false;
    
    // Check if animation time has passed
    if (Date.now() >= this.behaviorState.killAnimationEndTime) {
      this.behaviorState.isInKillAnimation = false;
      return false;
    }
    
    return true;
  }
  
  /**
   * Hunt for isolated targets (impostor AI action)
   */
  private async huntForTarget(): Promise<void> {
    // Find isolated targets
    const myPos = this.getPosition();
    const isolatedTargets: Array<{ id: string; name: string; distance: number; witnessRisk: number }> = [];
    
    for (const other of this.otherAgents) {
      if (other.getRole() === 'IMPOSTOR') continue;
      if (other.getPlayerState() !== 'ALIVE') continue;
      
      const otherPos = other.getPosition();
      const distance = this.distanceTo(otherPos);
      
      // Calculate witness risk - how many others can see this location
      let witnessRisk = 0;
      for (const witness of this.otherAgents) {
        if (witness.getId() === other.getId() || witness.getId() === this.config.id) continue;
        if (witness.getPlayerState() !== 'ALIVE') continue;
        
        const witnessDistance = Math.sqrt(
          Math.pow(witness.getPosition().x - otherPos.x, 2) +
          Math.pow(witness.getPosition().y - otherPos.y, 2)
        );
        
        if (witnessDistance < witness.getVisionRadius()) {
          witnessRisk += 1;
        }
      }
      
      isolatedTargets.push({
        id: other.getId(),
        name: other.getName(),
        distance,
        witnessRisk,
      });
    }
    
    // Sort by isolation (lowest witness risk first), then by distance
    isolatedTargets.sort((a, b) => {
      if (a.witnessRisk !== b.witnessRisk) return a.witnessRisk - b.witnessRisk;
      return a.distance - b.distance;
    });
    
    if (isolatedTargets.length > 0 && isolatedTargets[0].witnessRisk < 2) {
      // Found an isolated target - move toward them
      const target = this.otherAgents.find(a => a.getId() === isolatedTargets[0].id);
      if (target) {
        this.behaviorState.targetAgentId = target.getId();
        const success = this.navigateTo(target.getPosition());
        if (success) {
          this.behaviorState.currentGoal = `Hunting ${target.getName()}`;
          return;
        }
      }
    }
    
    // No good target - wander and look for opportunity
    this.wanderRandomly();
  }
  
  /**
   * Flee from the body after a kill
   */
  private async fleeFromBody(): Promise<void> {
    if (!this.behaviorState.lastKillPosition) {
      this.wanderRandomly();
      return;
    }
    
    const bodyPos = this.behaviorState.lastKillPosition;
    const myPos = this.getPosition();
    
    // Calculate direction away from body
    const dx = myPos.x - bodyPos.x;
    const dy = myPos.y - bodyPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    
    // Try to move 300 units away
    const escapePoint: Point = {
      x: myPos.x + (dx / dist) * 300,
      y: myPos.y + (dy / dist) * 300,
    };
    
    // Find nearest walkable point in that direction
    const destination = this.destinationSelector.selectRandomDestination(
      escapePoint,
      this.zones,
      { avoidEdges: true }
    );
    
    if (destination) {
      const success = this.navigateTo(destination);
      if (success) {
        this.behaviorState.currentGoal = 'Getting distance from body';
        return;
      }
    }
    
    this.wanderRandomly();
  }
  
  /**
   * Self-report own kill
   */
  private selfReport(): void {
    // In a real implementation, this would trigger the report system
    // For now, we just simulate the speech
    this.speak("BODY! I found a body!");
    this.behaviorState.currentGoal = 'Self-reporting';
    this.behaviorState.nextDecisionTime = Date.now() + 3000;
    
    // Record the self-report lie
    this.memory.recordMyLie("I just found this body");
    
    this.addRecentEvent('Self-reported the body');
  }
  
  /**
   * Create alibi after kill - move toward task or witness
   */
  private async createAlibi(): Promise<void> {
    // Find nearest task to look busy
    const nextTask = this.findNextTask();
    if (nextTask !== -1) {
      await this.goToTask(nextTask);
      this.behaviorState.currentGoal = 'Creating alibi at task';
      return;
    }
    
    // Or move toward other players
    if (this.otherAgents.length > 0) {
      const aliveOthers = this.otherAgents.filter(a => 
        a.getRole() !== 'IMPOSTOR' && a.getPlayerState() === 'ALIVE'
      );
      
      if (aliveOthers.length > 0) {
        const target = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
        const success = this.navigateTo(target.getPosition());
        if (success) {
          this.behaviorState.currentGoal = `Creating alibi with ${target.getName()}`;
          return;
        }
      }
    }
    
    this.wanderRandomly();
  }
  
  // ========== Witness System ==========
  
  /**
   * Record witnessing a kill
   */
  witnessKill(
    victimId: string,
    victimName: string,
    suspectedKillerColor: number | null,
    colorConfidence: number,
    sawDirectly: boolean
  ): void {
    this.aiState.witnessedKill = {
      timestamp: Date.now(),
      victimId,
      victimName,
      suspectedKillerColor,
      colorConfidence,
      location: this.getCurrentZone(),
      sawKillDirectly: sawDirectly,
    };
    
    // Add to recent events
    if (sawDirectly) {
      this.addRecentEvent(`SAW KILL! ${victimName} was murdered!`);
    } else {
      this.addRecentEvent(`Heard something... ${victimName} might be in danger`);
    }
    
    // Massive suspicion increase if we saw the killer
    if (suspectedKillerColor !== null && colorConfidence > 0.5) {
      // Try to find agent with that color
      for (const agent of this.otherAgents) {
        if (agent.getColor() === suspectedKillerColor) {
          const suspicionIncrease = Math.floor(50 * colorConfidence);
          this.memory.adjustSuspicion(
            agent.getId(),
            agent.getName(),
            suspicionIncrease,
            sawDirectly ? 'SAW THEM KILL' : 'Was near the murder',
            'witnessed_kill'
          );
          break;
        }
      }
    }
    
    // Force immediate decision - need to react
    this.behaviorState.nextDecisionTime = Date.now();
    this.behaviorState.isThinking = false;
  }
  
  /**
   * Update visible bodies list
   */
  updateVisibleBodies(bodies: Array<{
    id: string;
    victimName: string;
    victimColor: number;
    position: Point;
    zone: string | null;
  }>): void {
    const myPos = this.getPosition();
    
    this.aiState.visibleBodies = bodies
      .filter(body => {
        const dist = Math.sqrt(
          Math.pow(body.position.x - myPos.x, 2) +
          Math.pow(body.position.y - myPos.y, 2)
        );
        return dist <= this.config.visionRadius;
      })
      .map(body => ({
        ...body,
        distance: Math.sqrt(
          Math.pow(body.position.x - myPos.x, 2) +
          Math.pow(body.position.y - myPos.y, 2)
        ),
      }));
    
    // React to seeing a body for the first time
    if (this.aiState.visibleBodies.length > 0) {
      const nearestBody = this.aiState.visibleBodies[0];
      if (!this.aiState.recentEvents.some(e => e.includes(`Found body: ${nearestBody.victimName}`))) {
        this.addRecentEvent(`Found body: ${nearestBody.victimName}`);
        // Force reaction
        this.behaviorState.nextDecisionTime = Date.now();
      }
    }
  }
  
  /**
   * Set player state (ALIVE, DEAD, GHOST)
   */
  setPlayerState(state: PlayerState): void {
    this.aiState.playerState = state;
    
    if (state === 'DEAD') {
      // Stop all activity
      this.movementController.stop();
      this.stateMachine.transitionTo(PlayerActivityState.IDLE, 'Dead');
      this.behaviorState.currentGoal = null;
      this.aiState.isDoingTask = false;
    }
  }
  
  /**
   * Find the index of the last completed task
   */
  private findLastCompletedTask(): number {
    for (let i = this.aiState.assignedTasks.length - 1; i >= 0; i--) {
      if (this.aiState.assignedTasks[i].isCompleted) {
        return i;
      }
    }
    return -1;
  }
  
  /**
   * Wander to a random location - with fallback to nav nodes if standard wander fails
   */
  private wanderRandomly(attemptCount: number = 0): void {
    const currentPosition = this.movementController.getPosition();
    const MAX_WANDER_ATTEMPTS = 5;

    // First try normal destination selection
    const destination = this.destinationSelector.selectRandomDestination(
      currentPosition,
      this.zones,
      {
        preferRooms: Math.random() > 0.3,
        avoidEdges: true,
        minDistanceFromCurrent: Math.max(50, 100 - attemptCount * 20) // Reduce distance requirement on retries
      }
    );

    if (destination) {
      const success = this.navigateTo(destination);
      if (success) {
        this.behaviorState.currentGoal = 'Exploring';
        return;
      }
    }

    // Destination selection or navigation failed - try to find any reachable nav node
    if (attemptCount < MAX_WANDER_ATTEMPTS) {
      // Retry with different parameters
      this.wanderRandomly(attemptCount + 1);
      return;
    }

    // Last resort: try to navigate to nearest reachable nav node
    const escapeNode = this.pathfinder.findNearestReachableNode(currentPosition);
    if (escapeNode && escapeNode.distance > 10) {
      console.log(`[${this.config.id}] Wander failed, escaping to nearest nav node at (${escapeNode.node.position.x.toFixed(1)}, ${escapeNode.node.position.y.toFixed(1)})`);
      const success = this.navigateTo(escapeNode.node.position);
      if (success) {
        this.behaviorState.currentGoal = 'Finding safe position';
        return;
      }
    }

    // Complete failure - log and wait for next decision cycle
    console.warn(`[${this.config.id}] Cannot find any reachable destination from (${currentPosition.x.toFixed(1)}, ${currentPosition.y.toFixed(1)})`);
    this.behaviorState.nextDecisionTime = Date.now() + 2000;
    this.stateMachine.transitionTo(PlayerActivityState.IDLE, 'No reachable destination');
  }  /**
   * Navigate to a specific point
   */
  private navigateTo(destination: Point): boolean {
    const currentPosition = this.movementController.getPosition();

    const pathResult = this.pathfinder.findPath(currentPosition, destination);

    if (!pathResult.success || pathResult.path.length === 0) {
      // Enhanced logging with diagnostic info
      const reason = pathResult.failureReason ?? 'Unknown reason';
      const debug = pathResult.debugInfo;
      console.warn(`[${this.config.id}] Path not found: ${reason}`);
      if (debug) {
        console.warn(`[${this.config.id}] Debug: startWalkable=${debug.startWalkable}, endWalkable=${debug.endWalkable}, startConn=${debug.startConnections}, endConn=${debug.endConnections}, explored=${debug.nodesExplored}`);
      }
      return false;
    }

    const smoothPath = this.pathSmoother.smoothPath(pathResult.path);
    this.movementController.setPath(smoothPath);
    this.stateMachine.transitionTo(PlayerActivityState.WALKING, 'Navigating');

    return true;
  }  // ========== Task System ==========
  
  /**
   * Find next incomplete task
   */
  private findNextTask(): number {
    return this.aiState.assignedTasks.findIndex(t => !t.isCompleted);
  }
  
  /**
   * Start doing the current task
   */
  private startTask(): void {
    const taskIndex = this.aiState.currentTaskIndex;
    if (taskIndex === null || taskIndex < 0) return;
    
    const task = this.aiState.assignedTasks[taskIndex];
    if (!task || task.isCompleted) return;
    
    this.aiState.isDoingTask = true;
    this.aiState.taskStartTime = Date.now();
    task.startedAt = Date.now();
    
    this.stateMachine.transitionTo(PlayerActivityState.DOING_TASK, `Doing ${task.taskType}`);
    this.behaviorState.currentGoal = `Doing ${task.taskType}`;
    
    this.addRecentEvent(`Started task: ${task.taskType}`);
    console.log(`[${this.config.id}] Started task: ${task.taskType} (${task.duration}ms)`);
  }
  
  /**
   * Update task progress and check completion
   */
  private updateTaskProgress(now: number): void {
    const taskIndex = this.aiState.currentTaskIndex;
    if (taskIndex === null || !this.aiState.taskStartTime) return;
    
    const task = this.aiState.assignedTasks[taskIndex];
    if (!task) return;
    
    const elapsed = now - this.aiState.taskStartTime;
    
    if (elapsed >= task.duration) {
      this.completeTask();
    }
  }
  
  /**
   * Complete the current task
   */
  private completeTask(): void {
    const taskIndex = this.aiState.currentTaskIndex;
    if (taskIndex === null) return;
    
    const task = this.aiState.assignedTasks[taskIndex];
    if (!task) return;
    
    // Mark task as completed
    task.isCompleted = true;
    task.completedAt = Date.now();
    
    this.aiState.isDoingTask = false;
    this.aiState.taskStartTime = null;
    this.aiState.currentTaskIndex = null;
    
    this.stateMachine.transitionTo(PlayerActivityState.IDLE, 'Task completed');
    
    const completedCount = this.aiState.assignedTasks.filter(t => t.isCompleted).length;
    this.addRecentEvent(`Completed task: ${task.taskType}`);
    console.log(`[${this.config.id}] Completed task: ${task.taskType} (${completedCount}/${this.aiState.assignedTasks.length})`);
    
    // Small delay before next decision
    this.behaviorState.idleTimeRemaining = 1000 + Math.random() * 2000;
    this.behaviorState.nextDecisionTime = Date.now() + this.behaviorState.idleTimeRemaining;
    this.behaviorState.currentGoal = null;
  }
  
  // ========== Arrival & Events ==========
  
  /**
   * Called when agent arrives at destination
   */
  private onArriveAtDestination(): void {
    // Check if we arrived at a task
    if (this.behaviorState.currentGoalType === 'GO_TO_TASK' && this.aiState.currentTaskIndex !== null) {
      const task = this.aiState.assignedTasks[this.aiState.currentTaskIndex];
      if (task && !task.isCompleted) {
        const dist = this.distanceTo(task.position);
        if (dist < this.config.actionRadius) {
          this.startTask();
          return;
        }
      }
    }
    
    // Not at task or task already done
    this.stateMachine.transitionTo(PlayerActivityState.IDLE, 'Arrived at destination');
    this.behaviorState.currentGoal = null;
    this.behaviorState.targetTaskIndex = null;
    this.behaviorState.targetAgentId = null;
    
    this.behaviorState.idleTimeRemaining = this.randomIdleTime();
    this.behaviorState.nextDecisionTime = Date.now() + this.behaviorState.idleTimeRemaining;
    
    this.addRecentEvent('Arrived at destination');
  }
  
  /**
   * Handle movement stuck - attempts escape to nearest nav node
   */
  private handleMovementStuck(): void {
    const currentPos = this.movementController.getPosition();
    const currentZone = this.getCurrentZone() ?? 'unknown';
    
    console.warn(`[${this.config.id}] Movement stuck at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}) in ${currentZone}`);
    
    this.movementController.stop();
    this.movementController.clearStuck();
    
    // Try to escape to nearest reachable navigation node
    const escapeTarget = this.pathfinder.findNearestReachableNode(currentPos);
    
    if (escapeTarget && escapeTarget.distance > 5) {
      console.log(`[${this.config.id}] Attempting escape to nearest nav node at (${escapeTarget.node.position.x.toFixed(1)}, ${escapeTarget.node.position.y.toFixed(1)}), distance: ${escapeTarget.distance.toFixed(1)}`);
      
      // Try to navigate to the escape point
      const pathResult = this.pathfinder.findPath(currentPos, escapeTarget.node.position);
      
      if (pathResult.success && pathResult.path.length > 0) {
        const smoothPath = this.pathSmoother.smoothPath(pathResult.path);
        this.movementController.setPath(smoothPath);
        this.stateMachine.transitionTo(PlayerActivityState.WALKING, 'Escaping stuck position');
        this.behaviorState.currentGoal = 'Escaping stuck position';
        this.behaviorState.nextDecisionTime = Date.now() + 3000; // Give time to escape
        return;
      } else {
        console.warn(`[${this.config.id}] Escape path failed: ${pathResult.failureReason ?? 'Unknown'}`);
      }
    }
    
    // Fallback: just reset to idle and let the AI pick a new destination
    this.stateMachine.transitionTo(PlayerActivityState.IDLE, 'Movement stuck - no escape path');
    this.behaviorState.currentGoal = null;
    this.behaviorState.idleTimeRemaining = 0;
    this.behaviorState.nextDecisionTime = Date.now() + 250;
  }
  
  // ========== AI Triggers ==========
  
  /**
   * Process AI triggers for thoughts and speech (fire-and-forget)
   */
  private processTriggersAsync(): void {
    if (!this.triggerCallback) return;
    
    this.behaviorState.isThinking = true;
    // Fire and forget - don't block the update loop
    this.processTriggers().catch(() => {
      // Silently fail on trigger processing
    }).finally(() => {
      this.behaviorState.isThinking = false;
    });
  }
  
  /**
   * Actually process triggers (async)
   */
  private async processTriggers(): Promise<void> {
    if (!this.triggerCallback) return;

    const context = this.buildAIContext();
    
    // Include pending conversation reply info for the trigger callback
    if (this.shouldRespondToConversation && this.pendingConversationReply) {
      // Pass conversation context to the trigger callback
      const pendingReply = this.pendingConversationReply;
      (context as AIContext & { pendingReply?: { speakerId: string; speakerName: string; message: string; zone: string | null; timestamp: number } }).pendingReply = pendingReply;
    }
    
    const result = await this.triggerCallback(context);

    if (result.thought) {
      this.aiState.currentThought = result.thought.thought;
      this.aiState.lastThoughtTime = Date.now();
    }
    
    if (result.speech) {
      this.speak(result.speech.message);
      
      // If we had a pending conversation, clear it after speaking
      if (this.shouldRespondToConversation && this.pendingConversationReply) {
        this.pendingConversationReply = null;
        this.shouldRespondToConversation = false;
      }
    }
    
    // Clear old pending replies (older than 10 seconds)
    if (this.pendingConversationReply && Date.now() - this.pendingConversationReply.timestamp > 10000) {
      this.pendingConversationReply = null;
      this.shouldRespondToConversation = false;
    }
  }  // ========== Speech ==========
  
  /**
   * Say something out loud
   */
  speak(message: string): void {
    this.aiState.recentSpeech = message;
    this.aiState.lastSpeechTime = Date.now();
    console.log(`[${this.config.id}] Says: "${message}"`);
    
    // Broadcast speech to nearby agents
    if (this.speechBroadcastCallback) {
      this.speechBroadcastCallback(this.config.id, message, this.getCurrentZone());
    }
    
    // Record our own speech
    this.memory.recordConversation({
      speakerId: this.config.id,
      speakerName: this.config.name,
      message,
      zone: this.getCurrentZone(),
      topic: this.memory['analyzeMessageTopic'](message), // Access private method
    });
  }
  
  // ========== Context Building ==========
  
  /**
   * Build AI context for LLM calls
   */
  private buildAIContext(): AIContext {
    const position = this.getPosition();
    const visibleAgents = this.otherAgents
      .filter(a => this.aiState.visibleAgentIds.includes(a.getId()))
      .map(a => ({
        id: a.getId(),
        name: a.getName(),
        zone: a.getCurrentZone(),
        distance: this.distanceTo(a.getPosition()),
        activityState: a.getStateMachine().getActivityState() as string,
        // Only show role to fellow impostors
        role: (this.aiState.role === 'IMPOSTOR' && a.getRole() === 'IMPOSTOR') ? ('IMPOSTOR' as const) : undefined,
        isAlive: a.getPlayerState() === 'ALIVE',
      }));
    
    // Get recent conversations from memory
    const recentConvs = this.memory.getRecentConversations(5).map(c => ({
      speakerName: c.speakerName,
      message: c.message,
      timestamp: c.timestamp,
    }));
    
    // Build base context
    const context: AIContext = {
      agentId: this.config.id,
      agentName: this.config.name,
      role: this.aiState.role,
      currentZone: this.stateMachine.getCurrentZone(),
      currentPosition: position,
      assignedTasks: this.aiState.assignedTasks,
      currentTaskIndex: this.aiState.currentTaskIndex,
      visibleAgents,
      suspicionLevels: this.memory.getAllSuspicionLevels(),
      recentEvents: this.aiState.recentEvents.slice(-10),
      canSpeakTo: this.aiState.agentsInSpeechRange,
      // Memory context
      memoryContext: this.memory.buildMemoryContext(),
      suspicionContext: this.memory.buildSuspicionContext(),
      recentConversations: recentConvs,
      isBeingFollowed: this.behaviorState.isBeingFollowed,
      buddyId: this.behaviorState.buddyId,
      // Visible bodies
      visibleBodies: this.aiState.visibleBodies,
      // Witness memory
      witnessMemory: this.aiState.witnessedKill ? {
        sawKill: this.aiState.witnessedKill.sawKillDirectly,
        sawBody: true,
        suspectedKillerColor: this.aiState.witnessedKill.suspectedKillerColor,
        colorConfidence: this.aiState.witnessedKill.colorConfidence,
        location: this.aiState.witnessedKill.location,
        timestamp: this.aiState.witnessedKill.timestamp,
      } : null,
    };
    
    // Add impostor-specific context
    if (this.aiState.role === 'IMPOSTOR') {
      context.impostorContext = this.buildImpostorContext();
    }
    
    return context;
  }
  
  /**
   * Build impostor-specific context for AI decisions
   */
  private buildImpostorContext(): AIContext['impostorContext'] {
    const killCooldownRemaining = this.getKillCooldownRemaining();
    // Use the method instead of direct property access - the method properly clears the flag after animation time
    const canKill = killCooldownRemaining <= 0 && !this.isInKillAnimation();
    
    // Find targets in kill range
    const KILL_RANGE = 90; // Medium kill range
    const targetsInKillRange = this.otherAgents
      .filter(a => 
        a.getRole() !== 'IMPOSTOR' && 
        a.getPlayerState() === 'ALIVE' &&
        this.distanceTo(a.getPosition()) <= KILL_RANGE
      )
      .map(a => {
        const distance = this.distanceTo(a.getPosition());
        
        // Calculate isolation - how many witnesses could see
        let witnessCount = 0;
        for (const witness of this.otherAgents) {
          if (witness.getId() === a.getId() || witness.getId() === this.config.id) continue;
          if (witness.getPlayerState() !== 'ALIVE') continue;
          
          const witnessDistance = Math.sqrt(
            Math.pow(witness.getPosition().x - a.getPosition().x, 2) +
            Math.pow(witness.getPosition().y - a.getPosition().y, 2)
          );
          
          if (witnessDistance < witness.getVisionRadius()) {
            witnessCount++;
          }
        }
        
        return {
          id: a.getId(),
          name: a.getName(),
          distance,
          isIsolated: witnessCount === 0,
          zone: a.getCurrentZone(),
        };
      });
    
    // Find fellow impostors (with names for UI display)
    const fellowImpostors = this.otherAgents
      .filter(a => a.getRole() === 'IMPOSTOR')
      .map(a => ({ id: a.getId(), name: a.getName() }));
    
    // Find nearby bodies (for self-report consideration)
    const nearbyBodies = this.aiState.visibleBodies.map(b => ({
      id: b.id,
      victimName: b.victimName,
      distance: b.distance,
      zone: b.zone,
    }));
    
    return {
      killCooldownRemaining,
      canKill,
      targetsInKillRange,
      recentKillTime: this.behaviorState.recentKillTimestamp,
      killCount: this.getKillCount(),
      fellowImpostors,
      nearbyBodies,
    };
  }
  
  /**
   * Get kill cooldown remaining (placeholder - will be connected to KillSystem)
   */
  private getKillCooldownRemaining(): number {
    // This will be set by the KillSystem via the manager
    // For now, calculate based on last kill time
    if (!this.behaviorState.recentKillTimestamp) {
      return 0; // No kill yet, no cooldown
    }
    
    const KILL_COOLDOWN = 25; // 25 seconds
    const elapsed = (Date.now() - this.behaviorState.recentKillTimestamp) / 1000;
    return Math.max(0, KILL_COOLDOWN - elapsed);
  }
  
  /**
   * Get total kill count (placeholder)
   */
  private getKillCount(): number {
    // This will be tracked by KillSystem
    // Count kills from recent events as a rough estimate
    return this.aiState.recentEvents.filter(e => e.startsWith('Killed ')).length;
  }
  
  // ========== Helpers ==========
  
  private addRecentEvent(event: string): void {
    this.aiState.recentEvents.push(event);
    if (this.aiState.recentEvents.length > 20) {
      this.aiState.recentEvents.shift();
    }
  }
  
  private randomIdleTime(): number {
    return 2000 + Math.random() * 4000;
  }
  
  // ========== Getters ==========
  
  getPosition(): Point {
    return this.movementController.getPosition();
  }
  
  getFacing(): number {
    return this.movementController.getFacing();
  }
  
  getCurrentPath(): Point[] {
    return this.movementController.getRemainingPath();
  }
  
  getId(): string {
    return this.config.id;
  }
  
  getName(): string {
    return this.config.name;
  }
  
  getColor(): number {
    return this.config.color;
  }
  
  getVisionRadius(): number {
    return this.config.visionRadius;
  }
  
  getActionRadius(): number {
    return this.config.actionRadius;
  }
  
  getStateMachine(): PlayerStateMachine {
    return this.stateMachine;
  }
  
  getMovementController(): MovementController {
    return this.movementController;
  }
  
  isMoving(): boolean {
    return this.movementController.isMoving();
  }
  
  getCurrentGoal(): string | null {
    return this.behaviorState.currentGoal;
  }
  
  getCurrentZone(): string | null {
    return this.stateMachine.getCurrentZone();
  }
  
  // AI State getters
  getRole(): PlayerRole {
    return this.aiState.role;
  }
  
  getPlayerState(): PlayerState {
    return this.aiState.playerState;
  }
  
  getAssignedTasks(): TaskAssignment[] {
    return this.aiState.assignedTasks;
  }
  
  getCurrentTaskIndex(): number | null {
    return this.aiState.currentTaskIndex;
  }
  
  getTasksCompleted(): number {
    return this.aiState.assignedTasks.filter(t => t.isCompleted && !t.isFaking).length;
  }
  
  getCurrentThought(): string | null {
    return this.aiState.currentThought;
  }
  
  getLastThoughtTime(): number {
    return this.aiState.lastThoughtTime;
  }
  
  getRecentSpeech(): string | null {
    return this.aiState.recentSpeech;
  }
  
  getLastSpeechTime(): number {
    return this.aiState.lastSpeechTime;
  }
  
  getVisibleAgentIds(): string[] {
    return this.aiState.visibleAgentIds;
  }

  getVisibleAgentNames(): string[] {
    return this.aiState.visibleAgentNames;
  }

  getSuspicionLevels(): Record<string, number> {
    return this.memory.getAllSuspicionLevels();
  }
  
  getIsThinking(): boolean {
    return this.behaviorState.isThinking;
  }
  
  getAIState(): AIAgentState {
    return this.aiState;
  }
  
  // Memory getters for UI
  getMemory(): AgentMemory {
    return this.memory;
  }
  
  getMemoryContext(): string {
    return this.memory.buildMemoryContext();
  }
  
  getSuspicionContext(): string {
    return this.memory.buildSuspicionContext();
  }
  
  getRecentConversations(): ConversationEntry[] {
    return this.memory.getRecentConversations(10);
  }
  
  getRecentObservations(): ObservationEntry[] {
    return this.memory.getRecentObservations(10);
  }
  
  getMostSuspicious(): SuspicionRecord[] {
    return this.memory.getMostSuspicious(5);
  }
  
  isBeingFollowed(): boolean {
    return this.behaviorState.isBeingFollowed;
  }
  
  getBuddyId(): string | null {
    return this.behaviorState.buddyId;
  }
}
