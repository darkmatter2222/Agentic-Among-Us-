import { buildServer } from './app.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';

async function start() {
  const server = await buildServer({ logger: true, tickRate: 30 });

  try {
    await server.listen({ port: PORT, host: HOST });
    const displayHost = HOST.includes(':') ? `[${HOST}]` : HOST;
    server.log.info(`Server listening on http://${displayHost}:${PORT}`);
    server.simulationLoop.start();
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}

void start();
