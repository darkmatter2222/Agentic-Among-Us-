import { AIAgentManager } from '@shared/engine/AIAgentManager.ts';
import { serializeWorld } from '@shared/engine/serialization.ts';
import { WALKABLE_ZONES, LABELED_ZONES, TASKS } from '@shared/data/poly3-map.ts';
import type { WorldSnapshot } from '@shared/types/simulation.types.ts';

export interface SimulationOptions {
  numAgents?: number;
}

const DEFAULT_OPTIONS: Required<SimulationOptions> = {
  numAgents: 8,
};

export class GameSimulation {
  private readonly manager: AIAgentManager;
  private lastTimestamp: number;
  private tick: number;

  constructor(options: SimulationOptions = {}) {
    const resolved = { ...DEFAULT_OPTIONS, ...options };
    this.manager = new AIAgentManager({
      walkableZones: WALKABLE_ZONES,
      labeledZones: LABELED_ZONES,
      tasks: TASKS,
      numAgents: resolved.numAgents,
    });

    this.lastTimestamp = Date.now();
    this.tick = 0;
  }

  step(timestamp = Date.now()): WorldSnapshot {
    const deltaSeconds = Math.max(0, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;

    if (deltaSeconds > 0) {
      this.manager.update(deltaSeconds);
    }

    this.tick += 1;
    return serializeWorld(this.manager.getAgents(), this.tick, timestamp);
  }

  getAgentManager(): AIAgentManager {
    return this.manager;
  }
}
