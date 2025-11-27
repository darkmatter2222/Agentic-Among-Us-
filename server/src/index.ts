import { buildServer } from './app.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';

async function start() {
  const server = await buildServer({ logger: true, tickRate: 30 });

  // Handle graceful shutdown for hot-reload scenarios
  const shutdown = async (signal: string) => {
    server.log.info(`Received ${signal}, shutting down gracefully...`);
    try {
      await server.close();
      server.log.info('Server closed successfully');
      process.exit(0);
    } catch (error) {
      server.log.error(error, 'Error during shutdown');
      process.exit(1);
    }
  };

  // Listen for termination signals (SIGTERM, SIGINT from Ctrl+C, SIGHUP from terminal close)
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));

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
