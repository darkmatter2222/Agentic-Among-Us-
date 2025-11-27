import { describe, expect, it } from 'vitest';
import { GameSimulation } from '@server/simulation/GameSimulation.js';

describe('GameSimulation integration', () => {
  it('produces consistent agent snapshots across ticks', () => {
    const simulation = new GameSimulation({ numAgents: 4 });

    const snapshots = [] as ReturnType<GameSimulation['step']>[];
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

    const baselineIds = snapshots[0].agents.map(agent => agent.id).sort();
    snapshots.slice(1).forEach(snapshot => {
      const ids = snapshot.agents.map(agent => agent.id).sort();
      expect(ids).toEqual(baselineIds);
    });

    const first = snapshots[0];
    const last = snapshots.at(-1)!;
    const stateProgressed = first.agents.some(agent => {
      const latest = last.agents.find(other => other.id === agent.id);
      return latest ? latest.timeInStateMs > agent.timeInStateMs : false;
    });

    expect(stateProgressed).toBe(true);
  });
});
