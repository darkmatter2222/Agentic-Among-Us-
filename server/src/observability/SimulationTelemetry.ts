import type { TickMetrics } from '../simulation/SimulationLoop.js';

export interface TelemetrySample extends TickMetrics {
  deltaBytes: number;
}

export interface TelemetrySummary {
  totalTicks: number;
  avgTickMs: number;
  p95TickMs: number;
  maxTickMs: number;
  avgDeltaBytes: number;
  avgAgents: number;
  lastSample: TelemetrySample | null;
}

interface SimulationTelemetryOptions {
  maxSamples?: number;
}

export class SimulationTelemetry {
  private readonly maxSamples: number;
  private samples: TelemetrySample[] = [];
  private readonly sampleByTick = new Map<number, TelemetrySample>();

  constructor(options: SimulationTelemetryOptions = {}) {
    this.maxSamples = options.maxSamples ?? 600;
  }

  noteTickMetrics(metrics: TickMetrics): void {
    let sample = this.sampleByTick.get(metrics.tick);
    if (!sample) {
      sample = {
        ...metrics,
        deltaBytes: 0,
      } satisfies TelemetrySample;
      this.samples.push(sample);
      this.sampleByTick.set(sample.tick, sample);
      this.enforceLimit();
      return;
    }

    sample.timestamp = metrics.timestamp;
    sample.durationMs = metrics.durationMs;
    sample.agentCount = metrics.agentCount;
  }

  noteBroadcast(tick: number, deltaBytes: number): void {
    let sample = this.sampleByTick.get(tick);
    if (!sample) {
      sample = {
        tick,
        timestamp: Date.now(),
        durationMs: 0,
        agentCount: 0,
        deltaBytes,
      } satisfies TelemetrySample;
      this.samples.push(sample);
      this.sampleByTick.set(tick, sample);
      this.enforceLimit();
      return;
    }

    sample.deltaBytes = deltaBytes;
  }

  getSummary(): TelemetrySummary {
    const totalTicks = this.samples.length;
    if (totalTicks === 0) {
      return {
        totalTicks: 0,
        avgTickMs: 0,
        p95TickMs: 0,
        maxTickMs: 0,
        avgDeltaBytes: 0,
        avgAgents: 0,
        lastSample: null,
      } satisfies TelemetrySummary;
    }

    const tickDurations = this.samples.map(sample => sample.durationMs);
    const deltaSizes = this.samples.map(sample => sample.deltaBytes);
    const agentCounts = this.samples.map(sample => sample.agentCount);

    const avgTickMs = average(tickDurations);
    const avgDeltaBytes = average(deltaSizes);
    const avgAgents = average(agentCounts);
    const maxTickMs = Math.max(...tickDurations);
    const p95TickMs = percentile(tickDurations, 95);

    return {
      totalTicks,
      avgTickMs,
      p95TickMs,
      maxTickMs,
      avgDeltaBytes,
      avgAgents,
      lastSample: this.samples[this.samples.length - 1] ?? null,
    } satisfies TelemetrySummary;
  }

  getRecent(limit = 120): TelemetrySample[] {
    if (limit <= 0) {
      return [];
    }
    return this.samples.slice(-limit).map(sample => ({ ...sample } satisfies TelemetrySample));
  }

  private enforceLimit(): void {
    while (this.samples.length > this.maxSamples) {
      const removed = this.samples.shift();
      if (removed) {
        this.sampleByTick.delete(removed.tick);
      }
    }
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(((percentileValue / 100) * (sorted.length - 1)))));
  return sorted[index];
}
