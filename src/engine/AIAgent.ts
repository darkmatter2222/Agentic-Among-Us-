/**
 * AI Agent Controller
 * Manages AI behavior, decision making, and movement for individual agents
 */

import type { Point } from '../data/poly3-map.ts';
import { MovementController } from './MovementController.ts';
import { PlayerStateMachine, PlayerActivityState } from './PlayerStateMachine.ts';
import type { Zone } from './ZoneDetector.ts';
import type { DestinationSelector } from './DestinationSelector.ts';
import type { Pathfinder } from './Pathfinder.ts';
import { PathSmoother } from './PathSmoother.ts';

export interface AIAgentConfig {
  id: string;
  color: number;
  startPosition: Point;
  baseSpeed: number;
  visionRadius: number;
  actionRadius: number;
}

export interface AIBehaviorState {
  isThinking: boolean;
  nextDecisionTime: number;
  idleTimeRemaining: number;
  currentGoal: string | null;
}

export class AIAgent {
  private config: AIAgentConfig;
  private movementController: MovementController;
  private stateMachine: PlayerStateMachine;
  private pathfinder: Pathfinder;
  private destinationSelector: DestinationSelector;
  private pathSmoother: PathSmoother;
  private behaviorState: AIBehaviorState;
  private zones: Zone[];
  
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
      nextDecisionTime: Date.now() + 500, // Start moving quickly (500ms)
      idleTimeRemaining: 0,
      currentGoal: null
    };
  }
  
  /**
   * Update AI agent (called each frame)
   */
  update(deltaTime: number): void {
    const now = Date.now();
    
    // Update movement
    this.movementController.update(deltaTime);
    
    // Update state machine position
    const position = this.movementController.getPosition();
    this.stateMachine.updatePosition(position);
    
    // Check if movement finished
    if (this.stateMachine.isMoving() && !this.movementController.isMoving()) {
      // Arrived at destination
      this.onArriveAtDestination();
    }

    // Detect and recover from stuck movement
    if (this.stateMachine.isMoving() && this.movementController.isStuck()) {
      this.handleMovementStuck();
    }
    
    // Make decisions
    if (now >= this.behaviorState.nextDecisionTime && !this.behaviorState.isThinking) {
      this.makeDecision();
    }
    
    // Update idle countdown
    if (this.behaviorState.idleTimeRemaining > 0) {
      this.behaviorState.idleTimeRemaining -= deltaTime * 1000;
      if (this.behaviorState.idleTimeRemaining <= 0) {
        this.behaviorState.nextDecisionTime = now;
      }
    }
  }
  
  /**
   * Make a behavioral decision
   */
  private makeDecision(): void {
    this.behaviorState.isThinking = true;
    
    const currentState = this.stateMachine.getActivityState();
    
    if (currentState === PlayerActivityState.IDLE) {
      // Decide to move somewhere
      this.decideToMove();
    } else if (currentState === PlayerActivityState.WALKING) {
      // Continue walking (already handled by movement controller)
    }
    
    this.behaviorState.isThinking = false;
  }
  
  /**
   * Decide to move to a new location
   */
  private decideToMove(): void {
    const currentPosition = this.movementController.getPosition();
    
    console.log(`[${this.config.id}] Deciding to move from`, currentPosition);
    
    // Select a random destination
    const destination = this.destinationSelector.selectRandomDestination(
      currentPosition,
      this.zones,
      {
        preferRooms: Math.random() > 0.3, // 70% chance to prefer rooms
        avoidEdges: true,
        minDistanceFromCurrent: 100
      }
    );
    
    if (!destination) {
      // Couldn't find destination, try again later
      console.log(`[${this.config.id}] Could not find destination`);
      this.behaviorState.nextDecisionTime = Date.now() + 2000;
      return;
    }
    
    console.log(`[${this.config.id}] Selected destination:`, destination);
    
    // Find path to destination
    const pathResult = this.pathfinder.findPath(currentPosition, destination);
    
    if (!pathResult.success || pathResult.path.length === 0) {
      // Pathfinding failed, try again later
      console.log(`[${this.config.id}] Pathfinding failed`);
      this.behaviorState.nextDecisionTime = Date.now() + 2000;
      return;
    }
    
    console.log(`[${this.config.id}] Path found with ${pathResult.path.length} waypoints`);
    
    // Smooth the path
    const smoothPath = this.pathSmoother.smoothPath(pathResult.path);
    
    console.log(`[${this.config.id}] Smoothed path has ${smoothPath.points.length} points`);
    
    // Set movement
    this.movementController.setPath(smoothPath);
    this.stateMachine.transitionTo(PlayerActivityState.WALKING, 'Moving to destination');
    
    this.behaviorState.currentGoal = 'Walking to random location';
  }
  
  /**
   * Called when agent arrives at destination
   */
  private onArriveAtDestination(): void {
    this.stateMachine.transitionTo(PlayerActivityState.IDLE, 'Arrived at destination');
    this.behaviorState.currentGoal = null;
    
    // Idle for a random time before next decision
    this.behaviorState.idleTimeRemaining = this.randomIdleTime();
    this.behaviorState.nextDecisionTime = Date.now() + this.behaviorState.idleTimeRemaining;
  }

  /**
   * Recover from pathfinding or steering issues when agent stalls against geometry
   */
  private handleMovementStuck(): void {
    console.warn(`[${this.config.id}] Movement stuck, replanning destination`);
    this.movementController.stop();
    this.movementController.clearStuck();
    this.stateMachine.transitionTo(PlayerActivityState.IDLE, 'Movement stuck - replanning');
    this.behaviorState.currentGoal = null;
    this.behaviorState.idleTimeRemaining = 0;
    this.behaviorState.nextDecisionTime = Date.now() + 250;
  }
  
  /**
   * Generate random idle time (2-8 seconds)
   */
  private randomIdleTime(): number {
    return 2000 + Math.random() * 6000;
  }
  
  /**
   * Get current position
   */
  getPosition(): Point {
    return this.movementController.getPosition();
  }
  
  /**
   * Get facing direction (radians)
   */
  getFacing(): number {
    return this.movementController.getFacing();
  }
  
  /**
   * Get current path (for rendering)
   */
  getCurrentPath(): Point[] {
    return this.movementController.getRemainingPath();
  }
  
  /**
   * Get agent ID
   */
  getId(): string {
    return this.config.id;
  }
  
  /**
   * Get agent color
   */
  getColor(): number {
    return this.config.color;
  }
  
  /**
   * Get vision radius
   */
  getVisionRadius(): number {
    return this.config.visionRadius;
  }
  
  /**
   * Get action radius
   */
  getActionRadius(): number {
    return this.config.actionRadius;
  }
  
  /**
   * Get state machine
   */
  getStateMachine(): PlayerStateMachine {
    return this.stateMachine;
  }
  
  /**
   * Get movement controller
   */
  getMovementController(): MovementController {
    return this.movementController;
  }
  
  /**
   * Is currently moving
   */
  isMoving(): boolean {
    return this.movementController.isMoving();
  }
  
  /**
   * Get current goal description
   */
  getCurrentGoal(): string | null {
    return this.behaviorState.currentGoal;
  }
}
