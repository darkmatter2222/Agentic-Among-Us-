/**
 * AI Agent Visual Renderer
 * Renders all AI agents with vision boxes, action radii, paths, and speech bubbles
 * Supports color confidence based on lighting (for lights sabotage mechanic)
 */

import * as PIXI from 'pixi.js';
import type { AgentSnapshot, SpeechEvent, ThoughtEvent } from '@shared/types/simulation.types.ts';
import { VisionBoxRenderer, type LightsStateCallback } from './VisionBoxRenderer.ts';
import { ActionRadiusRenderer } from './ActionRadiusRenderer.ts';
import { PathLineRenderer } from './PathLineRenderer.ts';
import { SpeechBubbleRenderer } from './SpeechBubbleRenderer.ts';
import { ThinkingBubbleRenderer } from './ThinkingBubbleRenderer.ts';
import type { RoomLightingRenderer } from './RoomLightingRenderer.ts';

export interface AgentVisuals {
  spriteContainer: PIXI.Container; // Container for body + legs
  bodyGraphics: PIXI.Graphics;     // Body, backpack, visor (bounces)
  leftLeg: PIXI.Graphics;          // Left leg (redrawn each frame for animation)
  rightLeg: PIXI.Graphics;         // Right leg (redrawn each frame for animation)
  shadow: PIXI.Graphics;           // Shadow under character
  deadBodyGraphics: PIXI.Graphics; // Dead body when killed
  bloodPool: PIXI.Graphics;        // Blood pool under dead body
  darknessOverlay: PIXI.Graphics;  // Darkness overlay for lights-off effect
  impostorIndicator: PIXI.Graphics; // Red outline + glow for impostors (admin view only)
  bodyColor: number;               // Store color for leg redrawing
  visionBox: VisionBoxRenderer;
  actionRadius: ActionRadiusRenderer;
  pathLine: PathLineRenderer;
  // Task progress bar elements
  taskProgressBar: PIXI.Graphics;
  taskProgressBackground: PIXI.Graphics;
  taskCheckmark: PIXI.Graphics;
}

interface AgentVisualState {
  visuals: AgentVisuals;
  targetPosition: { x: number; y: number };
  previousPosition: { x: number; y: number }; // For detecting movement
  targetFacing: number;
  targetPath: AgentSnapshot['movement']['path'];
  pathDirty: boolean;
  lastSpeechTime: number; // Track when we last showed a speech bubble
  lastThoughtTime: number; // Track when we last showed a thought bubble
  isThinking: boolean; // Track if agent is waiting for LLM response
  isDead: boolean; // Track if agent is dead
  isImpostor: boolean; // Track if agent is an impostor (for admin indicator)
  // Animation state
  walkTime: number;
  isWalking: boolean;
  // Task progress state - computed dynamically in update() using startedAt and duration
  taskStartedAt: number | null;   // Timestamp when task started (from server)
  taskDuration: number;           // How long task takes in ms
  showTaskProgress: boolean;      // Whether to show progress bar
  taskCompleteAnimation: number;  // Animation timer for checkmark pop (0 = not animating)
}

export class AIAgentVisualRenderer {
  private static readonly SMOOTHING_SPEED = 12;
  
  // Animation constants - Among Us style walk
  private static readonly SIZE_MULTIPLIER = 1.44; // 44% larger
  private static readonly WALK_CYCLE_SPEED = 2;   // 2 steps per second
  private static readonly BOUNCE_AMOUNT = 6;      // Pixels of vertical bounce
  
  // Leg dimensions (relative to sizeMultiplier)
  private static readonly LEG_WIDTH = 7;          // Width of each leg
  private static readonly LEG_HEIGHT = 9;         // Length of legs (shorter)
  private static readonly LEG_GAP = 2;            // Gap between legs (closer together)
  private static readonly LEG_Y_OFFSET = 4;       // Where legs attach to body (moved up 20% into body)

  private container: PIXI.Container;
  private agentVisuals: Map<string, AgentVisualState>;
  private speechBubbleRenderer: SpeechBubbleRenderer;
  private thinkingBubbleRenderer: ThinkingBubbleRenderer;
  private showVisionBoxes: boolean = false;
  private showActionRadius: boolean = false;
  private showPaths: boolean = true;
  private showSpeechBubbles: boolean = true;
  private showThoughtBubbles: boolean = true;
  private showThinkingBubbles: boolean = true;

  // Lighting reference for color confidence calculations
  private lightingRenderer: RoomLightingRenderer | null = null;
  private lightsStateCallback: LightsStateCallback | null = null;

  constructor() {
    this.container = new PIXI.Container();
    this.agentVisuals = new Map();
    this.speechBubbleRenderer = new SpeechBubbleRenderer({
      maxWidth: 220,
      fontSize: 13,
      fadeInDuration: 250,
      fadeOutDuration: 600,
      displayDuration: 5000,
      offsetY: -55,
    });
    this.thinkingBubbleRenderer = new ThinkingBubbleRenderer({
      offsetY: -55,
    });
    this.container.addChild(this.thinkingBubbleRenderer.getContainer());
    this.container.addChild(this.speechBubbleRenderer.getContainer());
  }

  /**
   * Set the lighting renderer reference (for color confidence and vision reduction)
   */
  setLightingRenderer(renderer: RoomLightingRenderer): void {
    this.lightingRenderer = renderer;
    this.lightsStateCallback = () => renderer.areLightsOn();
    
    // Update all existing vision boxes with the lights callback
    for (const state of this.agentVisuals.values()) {
      state.visuals.visionBox.setLightsStateCallback(this.lightsStateCallback);
    }
  }

  syncAgents(snapshots: AgentSnapshot[], recentSpeech?: SpeechEvent[], recentThoughts?: ThoughtEvent[]): void {
    const activeIds = new Set<string>();

    // Log any dead agents received
    const deadSnapshots = snapshots.filter(s => s.playerState === 'DEAD');
    if (deadSnapshots.length > 0) {
      console.log(`[RENDER] Received ${deadSnapshots.length} dead agent(s):`, deadSnapshots.map(s => s.name));
    }

    for (const snapshot of snapshots) {
      activeIds.add(snapshot.id);
      const state = this.ensureAgentVisual(snapshot);

      state.targetPosition = { ...snapshot.movement.position };
      state.targetFacing = snapshot.movement.facing;
      state.targetPath = snapshot.movement.path.map(point => ({ ...point }));
      state.pathDirty = true;
      state.isThinking = snapshot.isThinking ?? false;
      
      // Track dead state
      const wasDead = state.isDead;
      state.isDead = snapshot.playerState === 'DEAD';

      // Debug logging
      if (snapshot.playerState === 'DEAD') {
        console.log(`[RENDER] Agent ${snapshot.id} is DEAD, wasDead=${wasDead}, isDead=${state.isDead}`);
      }

      // If just died, switch to dead body graphics
      if (state.isDead && !wasDead) {
        console.log(`[RENDER] Agent ${snapshot.id} just died! Showing dead body.`);
        this.showDeadBody(state);
      }

      // Track task progress - store timing data, progress calculated in update()
      const isDoingTask = snapshot.activityState === 'DOING_TASK';
      const wasShowingProgress = state.showTaskProgress;

      if (isDoingTask && snapshot.currentTaskIndex !== undefined && snapshot.currentTaskIndex !== null && snapshot.assignedTasks) {
        const currentTask = snapshot.assignedTasks[snapshot.currentTaskIndex];
        if (currentTask && currentTask.duration > 0) {
          // Store task timing data for dynamic progress calculation
          state.taskStartedAt = currentTask.startedAt ?? null;
          state.taskDuration = currentTask.duration;
          state.showTaskProgress = true;

          // Check if task just completed (from server state)
          if (currentTask.isCompleted && !state.taskCompleteAnimation) {
            state.taskCompleteAnimation = 0.001; // Start completion animation
          }
        }
      } else {
        // Not doing task - trigger completion animation if we were showing progress
        if (wasShowingProgress && state.taskStartedAt && !state.taskCompleteAnimation) {
          // Task just completed - start checkmark animation
          state.taskCompleteAnimation = 0.001;
        }
        state.showTaskProgress = false;
        state.taskStartedAt = null;
        state.taskDuration = 0;
      }

      // Adjust dynamic radii if they change (should be rare but keeps parity with server).
      state.visuals.visionBox.updateConfig({ size: snapshot.visionRadius * 1.4, color: snapshot.color });
      state.visuals.actionRadius.updateConfig({ radius: snapshot.actionRadius, color: snapshot.color });
      state.visuals.pathLine.updateConfig({ color: snapshot.color });

      // Check for new speech to display (only if speech bubbles are enabled)
      if (this.showSpeechBubbles) {
        const speechTime = snapshot.lastSpeechTime ?? 0;
        if (speechTime > state.lastSpeechTime && snapshot.recentSpeech) {
          // New speech detected - show bubble
          this.speechBubbleRenderer.showSpeech(
            snapshot.id,
            snapshot.recentSpeech,
            { x: state.visuals.spriteContainer.x, y: state.visuals.spriteContainer.y }
          );
          state.lastSpeechTime = speechTime;
        }
      }
    }

    // Also check recentSpeech events from world snapshot (only if speech bubbles enabled)
    if (this.showSpeechBubbles && recentSpeech) {
      for (const speech of recentSpeech) {
        const state = this.agentVisuals.get(speech.speakerId);
        if (state && speech.timestamp > state.lastSpeechTime) {
          this.speechBubbleRenderer.showSpeech(
            speech.speakerId,
            speech.message,
            { x: state.visuals.spriteContainer.x, y: state.visuals.spriteContainer.y }
          );
          state.lastSpeechTime = speech.timestamp;
        }
      }
    }

    // Also check recentThoughts events from world snapshot (only if thought bubbles enabled)
    if (this.showThoughtBubbles && recentThoughts) {
      for (const thought of recentThoughts) {
        const state = this.agentVisuals.get(thought.agentId);
        if (state && thought.timestamp > state.lastThoughtTime) {
          this.speechBubbleRenderer.showThought(
            thought.agentId,
            thought.thought,
            { x: state.visuals.spriteContainer.x, y: state.visuals.spriteContainer.y }
          );
          state.lastThoughtTime = thought.timestamp;
        }
      }
    }

    for (const [agentId, state] of this.agentVisuals) {
      if (!activeIds.has(agentId)) {
        state.visuals.spriteContainer.destroy({ children: true });
        state.visuals.visionBox.destroy();
        state.visuals.actionRadius.destroy();
        state.visuals.pathLine.destroy();
        this.speechBubbleRenderer.removeAllBubbles(agentId);
        this.agentVisuals.delete(agentId);
      }
    }
  }  update(deltaTime: number): void {
    const lerpFactor = Math.min(1, deltaTime * AIAgentVisualRenderer.SMOOTHING_SPEED);
    const agentPositions = new Map<string, { x: number; y: number }>();
    const thinkingAgents = new Set<string>();

    for (const [agentId, state] of this.agentVisuals) {
      const { visuals, targetPosition, targetFacing } = state;
      
      // Skip animation for dead agents - they don't move
      if (state.isDead) {
        // Just update position (no animation)
        visuals.spriteContainer.x = targetPosition.x;
        visuals.spriteContainer.y = targetPosition.y;
        agentPositions.set(agentId, { x: visuals.spriteContainer.x, y: visuals.spriteContainer.y });
        continue;
      }

      // Calculate movement for flipping and walking detection
      const dx = targetPosition.x - visuals.spriteContainer.x;
      const dy = targetPosition.y - visuals.spriteContainer.y;
      const distanceToTarget = Math.sqrt(dx * dx + dy * dy);
      
      // Also check if target position changed since last frame (more reliable)
      const targetDx = targetPosition.x - state.previousPosition.x;
      const targetDy = targetPosition.y - state.previousPosition.y;
      const targetMoved = Math.sqrt(targetDx * targetDx + targetDy * targetDy) > 0.01;
      
      // Update previous position
      state.previousPosition = { x: targetPosition.x, y: targetPosition.y };
      
      // Update position with lerp
      visuals.spriteContainer.x += dx * lerpFactor;
      visuals.spriteContainer.y += dy * lerpFactor;

      // Detect if walking: either target moved OR still moving toward target
      // Use very low threshold (0.1) to keep animating while approaching target
      const isMoving = distanceToTarget > 0.1 || targetMoved;
      state.isWalking = isMoving;

      // Flip sprite based on horizontal movement direction
      if (Math.abs(dx) > 0.1) {
        const flipDirection = dx > 0 ? 1 : -1;  // right = 1, left = -1
        visuals.bodyGraphics.scale.x = -flipDirection;  // Body flipped opposite to match visor direction
        // Flip legs to match movement direction
        visuals.leftLeg.x = -AIAgentVisualRenderer.LEG_GAP * AIAgentVisualRenderer.SIZE_MULTIPLIER * flipDirection;
        visuals.rightLeg.x = AIAgentVisualRenderer.LEG_GAP * AIAgentVisualRenderer.SIZE_MULTIPLIER * flipDirection;
        visuals.leftLeg.scale.x = flipDirection;
        visuals.rightLeg.scale.x = flipDirection;
      }
      
      // ===== WALKING ANIMATION =====
      if (state.isWalking) {
        // Increment walk cycle
        state.walkTime += deltaTime * AIAgentVisualRenderer.WALK_CYCLE_SPEED;
        const phase = state.walkTime * Math.PI * 2;
        
        // BOUNCE: Body moves up and down (use abs(sin) for always-up bounce)
        const bounce = Math.abs(Math.sin(phase)) * AIAgentVisualRenderer.BOUNCE_AMOUNT;
        visuals.bodyGraphics.y = -bounce;
        
        // LEG ANIMATION: Among Us style - legs move forward/backward with knee lift
        // Left leg: sin(phase), Right leg: sin(phase + PI) - opposite
        const leftPhase = Math.sin(phase);
        const rightPhase = Math.sin(phase + Math.PI);
        
        // Z-ORDER: Front leg (positive phase = forward) goes ON TOP of body
        // Back leg (negative phase = backward) goes UNDER body
        // Body is at zIndex 10, front leg at 15, back leg at 5
        const leftInFront = leftPhase > 0;
        const rightInFront = rightPhase > 0;
        
        visuals.bodyGraphics.zIndex = 10;
        visuals.leftLeg.zIndex = leftInFront ? 15 : 5;
        visuals.rightLeg.zIndex = rightInFront ? 15 : 5;
        
        // Redraw legs with animation
        // Front leg: no hip outline (blends into body)
        // Back leg: full outline (visible behind body)
        this.drawAnimatedLeg(visuals.leftLeg, visuals.bodyColor, leftPhase, leftInFront);
        this.drawAnimatedLeg(visuals.rightLeg, visuals.bodyColor, rightPhase, rightInFront);
      } else {
        // NOT WALKING: Reset to neutral position - completely still
        visuals.bodyGraphics.y = 0;
        
        // Draw legs in neutral standing position
        // Left leg is in front (zIndex 15), right leg behind (zIndex 5)
        this.drawAnimatedLeg(visuals.leftLeg, visuals.bodyColor, 0, true);   // front - no hip outline
        this.drawAnimatedLeg(visuals.rightLeg, visuals.bodyColor, 0, false); // back - full outline
        state.walkTime = 0;
        
        // When standing: one leg in front, one behind (consistent look)
        visuals.bodyGraphics.zIndex = 10;
        visuals.leftLeg.zIndex = 15;  // Left leg on top
        visuals.rightLeg.zIndex = 5;   // Right leg behind
      }
      
      // Track positions for speech/thinking bubbles (use container position, not animated body)
      agentPositions.set(agentId, { x: visuals.spriteContainer.x, y: visuals.spriteContainer.y });
      
      // Track which agents are thinking
      if (state.isThinking) {
        thinkingAgents.add(agentId);
      }

      // ===== TASK PROGRESS BAR ANIMATION =====
      if (visuals.taskProgressBar && visuals.taskProgressBackground && visuals.taskCheckmark) {
        const sizeMultiplier = AIAgentVisualRenderer.SIZE_MULTIPLIER;
        const progressBarWidth = 30 * sizeMultiplier;
        const progressBarHeight = 4 * sizeMultiplier;
        const bodyY = -14 * sizeMultiplier;
        const bodyHeight = 22 * sizeMultiplier;
        const progressBarY = bodyY + bodyHeight + 8 * sizeMultiplier;

        if (state.showTaskProgress && state.taskStartedAt && state.taskDuration > 0) {
          // Calculate progress dynamically using local time
          const elapsed = Date.now() - state.taskStartedAt;
          const taskProgress = Math.min(1, Math.max(0, elapsed / state.taskDuration));

          // Show and update progress bar
          visuals.taskProgressBackground.visible = true;
          visuals.taskProgressBar.visible = true;

          // Redraw progress bar fill
          visuals.taskProgressBar.clear();
          visuals.taskProgressBar.beginFill(0x00FF00, 0.9); // Green
          const fillWidth = progressBarWidth * taskProgress;
          visuals.taskProgressBar.drawRoundedRect(
            -progressBarWidth / 2,
            progressBarY,
            fillWidth,
            progressBarHeight,
            2
          );
          visuals.taskProgressBar.endFill();
        } else if (!state.taskCompleteAnimation) {
          // Hide progress bar when not doing task (unless animating completion)
          visuals.taskProgressBackground.visible = false;
          visuals.taskProgressBar.visible = false;
        }

        // ===== CHECKMARK COMPLETION ANIMATION =====
        if (state.taskCompleteAnimation && state.taskCompleteAnimation > 0) {
          state.taskCompleteAnimation += deltaTime * 2.5; // Animation speed

          const animPhase = state.taskCompleteAnimation;

          // Animation phases:
          // 0-0.3: Progress bar fills to 100% and holds
          // 0.3-0.5: Progress bar fades out, checkmark scales up (pop in)
          // 0.5-1.2: Checkmark stays visible
          // 1.2-1.5: Checkmark scales down and fades (pop out)
          // 1.5+: Animation complete

          if (animPhase < 0.3) {
            // Keep progress bar visible at full
            visuals.taskProgressBackground.visible = true;
            visuals.taskProgressBar.visible = true;
            visuals.taskProgressBar.clear();
            visuals.taskProgressBar.beginFill(0x00FF00, 0.9);
            visuals.taskProgressBar.drawRoundedRect(
              -progressBarWidth / 2,
              progressBarY,
              progressBarWidth,
              progressBarHeight,
              2
            );
            visuals.taskProgressBar.endFill();
          } else if (animPhase < 0.5) {
            // Fade out progress bar, scale in checkmark
            const fadeProgress = (animPhase - 0.3) / 0.2;
            visuals.taskProgressBackground.alpha = 1 - fadeProgress;
            visuals.taskProgressBar.alpha = 1 - fadeProgress;

            // Draw and animate checkmark
            visuals.taskCheckmark.visible = true;
            const checkScale = fadeProgress * 1.2; // Overshoot slightly
            visuals.taskCheckmark.alpha = fadeProgress;

            // Draw checkmark
            this.drawCheckmark(visuals.taskCheckmark, progressBarY + progressBarHeight / 2, sizeMultiplier, checkScale);
          } else if (animPhase < 1.2) {
            // Hold checkmark visible
            visuals.taskProgressBackground.visible = false;
            visuals.taskProgressBar.visible = false;
            visuals.taskCheckmark.visible = true;
            visuals.taskCheckmark.alpha = 1;

            // Settle from overshoot
            const settleProgress = Math.min(1, (animPhase - 0.5) / 0.1);
            const checkScale = 1.2 - 0.2 * settleProgress;
            this.drawCheckmark(visuals.taskCheckmark, progressBarY + progressBarHeight / 2, sizeMultiplier, checkScale);
          } else if (animPhase < 1.5) {
            // Fade out checkmark
            const fadeOutProgress = (animPhase - 1.2) / 0.3;
            visuals.taskCheckmark.alpha = 1 - fadeOutProgress;
            const checkScale = 1 - fadeOutProgress * 0.3;
            this.drawCheckmark(visuals.taskCheckmark, progressBarY + progressBarHeight / 2, sizeMultiplier, checkScale);
          } else {
            // Animation complete
            state.taskCompleteAnimation = 0;
            visuals.taskProgressBackground.visible = false;
            visuals.taskProgressBar.visible = false;
            visuals.taskCheckmark.visible = false;
            visuals.taskProgressBackground.alpha = 1;
            visuals.taskProgressBar.alpha = 1;
            visuals.taskCheckmark.alpha = 0;
          }
        }
      }

      if (this.showVisionBoxes) {
        // Vision box follows container, NOT the bouncing body
        visuals.visionBox.render({ x: visuals.spriteContainer.x, y: visuals.spriteContainer.y }, targetFacing);
        visuals.visionBox.setVisible(true);
      } else {
        visuals.visionBox.setVisible(false);
      }

      if (this.showActionRadius) {
        // Action radius follows container, NOT the bouncing body
        visuals.actionRadius.render({ x: visuals.spriteContainer.x, y: visuals.spriteContainer.y });
        visuals.actionRadius.setVisible(true);
      } else {
        visuals.actionRadius.setVisible(false);
      }

      if (this.showPaths && state.targetPath.length > 0) {
        if (state.pathDirty) {
          visuals.pathLine.render(state.targetPath);
          state.pathDirty = false;
        }
        visuals.pathLine.setVisible(true);
      } else {
        visuals.pathLine.setVisible(false);
      }
      
      // Update darkness overlay based on lighting
      if (this.lightingRenderer) {
        const lightsOn = this.lightingRenderer.areLightsOn();
        if (!lightsOn) {
          // When lights are off, get brightness at agent position
          const brightness = this.lightingRenderer.getBrightnessAtPosition(
            visuals.spriteContainer.x,
            visuals.spriteContainer.y
          );
          // Darkness overlay alpha is inverse of brightness
          // More brightness = less darkness
          const targetAlpha = Math.max(0, 0.75 - brightness * 0.8);
          // Smooth transition
          visuals.darknessOverlay.alpha += (targetAlpha - visuals.darknessOverlay.alpha) * 0.1;
        } else {
          // Fade out darkness overlay when lights are on
          visuals.darknessOverlay.alpha += (0 - visuals.darknessOverlay.alpha) * 0.15;
        }
      }
    }
    
    // Update thinking bubbles with current positions and thinking states
    if (this.showThinkingBubbles) {
      this.thinkingBubbleRenderer.update(deltaTime, agentPositions, thinkingAgents);
      this.thinkingBubbleRenderer.getContainer().visible = true;
    } else {
      this.thinkingBubbleRenderer.getContainer().visible = false;
    }
    
    // Update speech bubbles with current agent positions
    if (this.showSpeechBubbles) {
      this.speechBubbleRenderer.update(deltaTime, agentPositions);
      this.speechBubbleRenderer.getContainer().visible = true;
    } else {
      this.speechBubbleRenderer.getContainer().visible = false;
    }
  }

  toggleVisionBoxes(show?: boolean): void {
    this.showVisionBoxes = show ?? !this.showVisionBoxes;
  }

  toggleActionRadius(show?: boolean): void {
    this.showActionRadius = show ?? !this.showActionRadius;
  }

  togglePaths(show?: boolean): void {
    this.showPaths = show ?? !this.showPaths;
  }

  toggleSpeechBubbles(show?: boolean): void {
    this.showSpeechBubbles = show ?? !this.showSpeechBubbles;
  }

  toggleThoughtBubbles(show?: boolean): void {
    this.showThoughtBubbles = show ?? !this.showThoughtBubbles;
  }

  toggleThinkingBubbles(show?: boolean): void {
    this.showThinkingBubbles = show ?? !this.showThinkingBubbles;
  }

  // Getter methods for current toggle states
  isShowingVisionBoxes(): boolean { return this.showVisionBoxes; }
  isShowingActionRadius(): boolean { return this.showActionRadius; }
  isShowingPaths(): boolean { return this.showPaths; }
  isShowingSpeechBubbles(): boolean { return this.showSpeechBubbles; }
  isShowingThoughtBubbles(): boolean { return this.showThoughtBubbles; }
  isShowingThinkingBubbles(): boolean { return this.showThinkingBubbles; }

  getContainer(): PIXI.Container {
    return this.container;
  }

  clear(): void {
    for (const state of this.agentVisuals.values()) {
      state.visuals.spriteContainer.destroy({ children: true });
      state.visuals.visionBox.destroy();
      state.visuals.actionRadius.destroy();
      state.visuals.pathLine.destroy();
    }
    this.agentVisuals.clear();
    this.speechBubbleRenderer.destroy();
    this.thinkingBubbleRenderer.destroy();
    this.container.removeChildren();
    
    // Recreate bubble renderers after clear
    this.speechBubbleRenderer = new SpeechBubbleRenderer({
      maxWidth: 220,
      fontSize: 13,
      fadeInDuration: 250,
      fadeOutDuration: 600,
      displayDuration: 5000,
      offsetY: -55,
    });
    this.thinkingBubbleRenderer = new ThinkingBubbleRenderer({
      offsetY: -55,
    });
    this.container.addChild(this.thinkingBubbleRenderer.getContainer());
    this.container.addChild(this.speechBubbleRenderer.getContainer());
  }

  /**
   * Draw an animated leg based on walk phase
   * phase: -1 to 1, where:
   *   -1 = leg extended back
   *    0 = neutral standing
   *    1 = knee lifted forward (front leg up)
   * isInFront: true = leg is in front of body (no hip outline to blend in)
   *            false = leg is behind body (full outline visible)
   */
  private drawAnimatedLeg(legGraphics: PIXI.Graphics, color: number, phase: number, isInFront: boolean): void {
    legGraphics.clear();

    const s = AIAgentVisualRenderer.SIZE_MULTIPLIER;
    const legWidth = AIAgentVisualRenderer.LEG_WIDTH * s;
    const legHeight = AIAgentVisualRenderer.LEG_HEIGHT * s;
    const yOffset = AIAgentVisualRenderer.LEG_Y_OFFSET * s;
    const outlineColor = 0x000000;
    const outlineWidth = 1 * s;
    const cornerRadius = 3 * s;

    // Where outline starts (lower = less inappropriate)
    const outlineStartY = yOffset + 6 * s;

    if (phase > 0.3) {
      // KNEE UP POSE: L-shaped leg - thigh angles forward, shin hangs straight down
      const kneeForward = phase * 6 * s;
      const kneeLift = phase * 3 * s;
      const kneeY = yOffset + legHeight * 0.4 - kneeLift;
      const footY = kneeY + legHeight * 0.55;

      // Draw as ONE connected L-shape with curved knee (FILL)
      legGraphics.moveTo(-legWidth/2, yOffset - 2 * s);
      legGraphics.lineTo(legWidth/2, yOffset - 2 * s);
      // Right side of thigh curves to knee
      legGraphics.quadraticCurveTo(kneeForward + legWidth/2 + 2*s, kneeY - 2*s, kneeForward + legWidth/2, kneeY);
      legGraphics.lineTo(kneeForward + legWidth/2, footY - cornerRadius);
      legGraphics.arc(kneeForward + legWidth/2 - cornerRadius, footY - cornerRadius, cornerRadius, 0, Math.PI/2);
      legGraphics.lineTo(kneeForward - legWidth/2 + cornerRadius, footY);
      legGraphics.arc(kneeForward - legWidth/2 + cornerRadius, footY - cornerRadius, cornerRadius, Math.PI/2, Math.PI);
      legGraphics.lineTo(kneeForward - legWidth/2, kneeY);
      // Left side curves back to hip
      legGraphics.quadraticCurveTo(kneeForward - legWidth/2 - 2*s, kneeY - 2*s, -legWidth/2, yOffset - 2 * s);
      legGraphics.closePath();
      legGraphics.fill(color);

      if (isInFront) {
        // Front leg: outline on shin, foot, and curved thigh line from body DOWN to knee
        // Curve from body DOWN and FORWARD to top of knee (following thigh direction)
        legGraphics.moveTo(legWidth/2, outlineStartY);
        legGraphics.quadraticCurveTo(kneeForward/2 + legWidth/2, outlineStartY + 2*s, kneeForward + legWidth/2, kneeY);
        legGraphics.stroke({ width: outlineWidth, color: outlineColor });
        
        // Shin and foot outline (separate path)
        legGraphics.moveTo(kneeForward - legWidth/2, kneeY);
        legGraphics.lineTo(kneeForward - legWidth/2, footY - cornerRadius);
        legGraphics.arc(kneeForward - legWidth/2 + cornerRadius, footY - cornerRadius, cornerRadius, Math.PI, Math.PI/2, true);
        legGraphics.lineTo(kneeForward + legWidth/2 - cornerRadius, footY);
        legGraphics.arc(kneeForward + legWidth/2 - cornerRadius, footY - cornerRadius, cornerRadius, Math.PI/2, 0, true);
        legGraphics.lineTo(kneeForward + legWidth/2, kneeY);
        legGraphics.stroke({ width: outlineWidth, color: outlineColor });
      } else {
        // Back leg: full outline including top
        legGraphics.moveTo(-legWidth/2, yOffset - 2 * s);
        legGraphics.lineTo(legWidth/2, yOffset - 2 * s);
        legGraphics.quadraticCurveTo(kneeForward + legWidth/2 + 2*s, kneeY - 2*s, kneeForward + legWidth/2, kneeY);
        legGraphics.lineTo(kneeForward + legWidth/2, footY - cornerRadius);
        legGraphics.arc(kneeForward + legWidth/2 - cornerRadius, footY - cornerRadius, cornerRadius, 0, Math.PI/2);
        legGraphics.lineTo(kneeForward - legWidth/2 + cornerRadius, footY);
        legGraphics.arc(kneeForward - legWidth/2 + cornerRadius, footY - cornerRadius, cornerRadius, Math.PI/2, Math.PI);
        legGraphics.lineTo(kneeForward - legWidth/2, kneeY);
        legGraphics.quadraticCurveTo(kneeForward - legWidth/2 - 2*s, kneeY - 2*s, -legWidth/2, yOffset - 2 * s);
        legGraphics.closePath();
        legGraphics.stroke({ width: outlineWidth, color: outlineColor });
      }

    } else if (phase < -0.3) {
      // LEG BACK POSE: Leg angles backward
      const backAmount = -phase;
      const footX = -backAmount * 8 * s;
      const footY = yOffset + legHeight - backAmount * 2 * s;

      // Draw leg as angled shape with rounded foot (FILL)
      legGraphics.moveTo(-legWidth/2, yOffset - 2 * s);
      legGraphics.lineTo(legWidth/2, yOffset - 2 * s);
      legGraphics.lineTo(footX + legWidth/2, footY - cornerRadius);
      legGraphics.arc(footX + legWidth/2 - cornerRadius, footY - cornerRadius, cornerRadius, 0, Math.PI/2);
      legGraphics.lineTo(footX - legWidth/2 + cornerRadius, footY);
      legGraphics.arc(footX - legWidth/2 + cornerRadius, footY - cornerRadius, cornerRadius, Math.PI/2, Math.PI);
      legGraphics.lineTo(-legWidth/2, yOffset - 2 * s);
      legGraphics.closePath();
      legGraphics.fill(color);

      if (isInFront) {
        // Front leg: outline ONLY on foot (no leg outline)
        legGraphics.moveTo(footX - legWidth/2, footY - cornerRadius);
        legGraphics.arc(footX - legWidth/2 + cornerRadius, footY - cornerRadius, cornerRadius, Math.PI, Math.PI/2, true);
        legGraphics.lineTo(footX + legWidth/2 - cornerRadius, footY);
        legGraphics.arc(footX + legWidth/2 - cornerRadius, footY - cornerRadius, cornerRadius, Math.PI/2, 0, true);
        legGraphics.stroke({ width: outlineWidth, color: outlineColor });
      } else {
        // Back leg: full outline
        legGraphics.moveTo(-legWidth/2, yOffset - 2 * s);
        legGraphics.lineTo(legWidth/2, yOffset - 2 * s);
        legGraphics.lineTo(footX + legWidth/2, footY - cornerRadius);
        legGraphics.arc(footX + legWidth/2 - cornerRadius, footY - cornerRadius, cornerRadius, 0, Math.PI/2);
        legGraphics.lineTo(footX - legWidth/2 + cornerRadius, footY);
        legGraphics.arc(footX - legWidth/2 + cornerRadius, footY - cornerRadius, cornerRadius, Math.PI/2, Math.PI);
        legGraphics.lineTo(-legWidth/2, yOffset - 2 * s);
        legGraphics.closePath();
        legGraphics.stroke({ width: outlineWidth, color: outlineColor });
      }

    } else {
      // NEUTRAL POSE: Straight down with rounded bottom
      const frontLegHeight = legHeight * 1.05;
      const backLegHeight = legHeight * 0.95;
      const actualHeight = isInFront ? frontLegHeight : backLegHeight;

      if (isInFront) {
        // Front leg: fill then outline sides and bottom only
        legGraphics.roundRect(-legWidth/2, yOffset, legWidth, actualHeight, cornerRadius);
        legGraphics.fill(color);

        // Outline on sides and bottom only
        legGraphics.moveTo(-legWidth/2, outlineStartY);
        legGraphics.lineTo(-legWidth/2, yOffset + actualHeight - cornerRadius);
        legGraphics.arc(-legWidth/2 + cornerRadius, yOffset + actualHeight - cornerRadius, cornerRadius, Math.PI, Math.PI/2, true);
        legGraphics.lineTo(legWidth/2 - cornerRadius, yOffset + actualHeight);
        legGraphics.arc(legWidth/2 - cornerRadius, yOffset + actualHeight - cornerRadius, cornerRadius, Math.PI/2, 0, true);
        legGraphics.lineTo(legWidth/2, outlineStartY);
        legGraphics.stroke({ width: outlineWidth, color: outlineColor });
      } else {
        // Back leg: full outline
        legGraphics.roundRect(-legWidth/2 - outlineWidth/2, yOffset - outlineWidth/2, legWidth + outlineWidth, actualHeight + outlineWidth, cornerRadius);
        legGraphics.fill(outlineColor);

        legGraphics.roundRect(-legWidth/2, yOffset, legWidth, actualHeight, cornerRadius);
        legGraphics.fill(color);
      }
    }
  }

  /**
   * Draw a checkmark icon for task completion animation.
   * @param graphics - The PIXI Graphics object to draw on
   * @param centerY - Y position for the checkmark center
   * @param sizeMultiplier - Scale multiplier
   * @param scale - Animation scale (1 = normal)
   */
  private drawCheckmark(graphics: PIXI.Graphics, centerY: number, sizeMultiplier: number, scale: number): void {
    graphics.clear();
    
    const size = 8 * sizeMultiplier * scale;
    const lineWidth = 2 * sizeMultiplier * scale;
    
    // Green circle background
    graphics.beginFill(0x00CC00, 0.9);
    graphics.drawCircle(0, centerY, size);
    graphics.endFill();
    
    // White checkmark
    graphics.lineStyle(lineWidth, 0xFFFFFF, 1);
    // Start from left-middle of checkmark
    const startX = -size * 0.4;
    const startY = centerY;
    // Middle point (bottom of check)
    const midX = -size * 0.1;
    const midY = centerY + size * 0.3;
    // End point (top right of check)
    const endX = size * 0.45;
    const endY = centerY - size * 0.35;
    
    graphics.moveTo(startX, startY);
    graphics.lineTo(midX, midY);
    graphics.lineTo(endX, endY);
  }

  destroy(): void {
    for (const state of this.agentVisuals.values()) {
      state.visuals.spriteContainer.destroy({ children: true });
      state.visuals.visionBox.destroy();
      state.visuals.actionRadius.destroy();
      state.visuals.pathLine.destroy();
    }
    this.agentVisuals.clear();
    this.speechBubbleRenderer.destroy();
    this.thinkingBubbleRenderer.destroy();
    this.container.destroy();
  }

  private ensureAgentVisual(snapshot: AgentSnapshot): AgentVisualState {
    const existing = this.agentVisuals.get(snapshot.id);
    if (existing) {
      return existing;
    }

    const sizeMultiplier = AIAgentVisualRenderer.SIZE_MULTIPLIER;
    const bodyColor = snapshot.color;
    const visorColor = 0x84D2F6; // Light blue glass
    const outlineColor = 0x000000;
    
    // Create container hierarchy:
    // spriteContainer (moves with agent position)
    //   ├── shadow (static, doesn't bounce)
    //   ├── leftLeg (redrawn each frame for walking animation)
    //   ├── rightLeg (redrawn each frame for walking animation)
    //   └── bodyGraphics (bounces vertically) - contains body, backpack, visor
    
    const spriteContainer = new PIXI.Container();
    spriteContainer.sortableChildren = true; // Enable z-ordering for legs in front/behind body
    
    // Shadow under character (doesn't animate) - always at bottom
    const shadow = new PIXI.Graphics();
    shadow.zIndex = 0;
    shadow.beginFill(0x000000, 0.3);
    shadow.drawEllipse(0, 16 * sizeMultiplier, 12 * sizeMultiplier, 5 * sizeMultiplier);
    shadow.endFill();
    spriteContainer.addChild(shadow);
    
    // LEFT LEG (will be redrawn each frame for animation)
    const leftLeg = new PIXI.Graphics();
    leftLeg.zIndex = 15; // Start on top
    leftLeg.x = -AIAgentVisualRenderer.LEG_GAP * sizeMultiplier; // Position left of center
    spriteContainer.addChild(leftLeg);
    
    // RIGHT LEG (will be redrawn each frame for animation)
    const rightLeg = new PIXI.Graphics();
    rightLeg.zIndex = 5; // Start behind body
    rightLeg.x = AIAgentVisualRenderer.LEG_GAP * sizeMultiplier; // Position right of center
    spriteContainer.addChild(rightLeg);
    
    // Draw initial leg state (neutral)
    // Left leg starts in front (no hip outline), right leg behind (full outline)
    this.drawAnimatedLeg(leftLeg, bodyColor, 0, true);
    this.drawAnimatedLeg(rightLeg, bodyColor, 0, false);
    
    // BODY GRAPHICS (bounces as a unit)
    const bodyGraphics = new PIXI.Graphics();
    bodyGraphics.zIndex = 10; // Body in middle layer
    
    // Body dimensions - 20% thinner horizontally (was 40%, now 20%)
    const bodyWidth = 16 * sizeMultiplier;  // Was 20, now 16 (20% thinner)
    const bodyHeight = 24 * sizeMultiplier;
    const bodyX = -8 * sizeMultiplier;      // Centered for new width
    const bodyY = -14 * sizeMultiplier;
    const bodyRadius = 8 * sizeMultiplier;  // Adjusted for body width
    
    // Backpack dimensions - closer to body and 20% shorter from bottom
    const backpackWidth = 6 * sizeMultiplier;
    const backpackHeight = 14 * sizeMultiplier;  // Was 18, now ~14 (20% shorter)
    const backpackX = 7 * sizeMultiplier;   // Adjusted to stay close to thicker body
    const backpackY = -6 * sizeMultiplier;
    const backpackRadius = 3 * sizeMultiplier;
    
    // Body outline (black shadow layer)
    bodyGraphics.beginFill(outlineColor);
    bodyGraphics.drawRoundedRect(backpackX - 1 * sizeMultiplier, backpackY - 1 * sizeMultiplier, backpackWidth + 2 * sizeMultiplier, backpackHeight + 2 * sizeMultiplier, backpackRadius + 1); // Backpack outline
    bodyGraphics.drawRoundedRect(bodyX - 1 * sizeMultiplier, bodyY - 1 * sizeMultiplier, bodyWidth + 2 * sizeMultiplier, bodyHeight + 2 * sizeMultiplier, bodyRadius + 1); // Body outline
    bodyGraphics.endFill();
    
    // Backpack
    bodyGraphics.beginFill(bodyColor);
    bodyGraphics.drawRoundedRect(backpackX, backpackY, backpackWidth, backpackHeight, backpackRadius);
    bodyGraphics.endFill();
    
    // Main body (pill/capsule shape - thinner)
    bodyGraphics.beginFill(bodyColor);
    bodyGraphics.drawRoundedRect(bodyX, bodyY, bodyWidth, bodyHeight, bodyRadius);
    bodyGraphics.endFill();
    
    // Visor outline - draw black background first for clear border
    const visorX = -8 * sizeMultiplier;     // Adjusted for 20% thinner body
    const visorY = -10 * sizeMultiplier;
    const visorWidth = 13 * sizeMultiplier; // Adjusted for body width
    const visorHeight = 9 * sizeMultiplier;
    const visorRadius = 4 * sizeMultiplier;
    const visorOutline = 1 * sizeMultiplier; // 50% thinner (was 2)
    
    // Black outline (slightly larger rounded rect behind visor)
    bodyGraphics.beginFill(outlineColor);
    bodyGraphics.drawRoundedRect(
      visorX - visorOutline, 
      visorY - visorOutline, 
      visorWidth + visorOutline * 2, 
      visorHeight + visorOutline * 2, 
      visorRadius + visorOutline
    );
    bodyGraphics.endFill();
    
    // Visor fill (rounded rectangle - squared with round edges)
    bodyGraphics.beginFill(visorColor, 0.95);
    bodyGraphics.drawRoundedRect(visorX, visorY, visorWidth, visorHeight, visorRadius);
    bodyGraphics.endFill();
    
    // Visor shine highlight
    bodyGraphics.beginFill(0xFFFFFF, 0.6);
    bodyGraphics.drawEllipse(-4 * sizeMultiplier, -8 * sizeMultiplier, 2.5 * sizeMultiplier, 1.5 * sizeMultiplier);
    bodyGraphics.endFill();
    
    spriteContainer.addChild(bodyGraphics);
    
    // Darkness overlay for lights-off effect (drawn on top of body, hidden by default)
    const darknessOverlay = new PIXI.Graphics();
    darknessOverlay.zIndex = 20; // Above everything
    darknessOverlay.alpha = 0; // Start invisible
    // Draw a dark overlay covering the body area
    darknessOverlay.beginFill(0x000000, 0.7);
    darknessOverlay.drawRoundedRect(bodyX - 2 * sizeMultiplier, bodyY - 2 * sizeMultiplier, 
      bodyWidth + 4 * sizeMultiplier, bodyHeight + 10 * sizeMultiplier, bodyRadius);
    darknessOverlay.endFill();
    spriteContainer.addChild(darknessOverlay);

    // Impostor indicator - red outline with glow for admin view (drawn on top of body)
    const impostorIndicator = new PIXI.Graphics();
    impostorIndicator.zIndex = 21; // Above darkness overlay, visible on top
    impostorIndicator.visible = false; // Will be shown only for impostors
    // Draw the impostor indicator (red glow + outline around body)
    this.drawImpostorIndicator(impostorIndicator, sizeMultiplier, bodyWidth, bodyHeight, bodyX, bodyY, bodyRadius);
    spriteContainer.addChild(impostorIndicator);

    const visionBox = new VisionBoxRenderer({
      size: snapshot.visionRadius * 1.4,
      color: snapshot.color,
      alpha: 0.15,
      rayCount: 90
    });
    
    // Set up lights callback if we have a lighting renderer
    if (this.lightsStateCallback) {
      visionBox.setLightsStateCallback(this.lightsStateCallback);
    }

    const actionRadius = new ActionRadiusRenderer({
      radius: snapshot.actionRadius,
      color: snapshot.color,
      alpha: 0.4,
      lineWidth: 1,
      fillAlpha: 0.05
    });

    const pathLine = new PathLineRenderer({
      color: snapshot.color,
      alpha: 0.6,
      lineWidth: 2,
      dashLength: 8,
      gapLength: 4
    });

    // Task progress bar (positioned below player)
    const taskProgressBackground = new PIXI.Graphics();
    taskProgressBackground.zIndex = 25;
    taskProgressBackground.visible = false;
    // Background bar (dark gray)
    const progressBarWidth = 30 * sizeMultiplier;
    const progressBarHeight = 4 * sizeMultiplier;
    const progressBarY = bodyY + bodyHeight + 8 * sizeMultiplier;
    taskProgressBackground.beginFill(0x333333, 0.8);
    taskProgressBackground.drawRoundedRect(-progressBarWidth / 2, progressBarY, progressBarWidth, progressBarHeight, 2);
    taskProgressBackground.endFill();
    spriteContainer.addChild(taskProgressBackground);

    const taskProgressBar = new PIXI.Graphics();
    taskProgressBar.zIndex = 26;
    taskProgressBar.visible = false;
    spriteContainer.addChild(taskProgressBar);

    // Task completion checkmark
    const taskCheckmark = new PIXI.Graphics();
    taskCheckmark.zIndex = 27;
    taskCheckmark.visible = false;
    taskCheckmark.alpha = 0;
    spriteContainer.addChild(taskCheckmark);
    
    // Dead body graphics (hidden until player dies)
    const bloodPool = new PIXI.Graphics();
    bloodPool.zIndex = -1; // Under everything
    bloodPool.visible = false;
    spriteContainer.addChild(bloodPool);
    
    const deadBodyGraphics = new PIXI.Graphics();
    deadBodyGraphics.zIndex = 10; // Same level as body
    deadBodyGraphics.visible = false;
    spriteContainer.addChild(deadBodyGraphics);

    this.container.addChild(visionBox.getContainer());
    this.container.addChild(pathLine.getContainer());
    this.container.addChild(actionRadius.getContainer());
    this.container.addChild(spriteContainer);

    const state: AgentVisualState = {
      visuals: { spriteContainer, bodyGraphics, leftLeg, rightLeg, shadow, deadBodyGraphics, bloodPool, darknessOverlay, impostorIndicator, bodyColor, visionBox, actionRadius, pathLine, taskProgressBar, taskProgressBackground, taskCheckmark },
      targetPosition: { ...snapshot.movement.position },
      previousPosition: { ...snapshot.movement.position },
      targetFacing: snapshot.movement.facing,
      targetPath: snapshot.movement.path.map(point => ({ ...point })),
      pathDirty: true,
      lastSpeechTime: 0,
      lastThoughtTime: 0,
      isThinking: snapshot.isThinking ?? false,
      isDead: snapshot.playerState === 'DEAD',
      isImpostor: snapshot.role === 'IMPOSTOR',
      walkTime: 0,
      isWalking: false,
      taskStartedAt: null,
      taskDuration: 0,
      showTaskProgress: false,
      taskCompleteAnimation: 0,
    };    spriteContainer.position.set(snapshot.movement.position.x, snapshot.movement.position.y);

    this.agentVisuals.set(snapshot.id, state);

    // Show impostor indicator for impostors (admin view only)
    if (state.isImpostor) {
      state.visuals.impostorIndicator.visible = true;
    }

    // If agent is already dead when we create their visual, show dead body immediately
    if (state.isDead) {
      console.log(`[RENDER] Agent ${snapshot.id} created as already dead - showing dead body immediately`);
      this.showDeadBody(state);
    }    return state;
  }
  
  /**
   * Show dead body graphics and hide live body
   * Clean Among Us style dead body - body laying down, cut in half with bone sticking out
   * No blood pool - just the clean body graphic
   */
  private showDeadBody(state: AgentVisualState): void {
    console.log(`[RENDER] showDeadBody() called - hiding live body, showing dead body graphics`);
    const visuals = state.visuals;
    const color = visuals.bodyColor;
    const sizeMultiplier = AIAgentVisualRenderer.SIZE_MULTIPLIER;
    const size = 14 * sizeMultiplier;

    console.log(`[RENDER] showDeadBody - bodyGraphics.visible was: ${visuals.bodyGraphics.visible}, deadBodyGraphics.visible was: ${visuals.deadBodyGraphics.visible}`);

    // Hide live body parts
    visuals.bodyGraphics.visible = false;
    visuals.leftLeg.visible = false;
    visuals.rightLeg.visible = false;
    visuals.shadow.visible = false;
    visuals.taskProgressBar.visible = false;
    visuals.taskProgressBackground.visible = false;
    visuals.taskCheckmark.visible = false;
    visuals.impostorIndicator.visible = false; // Hide impostor indicator when dead

    // Generate color variations (darker shades for depth/shadows)
    const darkerColor = this.darkenColor(color, 0.22);   // Shadow/darker areas
    const darkestColor = this.darkenColor(color, 0.40);  // Darkest shadows
    const visorColor = 0x030405; // Dark visor like in SVG

    // NO BLOOD POOL - hide it completely
    visuals.bloodPool.clear();
    visuals.bloodPool.visible = false;

    // Draw dead body
    visuals.deadBodyGraphics.clear();
    visuals.deadBodyGraphics.visible = true;

    // ===== UPPER HALF (LEFT SIDE) - Main body torso with backpack and visor =====
    // Body is laying down horizontally, viewed from above/behind
    // Backpack is on top (back of body facing up), arm visible on right side

    // Main upper body shape (large bean/pill shape - the torso)
    visuals.deadBodyGraphics.beginFill(color);
    visuals.deadBodyGraphics.drawEllipse(-size * 0.45, 0, size * 0.75, size * 0.55);
    visuals.deadBodyGraphics.endFill();

    // Backpack (darker rounded hump on top of body - back facing up)
    visuals.deadBodyGraphics.beginFill(darkerColor);
    visuals.deadBodyGraphics.drawEllipse(-size * 0.85, -size * 0.05, size * 0.35, size * 0.42);
    visuals.deadBodyGraphics.endFill();

    // Subtle shadow under backpack edge
    visuals.deadBodyGraphics.beginFill(darkestColor);
    visuals.deadBodyGraphics.drawEllipse(-size * 0.65, size * 0.15, size * 0.15, size * 0.25);
    visuals.deadBodyGraphics.endFill();

    // Visor (dark curved shape on front of head area)
    visuals.deadBodyGraphics.beginFill(visorColor);
    visuals.deadBodyGraphics.drawEllipse(-size * 0.25, -size * 0.25, size * 0.35, size * 0.2);
    visuals.deadBodyGraphics.endFill();
    
    // Visor highlight/reflection
    visuals.deadBodyGraphics.beginFill(0xFFFFFF, 0.25);
    visuals.deadBodyGraphics.drawEllipse(-size * 0.15, -size * 0.32, size * 0.1, size * 0.05);
    visuals.deadBodyGraphics.endFill();

    // Cut/exposed interior on upper half (where it was sliced - darker ellipse on right edge)
    visuals.deadBodyGraphics.beginFill(darkestColor);
    visuals.deadBodyGraphics.drawEllipse(size * 0.2, size * 0.05, size * 0.15, size * 0.4);
    visuals.deadBodyGraphics.endFill();

    // Upper half body outline
    visuals.deadBodyGraphics.lineStyle(1.5, 0x000000, 0.4);
    visuals.deadBodyGraphics.drawEllipse(-size * 0.45, 0, size * 0.75, size * 0.55);
    visuals.deadBodyGraphics.lineStyle(0);

    // ===== LOWER HALF (RIGHT SIDE) - Bottom portion separated =====
    // The lower body half that fell away

    // Main lower body portion
    visuals.deadBodyGraphics.beginFill(color);
    visuals.deadBodyGraphics.drawEllipse(size * 0.85, size * 0.1, size * 0.45, size * 0.35);
    visuals.deadBodyGraphics.endFill();

    // Exposed interior on lower half (darker, where cut - left edge)
    visuals.deadBodyGraphics.beginFill(darkestColor);
    visuals.deadBodyGraphics.drawEllipse(size * 0.5, size * 0.08, size * 0.12, size * 0.28);
    visuals.deadBodyGraphics.endFill();

    // Lower half outline
    visuals.deadBodyGraphics.lineStyle(1.5, 0x000000, 0.4);
    visuals.deadBodyGraphics.drawEllipse(size * 0.85, size * 0.1, size * 0.45, size * 0.35);
    visuals.deadBodyGraphics.lineStyle(0);

    // ===== BONE (Single white bone sticking out between halves) =====
    const boneWhite = 0xFCFBFC;    // Main bone color (off-white)
    const boneGray = 0xC3C3C3;     // Shading color

    // Bone positioned horizontally between the two body halves
    // Simple cartoon bone with rounded ends
    const boneStartX = size * 0.15;
    const boneEndX = size * 0.55;
    const boneY = size * 0.05;
    const boneThickness = size * 0.1;

    // Draw bone shaft (horizontal rectangle with rounded corners)
    visuals.deadBodyGraphics.beginFill(boneWhite);
    visuals.deadBodyGraphics.drawRoundedRect(
      boneStartX, 
      boneY - boneThickness / 2, 
      boneEndX - boneStartX, 
      boneThickness, 
      boneThickness * 0.3
    );
    visuals.deadBodyGraphics.endFill();

    // Left bone knob (double-ball cartoon bone end) - partially hidden in body
    visuals.deadBodyGraphics.beginFill(boneWhite);
    visuals.deadBodyGraphics.drawCircle(boneStartX, boneY - boneThickness * 0.4, boneThickness * 0.55);
    visuals.deadBodyGraphics.drawCircle(boneStartX, boneY + boneThickness * 0.4, boneThickness * 0.55);
    visuals.deadBodyGraphics.endFill();

    // Right bone knob (double-ball cartoon bone end) - visible, sticking out
    visuals.deadBodyGraphics.beginFill(boneWhite);
    visuals.deadBodyGraphics.drawCircle(boneEndX, boneY - boneThickness * 0.45, boneThickness * 0.6);
    visuals.deadBodyGraphics.drawCircle(boneEndX, boneY + boneThickness * 0.45, boneThickness * 0.6);
    visuals.deadBodyGraphics.endFill();

    // Subtle shading on bone knobs
    visuals.deadBodyGraphics.beginFill(boneGray);
    visuals.deadBodyGraphics.drawCircle(boneEndX + boneThickness * 0.15, boneY - boneThickness * 0.3, boneThickness * 0.25);
    visuals.deadBodyGraphics.drawCircle(boneEndX + boneThickness * 0.15, boneY + boneThickness * 0.5, boneThickness * 0.25);
    visuals.deadBodyGraphics.endFill();

    // Bone outline for definition
    visuals.deadBodyGraphics.lineStyle(1, 0xC0C0C0, 0.5);
    visuals.deadBodyGraphics.drawCircle(boneEndX, boneY - boneThickness * 0.45, boneThickness * 0.6);
    visuals.deadBodyGraphics.drawCircle(boneEndX, boneY + boneThickness * 0.45, boneThickness * 0.6);
    visuals.deadBodyGraphics.lineStyle(0);

    console.log(`[RENDER] showDeadBody - COMPLETE. bodyGraphics.visible: ${visuals.bodyGraphics.visible}, deadBodyGraphics.visible: ${visuals.deadBodyGraphics.visible}, bloodPool.visible: ${visuals.bloodPool.visible}`);
  }/**
   * Darken a color by a factor (0-1)
   */
  private drawImpostorIndicator(
    graphics: PIXI.Graphics,
    sizeMultiplier: number,
    bodyWidth: number,
    bodyHeight: number,
    bodyX: number,
    bodyY: number,
    bodyRadius: number
  ): void {
    // The body has a black outline of ~1-2px, we draw our red outline OUTSIDE that
    // Multiple layers for a soft glow effect emanating outward
    
    // Outermost glow layer - very soft and diffuse
    graphics.lineStyle(5, 0xFF0000, 0.12);
    graphics.drawRoundedRect(
      bodyX - 6 * sizeMultiplier,
      bodyY - 6 * sizeMultiplier,
      bodyWidth + 12 * sizeMultiplier,
      bodyHeight + 12 * sizeMultiplier,
      bodyRadius + 6
    );
    
    // Middle glow layer - slightly brighter
    graphics.lineStyle(4, 0xFF0000, 0.18);
    graphics.drawRoundedRect(
      bodyX - 4 * sizeMultiplier,
      bodyY - 4 * sizeMultiplier,
      bodyWidth + 8 * sizeMultiplier,
      bodyHeight + 8 * sizeMultiplier,
      bodyRadius + 4
    );
    
    // Inner glow layer - more visible
    graphics.lineStyle(3, 0xFF0000, 0.3);
    graphics.drawRoundedRect(
      bodyX - 2.5 * sizeMultiplier,
      bodyY - 2.5 * sizeMultiplier,
      bodyWidth + 5 * sizeMultiplier,
      bodyHeight + 5 * sizeMultiplier,
      bodyRadius + 2.5
    );
    
    // Main red border - solid line just outside the black body outline
    graphics.lineStyle(2, 0xFF0000, 0.8);
    graphics.drawRoundedRect(
      bodyX - 1.5 * sizeMultiplier,
      bodyY - 1.5 * sizeMultiplier,
      bodyWidth + 3 * sizeMultiplier,
      bodyHeight + 3 * sizeMultiplier,
      bodyRadius + 1.5
    );
  }

  /**
   * Darken a color by a factor (0-1)
   */
  private darkenColor(color: number, factor: number): number {
    const r = Math.floor(((color >> 16) & 0xFF) * (1 - factor));
    const g = Math.floor(((color >> 8) & 0xFF) * (1 - factor));
    const b = Math.floor((color & 0xFF) * (1 - factor));
    return (r << 16) | (g << 8) | b;
  }
}