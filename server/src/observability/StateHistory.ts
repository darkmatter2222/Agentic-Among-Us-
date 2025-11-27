import type { WorldSnapshot } from '@shared/types/simulation.types.ts';

interface StateHistoryOptions {
  maxEntries?: number;
}

export class StateHistory {
  private readonly maxEntries: number;
  private readonly snapshots: WorldSnapshot[] = [];

  constructor(options: StateHistoryOptions = {}) {
    this.maxEntries = options.maxEntries ?? 600; // roughly 10 seconds at 60 Hz
  }

  record(snapshot: WorldSnapshot): void {
    this.snapshots.push(clone(snapshot));
    while (this.snapshots.length > this.maxEntries) {
      this.snapshots.shift();
    }
  }

  getRecent(limit = 10): WorldSnapshot[] {
    if (limit <= 0) {
      return [];
    }
    return this.snapshots.slice(-limit).map(entry => clone(entry));
  }

  clear(): void {
    this.snapshots.length = 0;
  }
}

function clone<T>(value: T): T {
  const maybeClone = (globalThis as typeof globalThis & { structuredClone?: <U>(input: U) => U }).structuredClone;
  if (typeof maybeClone === 'function') {
    return maybeClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}
