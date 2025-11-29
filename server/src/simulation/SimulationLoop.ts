import { performance } from 'node:perf_hooks';
import type { GameSimulation } from './GameSimulation.js';
import type { WorldSnapshot } from '@shared/types/simulation.types.ts';
import { simulationLogger, perfLogger } from '../logging/index.js';

export interface SimulationLoopOptions {
  tickRate?: number;
}

export type SnapshotListener = (snapshot: WorldSnapshot) => void;
export interface TickMetrics {
  tick: number;
  timestamp: number;
  durationMs: number;
  agentCount: number;
}

const DEFAULT_TICK_RATE = 60; // Hz

export class SimulationLoop {
  private readonly simulation: GameSimulation;
  private readonly tickIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private nextTickTarget = 0;
  private lastSnapshot: WorldSnapshot | null = null;
  private listeners = new Set<SnapshotListener>();
  private metricListeners = new Set<(metrics: TickMetrics) => void>();

  constructor(simulation: GameSimulation, options: SimulationLoopOptions = {}) {
    const tickRate = options.tickRate ?? DEFAULT_TICK_RATE;
    this.simulation = simulation;
    this.tickIntervalMs = 1000 / tickRate;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.nextTickTarget = performance.now();
    this.scheduleNext();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  onSnapshot(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getLatestSnapshot(): WorldSnapshot {
    if (!this.lastSnapshot) {
      this.lastSnapshot = this.simulation.step(Date.now());
    }
    return this.lastSnapshot;
  }

  onTickMetrics(listener: (metrics: TickMetrics) => void): () => void {
    this.metricListeners.add(listener);
    return () => {
      this.metricListeners.delete(listener);
    };
  }

  private scheduleNext(): void {
    if (!this.running) return;

    const now = performance.now();

    if (!this.nextTickTarget) {
      this.nextTickTarget = now;
    }

    if (now >= this.nextTickTarget) {
      this.runTick();
      this.nextTickTarget += this.tickIntervalMs;
      if (now - this.nextTickTarget > this.tickIntervalMs) {
        this.nextTickTarget = now + this.tickIntervalMs;
      }
    }

    const delay = Math.max(0, this.nextTickTarget - performance.now());
    this.timer = setTimeout(() => this.scheduleNext(), delay);
  }

  private runTick(): void {
    const timestamp = Date.now();
    const tickStart = performance.now();
    const snapshot = this.simulation.step(timestamp);
    const durationMs = performance.now() - tickStart;
    this.lastSnapshot = snapshot;

    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        simulationLogger.error('Snapshot listener error', { error: error as Error });
      }
    }

    const metrics: TickMetrics = {
      tick: snapshot.tick,
      timestamp,
      durationMs,
      agentCount: snapshot.agents.length,
    };

    for (const listener of this.metricListeners) {
      try {
        listener(metrics);
      } catch (error) {
        perfLogger.error('Metrics listener error', { error: error as Error });
      }
    }
  }
}
