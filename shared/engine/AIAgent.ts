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
  agentsInSpeechRange: string[];
  
  // Internal state
  currentThought: string | null;
  lastThoughtTime: number;
  recentSpeech: string | null;
  lastSpeechTime: number;
  
  // Social
  suspicionLevels: Record<string, number>;
  recentEvents: string[];
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
  
  // AI callbacks (set by manager)
  private decisionCallback: AIDecisionCallback | null = null;
  private triggerCallback: AITriggerCallback | null = null;
  
  // Reference to other agents for visibility checks
  private otherAgents: AIAgent[] = [];
  
  constructor(
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
    
    this.behaviorState = {
      isThinking: false,
      nextDecisionTime: Date.now() + 1000 + Math.random() * 3000,
      idleTimeRemaining: 0,
      currentGoal: null,
      currentGoalType: null,
      targetTaskIndex: null,
      targetAgentId: null,
      lastTriggerCheckTime: 0
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
      agentsInSpeechRange: [],
      currentThought: null,
      lastThoughtTime: 0,
      recentSpeech: null,
      lastSpeechTime: 0,
      suspicionLevels: {},
      recentEvents: []
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
    const TRIGGER_CHECK_INTERVAL = 2000;
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
    const speechRangeIds: string[] = [];
    const speechRange = 150; // Units for speech hearing
    
    for (const other of this.otherAgents) {
      const otherPos = other.getPosition();
      const distance = this.distanceTo(otherPos);
      
      if (distance <= this.config.visionRadius) {
        visibleIds.push(other.getId());
      }
      
      if (distance <= speechRange) {
        speechRangeIds.push(other.getId());
      }
    }
    
    // Detect changes for triggers
    const newlyVisible = visibleIds.filter(id => !this.aiState.visibleAgentIds.includes(id));
    const newlyLost = this.aiState.visibleAgentIds.filter(id => !visibleIds.includes(id));
    
    if (newlyVisible.length > 0) {
      this.addRecentEvent(`Spotted: ${newlyVisible.join(', ')}`);
    }
    if (newlyLost.length > 0) {
      this.addRecentEvent(`Lost sight of: ${newlyLost.join(', ')}`);
    }
    
    this.aiState.visibleAgentIds = visibleIds;
    this.aiState.agentsInSpeechRange = speechRangeIds;
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
    this.behaviorState.isThinking = true;
    
    const currentState = this.stateMachine.getActivityState();
    
    if (currentState === PlayerActivityState.IDLE && !this.aiState.isDoingTask) {
      // Fire and forget - don't await
      this.decideNextActionAsync().catch(err => {
        console.warn(`[${this.config.id}] Decision error:`, err);
      }).finally(() => {
        this.behaviorState.isThinking = false;
      });
    } else {
      this.behaviorState.isThinking = false;
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
  private async goToTask(taskIndex: number): Promise<void> {
    if (taskIndex < 0 || taskIndex >= this.aiState.assignedTasks.length) {
      this.wanderRandomly();
      return;
    }
    
    const task = this.aiState.assignedTasks[taskIndex];
    if (task.isCompleted) {
      // Find next incomplete task
      const nextIndex = this.findNextTask();
      if (nextIndex !== -1) {
        return this.goToTask(nextIndex);
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
      // Can't path to task, try wandering
      this.wanderRandomly();
    }
  }
  
  /**
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
  
  /**
   * Wander to a random location
   */
  private wanderRandomly(): void {
    const currentPosition = this.movementController.getPosition();
    
    const destination = this.destinationSelector.selectRandomDestination(
      currentPosition,
      this.zones,
      {
        preferRooms: Math.random() > 0.3,
        avoidEdges: true,
        minDistanceFromCurrent: 100
      }
    );
    
    if (destination) {
      this.navigateTo(destination);
      this.behaviorState.currentGoal = 'Exploring';
    } else {
      this.behaviorState.nextDecisionTime = Date.now() + 2000;
    }
  }
  
  /**
   * Navigate to a specific point
   */
  private navigateTo(destination: Point): boolean {
    const currentPosition = this.movementController.getPosition();
    
    const pathResult = this.pathfinder.findPath(currentPosition, destination);
    
    if (!pathResult.success || pathResult.path.length === 0) {
      console.warn(`[${this.config.id}] Path not found to destination`);
      return false;
    }
    
    const smoothPath = this.pathSmoother.smoothPath(pathResult.path);
    this.movementController.setPath(smoothPath);
    this.stateMachine.transitionTo(PlayerActivityState.WALKING, 'Navigating');
    
    return true;
  }
  
  // ========== Task System ==========
  
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
    
    // Impostors fake-complete (mark done but doesn't count toward win)
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
   * Handle movement stuck
   */
  private handleMovementStuck(): void {
    console.warn(`[${this.config.id}] Movement stuck, replanning`);
    this.movementController.stop();
    this.movementController.clearStuck();
    this.stateMachine.transitionTo(PlayerActivityState.IDLE, 'Movement stuck');
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
    
    // Fire and forget - don't block the update loop
    this.processTriggers().catch(() => {
      // Silently fail on trigger processing
    });
  }
  
  /**
   * Actually process triggers (async)
   */
  private async processTriggers(): Promise<void> {
    if (!this.triggerCallback) return;
    
    const context = this.buildAIContext();
    const result = await this.triggerCallback(context);
    
    if (result.thought) {
      this.aiState.currentThought = result.thought.thought;
      this.aiState.lastThoughtTime = Date.now();
    }
    
    if (result.speech) {
      this.speak(result.speech.message);
    }
  }
  
  // ========== Speech ==========
  
  /**
   * Say something out loud
   */
  speak(message: string): void {
    this.aiState.recentSpeech = message;
    this.aiState.lastSpeechTime = Date.now();
    console.log(`[${this.config.id}] Says: "${message}"`);
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
        distance: this.distanceTo(a.getPosition())
      }));
    
    return {
      agentId: this.config.id,
      agentName: this.config.name,
      role: this.aiState.role,
      currentZone: this.stateMachine.getCurrentZone(),
      currentPosition: position,
      assignedTasks: this.aiState.assignedTasks,
      currentTaskIndex: this.aiState.currentTaskIndex,
      visibleAgents,
      suspicionLevels: this.aiState.suspicionLevels,
      recentEvents: this.aiState.recentEvents.slice(-5),
      canSpeakTo: this.aiState.agentsInSpeechRange
    };
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
  
  getSuspicionLevels(): Record<string, number> {
    return this.aiState.suspicionLevels;
  }
  
  getIsThinking(): boolean {
    return this.behaviorState.isThinking;
  }
  
  getAIState(): AIAgentState {
    return this.aiState;
  }
}
