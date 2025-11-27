import { GameSimulation } from '../simulation/GameSimulation.js';

const simulation = new GameSimulation({ numAgents: 4 });
const start = Date.now();

for (let i = 0; i < 5; i++) {
  const timestamp = start + (i + 1) * 100;
  const snapshot = simulation.step(timestamp);
  const firstAgent = snapshot.agents[0];
  console.log(
    `tick=${snapshot.tick} agent=${firstAgent.id} pos=(${firstAgent.movement.position.x.toFixed(1)}, ${firstAgent.movement.position.y.toFixed(1)}) state=${firstAgent.activityState}`
  );
}
