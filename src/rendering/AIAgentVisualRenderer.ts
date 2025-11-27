/**
 * AI Agent Visual Renderer
 * Renders all AI agents with vision cones, action radii, and paths
 */

import * as PIXI from 'pixi.js';
import type { AgentSnapshot } from '@shared/types/simulation.types.ts';
import { VisionConeRenderer } from './VisionConeRenderer.ts';
import { ActionRadiusRenderer } from './ActionRadiusRenderer.ts';
import { PathLineRenderer } from './PathLineRenderer.ts';

export interface AgentVisuals {
  sprite: PIXI.Graphics;
  visionCone: VisionConeRenderer;
  actionRadius: ActionRadiusRenderer;
  pathLine: PathLineRenderer;
  nameText: PIXI.Text;
}

interface AgentVisualState {
  visuals: AgentVisuals;
  targetPosition: { x: number; y: number };
  targetFacing: number;
  targetPath: AgentSnapshot['movement']['path'];
  pathDirty: boolean;
}

export class AIAgentVisualRenderer {
  private static readonly SMOOTHING_SPEED = 12;

  private container: PIXI.Container;
  private agentVisuals: Map<string, AgentVisualState>;
  private showVisionCones: boolean = true;
  private showActionRadius: boolean = true;
  private showPaths: boolean = true;

  constructor() {
    this.container = new PIXI.Container();
    this.agentVisuals = new Map();
  }

  syncAgents(snapshots: AgentSnapshot[]): void {
    const activeIds = new Set<string>();

    for (const snapshot of snapshots) {
      activeIds.add(snapshot.id);
      const state = this.ensureAgentVisual(snapshot);

      state.targetPosition = { ...snapshot.movement.position };
      state.targetFacing = snapshot.movement.facing;
      state.targetPath = snapshot.movement.path.map(point => ({ ...point }));
      state.pathDirty = true;

      // Keep names in sync in case identifiers change format at runtime.
      state.visuals.nameText.text = snapshot.id;

      // Adjust dynamic radii if they change (should be rare but keeps parity with server).
      state.visuals.visionCone.updateConfig({ radius: snapshot.visionRadius * 1.4, color: snapshot.color });
      state.visuals.actionRadius.updateConfig({ radius: snapshot.actionRadius, color: snapshot.color });
      state.visuals.pathLine.updateConfig({ color: snapshot.color });
    }

    for (const [agentId, state] of this.agentVisuals) {
      if (!activeIds.has(agentId)) {
        state.visuals.sprite.destroy();
        state.visuals.visionCone.destroy();
        state.visuals.actionRadius.destroy();
        state.visuals.pathLine.destroy();
        state.visuals.nameText.destroy();
        this.agentVisuals.delete(agentId);
      }
    }
  }

  update(deltaTime: number): void {
    const lerpFactor = Math.min(1, deltaTime * AIAgentVisualRenderer.SMOOTHING_SPEED);

    for (const state of this.agentVisuals.values()) {
      const { visuals, targetPosition, targetFacing } = state;

      visuals.sprite.x += (targetPosition.x - visuals.sprite.x) * lerpFactor;
      visuals.sprite.y += (targetPosition.y - visuals.sprite.y) * lerpFactor;

      visuals.nameText.x = visuals.sprite.x;
      visuals.nameText.y = visuals.sprite.y + 32;

      if (this.showVisionCones) {
        visuals.visionCone.render({ x: visuals.sprite.x, y: visuals.sprite.y }, targetFacing);
        visuals.visionCone.setVisible(true);
      } else {
        visuals.visionCone.setVisible(false);
      }

      if (this.showActionRadius) {
        visuals.actionRadius.render({ x: visuals.sprite.x, y: visuals.sprite.y });
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
    }
  }

  toggleVisionCones(show?: boolean): void {
    this.showVisionCones = show ?? !this.showVisionCones;
  }

  toggleActionRadius(show?: boolean): void {
    this.showActionRadius = show ?? !this.showActionRadius;
  }

  togglePaths(show?: boolean): void {
    this.showPaths = show ?? !this.showPaths;
  }

  getContainer(): PIXI.Container {
    return this.container;
  }

  clear(): void {
    for (const state of this.agentVisuals.values()) {
      state.visuals.sprite.destroy();
      state.visuals.visionCone.destroy();
      state.visuals.actionRadius.destroy();
      state.visuals.pathLine.destroy();
      state.visuals.nameText.destroy();
    }
    this.agentVisuals.clear();
    this.container.removeChildren();
  }

  destroy(): void {
    this.clear();
    this.container.destroy();
  }

  private ensureAgentVisual(snapshot: AgentSnapshot): AgentVisualState {
    const existing = this.agentVisuals.get(snapshot.id);
    if (existing) {
      return existing;
    }

    const sprite = new PIXI.Graphics();
    sprite.beginFill(snapshot.color);
    sprite.drawCircle(0, 0, 15);
    sprite.endFill();
    sprite.lineStyle(2, 0xFFFFFF, 1);
    sprite.drawCircle(0, 0, 15);

    const visionCone = new VisionConeRenderer({
      radius: snapshot.visionRadius * 1.4,
      color: snapshot.color,
      alpha: 0.01,
      angle: Math.PI / 2
    });

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

    const nameText = new PIXI.Text(snapshot.id, {
      fontFamily: 'Arial',
      fontSize: 24,
      fill: 0xFFFFFF,
      stroke: { color: 0x000000, width: 2 }
    });
    nameText.anchor.set(0.5, 0);
    nameText.y = 32;

    this.container.addChild(visionCone.getContainer());
    this.container.addChild(pathLine.getContainer());
    this.container.addChild(actionRadius.getContainer());
    this.container.addChild(sprite);
    this.container.addChild(nameText);

    const state: AgentVisualState = {
      visuals: { sprite, visionCone, actionRadius, pathLine, nameText },
      targetPosition: { ...snapshot.movement.position },
      targetFacing: snapshot.movement.facing,
      targetPath: snapshot.movement.path.map(point => ({ ...point })),
      pathDirty: true
    };

    sprite.position.set(snapshot.movement.position.x, snapshot.movement.position.y);

    this.agentVisuals.set(snapshot.id, state);
    return state;
  }
}
