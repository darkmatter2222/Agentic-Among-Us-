/**
 * Movement Controller
 * Handles smooth movement along paths with interpolation and speed variation
 */

import type { Point } from '@shared/data/poly3-map.ts';
import { isPointWalkable, WALKABLE_ZONES, OBSTACLES } from '@shared/data/poly3-map.ts';
import type { SmoothPath } from './PathSmoother.ts';
import { movementLogger } from '../logging/index.ts';

export interface MovementState {
  currentPosition: Point;
  targetPosition: Point;
  path: Point[];
  pathIndex: number;
  distanceTraveled: number;
  isMoving: boolean;
  speed: number; // preferred cruising speed (units/s)
  facing: number; // heading in radians
  velocity: Point; // current velocity (units/s)
}

export class MovementController {
  private state: MovementState;
  private readonly defaultSpeed = 100;
  private readonly mass = 1;
  private readonly waypointRadius = 18; // radius for snapping to waypoints
  private readonly arrivalRadius = 28; // radius for slowing near final goal
  private readonly lookAheadSteps = 4;
  private readonly whiskerBaseLength = 60;
  private readonly whiskerAngle = Math.PI / 5; // ~36 degrees
  private readonly whiskerStep = 6;
  private readonly avoidanceWeight = 1.4;
  private readonly damping = 6; // velocity decay when stopped
  private readonly collisionIterations = 6;
  private readonly minFacingSpeed = 5;
  private readonly stuckDistanceThreshold = 6; // min distance progress before clearing stuck timer
  private readonly stuckTimeThreshold = 1.2; // seconds before declaring stuck

  private lastProgressPosition: Point;
  private timeSinceProgress: number = 0;
  private stuck: boolean = false;
  private collisionEnabled: boolean = true; // Can be disabled for ghosts

  constructor(startPosition: Point, speed?: number) {
    if (!isPointWalkable(startPosition.x, startPosition.y, WALKABLE_ZONES, OBSTACLES)) {
      movementLogger.error('Starting position is not walkable', { x: startPosition.x.toFixed(1), y: startPosition.y.toFixed(1) });      
    }    const resolvedSpeed = speed ?? this.defaultSpeed;

    this.state = {
      currentPosition: { ...startPosition },
      targetPosition: { ...startPosition },
      path: [],
      pathIndex: 0,
      distanceTraveled: 0,
      isMoving: false,
      speed: resolvedSpeed,
      facing: 0,
      velocity: { x: 0, y: 0 }
    };

    this.lastProgressPosition = { ...startPosition };
  }

  /**
   * Assign a new smooth trajectory for the agent to follow.
   */
  setPath(smoothPath: SmoothPath): void {
    if (smoothPath.points.length < 2) {
      this.stop();
      return;
    }

    const pathPoints = smoothPath.points.map(p => ({ ...p }));
    if (this.calculateDistance(pathPoints[0], this.state.currentPosition) > 1) {
      pathPoints.unshift({ ...this.state.currentPosition });
    }

    this.state.path = pathPoints;
    this.state.pathIndex = 1; // first target is the next point after the current position
    this.state.distanceTraveled = 0;
    this.state.isMoving = true;
    this.state.targetPosition = smoothPath.points[smoothPath.points.length - 1];
    this.resetStuckTracking();
  }

  /**
   * Advance simulation by deltaTime seconds.
   */
  update(deltaTime: number): void {
    if (deltaTime <= 0) {
      return;
    }

    if (!this.state.isMoving || this.state.path.length === 0) {
      this.applyVelocityDamping(deltaTime);
      this.resetStuckTracking();
      return;
    }

    this.advanceWaypoints();

    const target = this.getCurrentTarget();
    const desiredVelocity = this.computeDesiredVelocity(target);
    const avoidanceForce = this.computeAvoidanceForce();
    const steeringForce = this.subtractVectors(desiredVelocity, this.state.velocity);
    const maxForce = this.state.speed * 12; // scale with configured speed

    const totalForce = this.limitVector(
      this.addVectors(steeringForce, this.scaleVector(avoidanceForce, this.avoidanceWeight)),
      maxForce
    );

    const acceleration = this.scaleVector(totalForce, 1 / this.mass);
    this.state.velocity = this.addVectors(
      this.state.velocity,
      this.scaleVector(acceleration, deltaTime)
    );

    this.state.velocity = this.limitVector(this.state.velocity, this.state.speed);

    const proposedPosition = this.addVectors(
      this.state.currentPosition,
      this.scaleVector(this.state.velocity, deltaTime)
    );

    let resolvedPosition = this.resolveCollision(this.state.currentPosition, proposedPosition);

    let clampedToGoal = false;
    if (this.isOnFinalSegment()) {
      const finalPoint = this.state.path[this.state.path.length - 1];
      const toFinalBefore = this.subtractVectors(finalPoint, this.state.currentPosition);
      const toFinalAfter = this.subtractVectors(finalPoint, resolvedPosition);
      if (this.dotProduct(toFinalBefore, toFinalAfter) <= 0) {
        // Clamp directly to the goal when we would overshoot to avoid popping back next frame
        resolvedPosition = { ...finalPoint };
        this.state.velocity = { x: 0, y: 0 };
        clampedToGoal = true;
      }
    }

    this.state.distanceTraveled += this.calculateDistance(this.state.currentPosition, resolvedPosition);
    this.state.currentPosition = resolvedPosition;

    this.updateStuckTracking(deltaTime);

    if (this.vectorMagnitude(this.state.velocity) > this.minFacingSpeed) {
      this.state.facing = Math.atan2(this.state.velocity.y, this.state.velocity.x);
    }

    if (clampedToGoal || this.reachedDestination()) {
      this.finishMovement();
    }
  }

  private isOnFinalSegment(): boolean {
    return this.state.path.length > 0 && this.state.pathIndex >= this.state.path.length - 1;
  }

  /**
   * Stop movement and clear the current trajectory.
   */
  stop(): void {
    this.state.isMoving = false;
    this.state.path = [];
    this.state.pathIndex = 0;
    this.state.velocity = { x: 0, y: 0 };
    this.resetStuckTracking();
  }

  isStuck(): boolean {
    return this.stuck;
  }

  clearStuck(): void {
    this.resetStuckTracking();
  }

  getPosition(): Point {
    return { ...this.state.currentPosition };
  }

  getFacing(): number {
    return this.state.facing;
  }

  getFacingVector(): Point {
    return {
      x: Math.cos(this.state.facing),
      y: Math.sin(this.state.facing)
    };
  }

  isMoving(): boolean {
    return this.state.isMoving;
  }

  getState(): MovementState {
    return { ...this.state };
  }

  setSpeed(speed: number): void {
    this.state.speed = Math.max(1, speed);
    this.state.velocity = this.limitVector(this.state.velocity, this.state.speed);
  }

  getSpeed(): number {
    return this.state.speed;
  }

  getProgress(): number {
    if (this.state.path.length === 0) return 1;
    const idx = Math.min(this.state.pathIndex, this.state.path.length - 1);
    return idx / (this.state.path.length - 1);
  }

  getRemainingPath(): Point[] {
    if (!this.state.isMoving) return [];
    const startIndex = Math.min(this.state.pathIndex, Math.max(this.state.path.length - 1, 0));
    return this.state.path.slice(startIndex);
  }

  /**
   * Update path index based on proximity and line of sight.
   */
  private advanceWaypoints(): void {
    if (this.state.path.length === 0) return;

    const lastIndex = this.state.path.length - 1;
    this.state.pathIndex = Math.min(this.state.pathIndex, lastIndex);

    // Snap to waypoint when inside radius
    while (this.state.pathIndex < lastIndex) {
      const waypoint = this.state.path[this.state.pathIndex];
      if (this.calculateDistance(this.state.currentPosition, waypoint) <= this.waypointRadius) {
        this.state.pathIndex++;
      } else {
        break;
      }
    }

    if (this.state.pathIndex >= lastIndex) {
      return;
    }

    // Try to skip intermediate waypoints if we have clear line of sight
    const maxLookAhead = Math.min(this.state.pathIndex + this.lookAheadSteps, lastIndex);
    for (let i = maxLookAhead; i > this.state.pathIndex; i--) {
      if (this.hasLineOfSight(this.state.currentPosition, this.state.path[i])) {
        this.state.pathIndex = i;
        break;
      }
    }
  }

  private getCurrentTarget(): Point {
    const lastIndex = this.state.path.length - 1;
    const idx = Math.min(this.state.pathIndex, lastIndex);
    return this.state.path[idx] ?? this.state.targetPosition;
  }

  private computeDesiredVelocity(target: Point): Point {
    const toTarget = this.subtractVectors(target, this.state.currentPosition);
    const distance = this.vectorMagnitude(toTarget);

    if (distance < 0.001) {
      return { x: 0, y: 0 };
    }

    let desiredSpeed = this.state.speed;
    const atFinalSegment = this.state.pathIndex >= this.state.path.length - 1;
    if (atFinalSegment && distance < this.arrivalRadius) {
      desiredSpeed = this.state.speed * (distance / this.arrivalRadius);
    }

    const desiredDir = this.scaleVector(toTarget, 1 / distance);
    return this.scaleVector(desiredDir, desiredSpeed);
  }

  private computeAvoidanceForce(): Point {
    const forward = this.getForwardDirection();
    if (!forward) {
      return { x: 0, y: 0 };
    }

    const whiskers = [
      { angle: 0, length: this.whiskerBaseLength },
      { angle: this.whiskerAngle, length: this.whiskerBaseLength * 0.75 },
      { angle: -this.whiskerAngle, length: this.whiskerBaseLength * 0.75 },
      { angle: this.whiskerAngle * 0.35, length: this.whiskerBaseLength * 0.5 },
      { angle: -this.whiskerAngle * 0.35, length: this.whiskerBaseLength * 0.5 }
    ];

    let avoidance: Point = { x: 0, y: 0 };

    for (const whisker of whiskers) {
      const dir = this.rotateVector(forward, whisker.angle);
      const hit = this.castWhisker(dir, whisker.length);

      if (hit) {
        const proximity = Math.max(0, (whisker.length - hit.distance) / whisker.length);
        const strength = proximity * proximity; // quadratic falloff for stronger push near walls
        const pushDir = this.normalize(
          this.subtractVectors(this.state.currentPosition, hit.hitPoint)
        );

        if (!pushDir) {
          continue;
        }

        avoidance = this.addVectors(
          avoidance,
          this.scaleVector(pushDir, strength * this.state.speed)
        );
      }
    }

    return avoidance;
  }

  private castWhisker(direction: Point, length: number): { distance: number; hitPoint: Point } | null {
    const start = this.state.currentPosition;
    const normalizedDir = this.normalize(direction);
    if (!normalizedDir) return null;

    const steps = Math.max(1, Math.floor(length / this.whiskerStep));
    let lastWalkable: Point = { ...start };
    for (let i = 1; i <= steps; i++) {
      const dist = i * this.whiskerStep;
      if (dist > length) break;
      const probe = {
        x: start.x + normalizedDir.x * dist,
        y: start.y + normalizedDir.y * dist
      };

      if (this.isWalkable(probe)) {
        lastWalkable = probe;
      } else {
        return { distance: dist, hitPoint: lastWalkable };
      }
    }

    return null;
  }

  private getForwardDirection(): Point | null {
    if (this.vectorMagnitude(this.state.velocity) > this.minFacingSpeed) {
      return this.normalize(this.state.velocity);
    }

    const target = this.getCurrentTarget();
    const toTarget = this.subtractVectors(target, this.state.currentPosition);
    if (this.vectorMagnitude(toTarget) < 0.001) {
      return null;
    }
    return this.normalize(toTarget);
  }

  private resolveCollision(start: Point, end: Point): Point {
    // If collision is disabled (ghost mode), skip collision resolution
    if (!this.collisionEnabled) {
      return end;
    }

    if (this.isWalkable(end)) {
      return end;
    }

    let low = 0;
    let high = 1;
    let best = { ...start };

    for (let i = 0; i < this.collisionIterations; i++) {
      const t = (low + high) / 2;
      const candidate = {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t
      };

      if (this.isWalkable(candidate)) {
        best = candidate;
        low = t;
      } else {
        high = t;
      }
    }

    if (best.x === start.x && best.y === start.y) {
      this.state.velocity = { x: 0, y: 0 };
    }

    return best;
  }

  private reachedDestination(): boolean {
    if (this.state.path.length === 0) {
      return true;
    }

    const finalPoint = this.state.path[this.state.path.length - 1];
    const distanceToFinal = this.calculateDistance(this.state.currentPosition, finalPoint);
    const isFinalIndex = this.state.pathIndex >= this.state.path.length - 1;
    const slowVelocity = this.vectorMagnitude(this.state.velocity) < this.minFacingSpeed;

    return isFinalIndex && distanceToFinal <= this.arrivalRadius && slowVelocity;
  }

  private finishMovement(): void {
    const finalPoint = this.state.path[this.state.path.length - 1];
    this.state.currentPosition = { ...finalPoint };
    this.state.targetPosition = { ...finalPoint };
    this.state.velocity = { x: 0, y: 0 };
    this.state.pathIndex = this.state.path.length - 1;
    this.state.isMoving = false;
    this.resetStuckTracking();
  }

  private applyVelocityDamping(deltaTime: number): void {
    if (this.vectorMagnitude(this.state.velocity) < 0.01) {
      this.state.velocity = { x: 0, y: 0 };
      return;
    }

    const decay = Math.max(0, 1 - this.damping * deltaTime);
    this.state.velocity = this.scaleVector(this.state.velocity, decay);
    if (this.vectorMagnitude(this.state.velocity) < 0.5) {
      this.state.velocity = { x: 0, y: 0 };
    }
  }

  private hasLineOfSight(start: Point, end: Point): boolean {
    const distance = this.calculateDistance(start, end);
    const steps = Math.max(1, Math.floor(distance / this.whiskerStep));
    const dir = {
      x: (end.x - start.x) / steps,
      y: (end.y - start.y) / steps
    };

    for (let i = 1; i <= steps; i++) {
      const probe = {
        x: start.x + dir.x * i,
        y: start.y + dir.y * i
      };
      if (!this.isWalkable(probe)) {
        return false;
      }
    }
    return true;
  }

  private isWalkable(point: Point): boolean {
    return isPointWalkable(point.x, point.y, WALKABLE_ZONES, OBSTACLES);
  }

  private calculateDistance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private vectorMagnitude(v: Point): number {
    return Math.sqrt(v.x * v.x + v.y * v.y);
  }

  private normalize(v: Point): Point | null {
    const mag = this.vectorMagnitude(v);
    if (mag < 0.001) return null;
    return { x: v.x / mag, y: v.y / mag };
  }

  private addVectors(a: Point, b: Point): Point {
    return { x: a.x + b.x, y: a.y + b.y };
  }

  private subtractVectors(a: Point, b: Point): Point {
    return { x: a.x - b.x, y: a.y - b.y };
  }

  private scaleVector(v: Point, scalar: number): Point {
    return { x: v.x * scalar, y: v.y * scalar };
  }

  private limitVector(v: Point, max: number): Point {
    const mag = this.vectorMagnitude(v);
    if (mag <= max) {
      return v;
    }
    const scale = max / (mag || 1);
    return { x: v.x * scale, y: v.y * scale };
  }

  private rotateVector(v: Point, angle: number): Point {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: v.x * cos - v.y * sin,
      y: v.x * sin + v.y * cos
    };
  }

  private dotProduct(a: Point, b: Point): number {
    return a.x * b.x + a.y * b.y;
  }

  private resetStuckTracking(): void {
    this.timeSinceProgress = 0;
    this.stuck = false;
    this.lastProgressPosition = { ...this.state.currentPosition };
  }

  private updateStuckTracking(deltaTime: number): void {
    if (!this.state.isMoving) {
      this.resetStuckTracking();
      return;
    }

    const progress = this.calculateDistance(this.state.currentPosition, this.lastProgressPosition);
    if (progress >= this.stuckDistanceThreshold) {
      this.lastProgressPosition = { ...this.state.currentPosition };
      this.timeSinceProgress = 0;
      this.stuck = false;
      return;
    }

    this.timeSinceProgress += deltaTime;
    if (this.timeSinceProgress >= this.stuckTimeThreshold) {
      this.stuck = true;
    }
  }

  /**
   * Enable or disable collision detection (disabled for ghosts)
   */
  setCollisionEnabled(enabled: boolean): void {
    this.collisionEnabled = enabled;
  }

  /**
   * Check if collision is enabled
   */
  isCollisionEnabled(): boolean {
    return this.collisionEnabled;
  }
}
