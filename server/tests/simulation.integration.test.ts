import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../src/simulation/GameSimulation.js';

function collectAgentIds(snapshot: ReturnType<GameSimulation['step']>): string[] {
  return snapshot.agents.map(agent => agent.id).sort();
}

describe('GameSimulation integration', () => {
  it('produces consistent agent snapshots across ticks', () => {
    const simulation = new GameSimulation({ numAgents: 4 });

    const snapshots = [];
    let timestamp = Date.now();
    for (let i = 0; i < 5; i += 1) {
      timestamp += 200;
      snapshots.push(simulation.step(timestamp));
    }

    expect(snapshots).toHaveLength(5);
    snapshots.forEach((snapshot, index) => {
      expect(snapshot.tick).toBe(index + 1);
      expect(snapshot.agents).toHaveLength(4);
      expect(snapshot.timestamp).toBe(timestamp - (4 - index) * 200);
    });

    const baselineIds = collectAgentIds(snapshots[0]);
    snapshots.slice(1).forEach(snapshot => {
      expect(collectAgentIds(snapshot)).toEqual(baselineIds);
    });

    const first = snapshots[0];
    const last = snapshots.at(-1)!;
    const merged = new Map<string, { first: number; last: number }>();
    first.agents.forEach(agent => {
      merged.set(agent.id, { first: agent.timeInStateMs, last: agent.timeInStateMs });
    });
    last.agents.forEach(agent => {
      const record = merged.get(agent.id);
      if (record) {
        record.last = agent.timeInStateMs;
      }
    });

    const progressed = Array.from(merged.values()).some(record => record.last > record.first);
    expect(progressed).toBe(true);
  });
});
