/**
 * Movement Controller
 * Handles smooth movement along paths with interpolation and speed variation
 */

import type { Point } from '../data/poly3-map.ts';
import { isPointWalkable, WALKABLE_ZONES } from '../data/poly3-map.ts';
import type { SmoothPath } from './PathSmoother.ts';

export interface MovementState {
  currentPosition: Point;
  targetPosition: Point;
  path: Point[];
  pathIndex: number;
  distanceTraveled: number;
  isMoving: boolean;
  speed: number; // units per second
  facing: number; // angle in radians
}

export class MovementController {
  private state: MovementState;
  private baseSpeed: number = 100; // Default speed
  private rotationSpeed: number = 5; // Radians per second
  private debugCounter: number = 0;
  
  constructor(startPosition: Point, speed?: number) {
    // Validate starting position is walkable
    if (!isPointWalkable(startPosition.x, startPosition.y, WALKABLE_ZONES)) {
      console.error(`[MovementController] Starting position (${startPosition.x.toFixed(1)}, ${startPosition.y.toFixed(1)}) is NOT WALKABLE!`);
    }
    
    this.state = {
      currentPosition: { ...startPosition },
      targetPosition: { ...startPosition },
      path: [],
      pathIndex: 0,
      distanceTraveled: 0,
      isMoving: false,
      speed: speed || this.baseSpeed,
      facing: 0
    };
  }
  
  /**
   * Set a new path to follow
   */
  setPath(smoothPath: SmoothPath): void {
    if (smoothPath.points.length < 2) {
      console.log('Path too short:', smoothPath.points.length);
      this.state.isMoving = false;
      return;
    }
    
    console.log(`Setting path with ${smoothPath.points.length} points, speed: ${this.state.speed}`);
    console.log('Current position:', this.state.currentPosition);
    console.log('First path point:', smoothPath.points[0]);
    console.log('Last path point:', smoothPath.points[smoothPath.points.length - 1]);
    
    this.state.path = smoothPath.points;
    this.state.pathIndex = 0;
    this.state.distanceTraveled = 0;
    this.state.isMoving = true;
    this.state.targetPosition = smoothPath.points[smoothPath.points.length - 1];
    
    // Don't modify current position - let the update loop handle movement from wherever we are
  }
  
  /**
   * Update movement (call every frame)
   */
  update(deltaTime: number): void {
    if (!this.state.isMoving || this.state.path.length === 0) {
      return;
    }
    
    // Debug logging every 60 frames
    this.debugCounter++;
    if (this.debugCounter % 60 === 0) {
      const expectedDistance = this.state.speed * deltaTime;
      console.log(`[Movement] deltaTime: ${deltaTime.toFixed(4)}s, FPS: ${(1/deltaTime).toFixed(1)}, speed: ${this.state.speed.toFixed(1)}, expected: ${expectedDistance.toFixed(2)}px`);
      console.log(`[Movement] pathIndex: ${this.state.pathIndex}/${this.state.path.length - 1}, pos: (${this.state.currentPosition.x.toFixed(1)}, ${this.state.currentPosition.y.toFixed(1)})`);
    }
    
    const startPos = { ...this.state.currentPosition };
    const distanceThisFrame = this.state.speed * deltaTime;
    let remainingDistance = distanceThisFrame;
    
    // Move along the path
    while (remainingDistance > 0.001 && this.state.pathIndex < this.state.path.length - 1) {
      const segmentEnd = this.state.path[this.state.pathIndex + 1];
      
      // Calculate distance from current position to next waypoint
      const distanceToEnd = this.calculateDistance(this.state.currentPosition, segmentEnd);
      
      if (distanceToEnd < 0.001) {
        // Already at this waypoint, skip to next
        this.state.pathIndex++;
        continue;
      }
      
      if (remainingDistance >= distanceToEnd) {
        // WALL COLLISION: Validate segment endpoint is walkable before moving
        if (!isPointWalkable(segmentEnd.x, segmentEnd.y, WALKABLE_ZONES)) {
          console.warn(`[Movement] WALL COLLISION at waypoint! Position (${segmentEnd.x.toFixed(1)}, ${segmentEnd.y.toFixed(1)}) is not walkable. Stopping.`);
          this.state.isMoving = false;
          break;
        }
        
        // Move to the end of this segment
        this.state.currentPosition = { ...segmentEnd };
        remainingDistance -= distanceToEnd;
        this.state.distanceTraveled += distanceToEnd;
        this.state.pathIndex++;
        
        // Update facing for next segment
        if (this.state.pathIndex < this.state.path.length - 1) {
          const nextPoint = this.state.path[this.state.pathIndex + 1];
          const angle = Math.atan2(nextPoint.y - segmentEnd.y, nextPoint.x - segmentEnd.x);
          this.updateFacing(angle, deltaTime);
        }
      } else {
        // Move along this segment
        const direction = {
          x: (segmentEnd.x - this.state.currentPosition.x) / distanceToEnd,
          y: (segmentEnd.y - this.state.currentPosition.y) / distanceToEnd
        };
        
        // Calculate new position
        const newPosition = {
          x: this.state.currentPosition.x + direction.x * remainingDistance,
          y: this.state.currentPosition.y + direction.y * remainingDistance
        };
        
        // WALL COLLISION: Validate the new position is walkable
        if (isPointWalkable(newPosition.x, newPosition.y, WALKABLE_ZONES)) {
          this.state.currentPosition = newPosition;
          this.state.distanceTraveled += remainingDistance;
        } else {
          // Hit a wall! Stop movement and cancel path
          console.warn(`[Movement] WALL COLLISION! Position (${newPosition.x.toFixed(1)}, ${newPosition.y.toFixed(1)}) is not walkable. Stopping.`);
          this.state.isMoving = false;
          remainingDistance = 0;
          break;
        }
        
        // Update facing
        const angle = Math.atan2(direction.y, direction.x);
        this.updateFacing(angle, deltaTime);
        
        remainingDistance = 0;
      }
    }
    
    const actualDistance = this.calculateDistance(startPos, this.state.currentPosition);
    if (this.debugCounter % 60 === 0 || actualDistance > 1) {
      console.log(`[Movement] Actually moved: ${actualDistance.toFixed(2)} pixels`);
    }
    
    // Check if we've reached the end
    if (this.state.pathIndex >= this.state.path.length - 1) {
      const finalPoint = this.state.path[this.state.path.length - 1];
      const distanceToFinal = this.calculateDistance(this.state.currentPosition, finalPoint);
      
      if (distanceToFinal < 1) {
        this.state.currentPosition = { ...finalPoint };
        this.state.isMoving = false;
        console.log(`[Movement] Reached destination! Total distance: ${this.state.distanceTraveled.toFixed(1)}`);
      }
    }
  }
  
  /**
   * Smoothly rotate toward target angle
   */
  private updateFacing(targetAngle: number, deltaTime: number): void {
    // Normalize angles to -PI to PI
    const normalizeAngle = (angle: number) => {
      while (angle > Math.PI) angle -= 2 * Math.PI;
      while (angle < -Math.PI) angle += 2 * Math.PI;
      return angle;
    };
    
    const currentAngle = normalizeAngle(this.state.facing);
    const normalizedTarget = normalizeAngle(targetAngle);
    
    // Calculate shortest rotation direction
    let angleDiff = normalizedTarget - currentAngle;
    if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    
    // Smoothly interpolate
    const maxRotation = this.rotationSpeed * deltaTime;
    if (Math.abs(angleDiff) <= maxRotation) {
      this.state.facing = normalizedTarget;
    } else {
      this.state.facing = currentAngle + Math.sign(angleDiff) * maxRotation;
    }
  }
  
  /**
   * Stop movement
   */
  stop(): void {
    this.state.isMoving = false;
    this.state.path = [];
  }
  
  /**
   * Get current position
   */
  getPosition(): Point {
    return { ...this.state.currentPosition };
  }
  
  /**
   * Get facing angle (radians)
   */
  getFacing(): number {
    return this.state.facing;
  }
  
  /**
   * Get facing direction as a unit vector
   */
  getFacingVector(): Point {
    return {
      x: Math.cos(this.state.facing),
      y: Math.sin(this.state.facing)
    };
  }
  
  /**
   * Check if currently moving
   */
  isMoving(): boolean {
    return this.state.isMoving;
  }
  
  /**
   * Get movement state
   */
  getState(): MovementState {
    return { ...this.state };
  }
  
  /**
   * Set movement speed
   */
  setSpeed(speed: number): void {
    this.state.speed = speed;
  }
  
  /**
   * Get current speed
   */
  getSpeed(): number {
    return this.state.speed;
  }
  
  /**
   * Calculate distance between two points
   */
  private calculateDistance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  
  /**
   * Get progress along path (0-1)
   */
  getProgress(): number {
    if (this.state.path.length === 0) return 1;
    return this.state.pathIndex / (this.state.path.length - 1);
  }
  
  /**
   * Get remaining path points
   */
  getRemainingPath(): Point[] {
    if (!this.state.isMoving) return [];
    return this.state.path.slice(this.state.pathIndex);
  }
}
