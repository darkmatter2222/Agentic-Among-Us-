import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '@shared/types/protocol.types.ts';
import type { WorldSnapshot } from '@shared/types/simulation.types.ts';
import { diffWorldSnapshots } from '@shared/engine/stateDiff.ts';
import { GameSimulation } from './simulation/GameSimulation.js';
import { SimulationLoop } from './simulation/SimulationLoop.js';
import { SimulationTelemetry } from './observability/SimulationTelemetry.js';
import { StateHistory } from './observability/StateHistory.js';

export interface BuildOptions {
  logger?: boolean;
  tickRate?: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    simulationLoop: SimulationLoop;
    telemetry: SimulationTelemetry;
    stateHistory: StateHistory;
  }
}

export async function buildServer(options: BuildOptions = {}) {
  const fastify = Fastify({
    logger: options.logger ?? true
  });

  // Enable CORS for all origins (allows phone/other devices on LAN)
  await fastify.register(cors, { origin: true });
  
  await fastify.register(websocket);
  fastify.log.info('Registered websocket plugin');

  fastify.addHook('onRequest', async (request, reply) => {
    fastify.log.info({ url: request.url, method: request.method, ip: request.ip }, 'Incoming request');
  });

  const simulation = new GameSimulation();
  const simulationLoop = new SimulationLoop(simulation, { tickRate: options.tickRate });
  fastify.decorate('simulationLoop', simulationLoop);
  const telemetry = new SimulationTelemetry();
  const stateHistory = new StateHistory();
  fastify.decorate('telemetry', telemetry);
  fastify.decorate('stateHistory', stateHistory);

  const clients = new Set<WebSocket>();
  const HEARTBEAT_INTERVAL_MS = 15000;
  const METRICS_LOG_INTERVAL_MS = 10000;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let metricsLogTimer: NodeJS.Timeout | null = null;
  let lastBroadcastSnapshot: WorldSnapshot | null = null;

  const sendMessage = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState !== WebSocket.OPEN) {
      clients.delete(socket);
      return;
    }
    try {
      socket.send(JSON.stringify(message));
    } catch (error) {
      fastify.log.warn({ err: error }, 'Failed to send message to client');
      clients.delete(socket);
    }
  };

  const broadcast = (message: ServerMessage, serialized?: string) => {
    const payload = serialized ?? JSON.stringify(message);
    for (const socket of clients) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      } else {
        clients.delete(socket);
      }
    }
  };

  const ensureHeartbeat = () => {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      if (clients.size === 0) {
        return;
      }
      const snapshot = simulationLoop.getLatestSnapshot();
      broadcast({
        type: 'heartbeat',
        payload: {
          serverTime: Date.now(),
          tick: snapshot.tick,
        }
      });
    }, HEARTBEAT_INTERVAL_MS);
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const startMetricsLogger = () => {
    if (metricsLogTimer) return;
    metricsLogTimer = setInterval(() => {
      const summary = telemetry.getSummary();
      if (!summary.lastSample) return;
      fastify.log.debug({
        metrics: {
          avgTickMs: Number(summary.avgTickMs.toFixed(3)),
          p95TickMs: Number(summary.p95TickMs.toFixed(3)),
          avgDeltaBytes: Math.round(summary.avgDeltaBytes),
          avgAgents: Number(summary.avgAgents.toFixed(2)),
          lastTick: summary.lastSample.tick,
          connectedClients: clients.size,
        }
      }, 'simulation metrics');
    }, METRICS_LOG_INTERVAL_MS);
  };

  const stopMetricsLogger = () => {
    if (metricsLogTimer) {
      clearInterval(metricsLogTimer);
      metricsLogTimer = null;
    }
  };

  // fastify.register(websocket); // Moved to top
  // fastify.log.info('Registered websocket plugin');

  fastify.get('/health', async () => {
    const snapshot = simulationLoop.getLatestSnapshot();
    return {
      status: 'ok',
      tick: snapshot.tick,
      agents: snapshot.agents.length
    };
  });

  fastify.get('/analytics/metrics', async () => {
    const summary = telemetry.getSummary();
    return {
      ...summary,
      connectedClients: clients.size,
    };
  });

  fastify.get('/analytics/state-history', async (request) => {
    const query = request.query as { limit?: string; summaryOnly?: string };
    const limit = Math.max(1, Math.min(600, Number(query?.limit ?? '10') || 10));
    const summaryOnly = (query?.summaryOnly ?? 'false').toLowerCase() === 'true';
    const snapshots = stateHistory.getRecent(limit);

    if (summaryOnly) {
      return snapshots.map(snapshot => ({
        tick: snapshot.tick,
        timestamp: snapshot.timestamp,
        agents: snapshot.agents.length,
      }));
    }

    return snapshots;
  });

  fastify.get('/ws/state', { websocket: true }, async (socket, req) => {
    fastify.log.info({ 
      msg: 'WebSocket connection attempt', 
      ip: req.ip,
      headers: req.headers 
    });
    clients.add(socket);
    fastify.log.info('WebSocket client added');
    ensureHeartbeat();

    const initial = simulationLoop.getLatestSnapshot();
    const handshake: ServerMessage = {
      type: 'handshake',
      payload: {
        protocolVersion: PROTOCOL_VERSION,
        serverTime: Date.now(),
      }
    };
    sendMessage(socket, handshake);

    const snapshotMessage: ServerMessage = {
      type: 'snapshot',
      payload: initial,
    };
    sendMessage(socket, snapshotMessage);
    if (!lastBroadcastSnapshot) {
      lastBroadcastSnapshot = initial;
    }

    socket.on('close', () => {
      clients.delete(socket);
      if (clients.size === 0) {
        stopHeartbeat();
      }
    });

    socket.on('error', (error: Error) => {
      fastify.log.warn({ err: error }, 'WebSocket client error');
      clients.delete(socket);
      if (clients.size === 0) {
        stopHeartbeat();
      }
    });
  });

  simulationLoop.onTickMetrics((metrics) => {
    telemetry.noteTickMetrics(metrics);
  });

  simulationLoop.onSnapshot((snapshot) => {
    stateHistory.record(snapshot);

    if (clients.size === 0) {
      lastBroadcastSnapshot = snapshot;
      return;
    }

    const delta = diffWorldSnapshots(lastBroadcastSnapshot, snapshot);
    lastBroadcastSnapshot = snapshot;

    const message: ServerMessage = {
      type: 'state-update',
      payload: delta,
    };
    const serialized = JSON.stringify(message);
    broadcast(message, serialized);
    telemetry.noteBroadcast(snapshot.tick, Buffer.byteLength(serialized, 'utf8'));
  });

  fastify.addHook('onClose', async () => {
    simulationLoop.stop();
    stopHeartbeat();
    stopMetricsLogger();
    
    // Close all WebSocket connections gracefully with a proper close code
    // 1001 = "Going Away" - server is shutting down
    for (const socket of clients) {
      try {
        socket.close(1001, 'Server shutting down');
      } catch {
        // Ignore errors when closing
      }
    }
    clients.clear();
  });

  startMetricsLogger();

  return fastify;
}
