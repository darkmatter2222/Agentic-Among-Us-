import type { ServerMessage, WorldDelta } from '@shared/types/protocol.types.ts';
import type { AgentSnapshot, WorldSnapshot } from '@shared/types/simulation.types.ts';
import type { LLMTraceEvent } from '@shared/types/llm-trace.types.ts';

type WorldListener = (snapshot: WorldSnapshot) => void;
type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'stale' | 'reconnecting';
type ConnectionListener = (state: ConnectionState) => void;
type LLMTraceListener = (trace: LLMTraceEvent) => void;

export class SimulationClient {
  private socket: WebSocket | null = null;
  private world: WorldSnapshot | null = null;
  private listeners = new Set<WorldListener>();
  private connectionListeners = new Set<ConnectionListener>();
  private llmTraceListeners = new Set<LLMTraceListener>();
  private state: ConnectionState = 'disconnected';
  private lastHeartbeatAt: number = 0;
  private heartbeatMonitorId: number | null = null;
  private readonly heartbeatTimeoutMs: number = 30000;
  
  // Auto-reconnection settings
  private reconnectEnabled: boolean = true;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 50;
  private readonly baseReconnectDelayMs: number = 1000;
  private readonly maxReconnectDelayMs: number = 10000;
  private reconnectTimerId: number | null = null;
  private lastUrl: string | null = null;
  private intentionalDisconnect: boolean = false;

  connect(url?: string): void {
    this.intentionalDisconnect = false;
    this.clearReconnectTimer();
    this.disconnectSocket();

    const targetUrl = url ?? this.resolveUrl();
    this.lastUrl = targetUrl;
    console.info('[simulation] attempting websocket connection', targetUrl);
    this.updateConnectionState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    try {
      this.socket = new WebSocket(targetUrl);
      console.debug('[simulation] websocket constructed', {
        readyState: this.socket.readyState,
        url: this.socket.url,
        attempt: this.reconnectAttempts
      });
    } catch (error) {
      console.error('Failed to open simulation socket:', error);
      this.updateConnectionState('disconnected');
      this.scheduleReconnect();
      return;
    }

    this.socket.addEventListener('open', () => {
      console.info('[simulation] websocket open');
      this.lastHeartbeatAt = Date.now();
      this.reconnectAttempts = 0; // Reset on successful connection
      this.updateConnectionState('connected');
      this.startHeartbeatMonitor();
    });

    this.socket.addEventListener('message', (event) => {
      const payloadPreview = event.data instanceof ArrayBuffer
        ? `ArrayBuffer(${event.data.byteLength})`
        : event.data instanceof Blob
          ? `Blob(${event.data.size})`
          : typeof event.data === 'string'
            ? `${event.data.slice(0, 60)}${event.data.length > 60 ? '…' : ''}`
            : typeof event.data;
      console.debug('[simulation] websocket message received', { preview: payloadPreview });
      this.handleMessage(event.data);
    });

    this.socket.addEventListener('close', (event) => {
      console.warn('[simulation] websocket closed', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        intentional: this.intentionalDisconnect
      });
      this.stopHeartbeatMonitor();
      this.socket = null;
      
      if (!this.intentionalDisconnect) {
        this.updateConnectionState('disconnected');
        this.scheduleReconnect();
      } else {
        this.updateConnectionState('disconnected');
      }
    });

    this.socket.addEventListener('error', (error) => {
      console.error('[simulation] websocket error', error);
      // Don't update state here - the close event will follow
    });
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();
    this.disconnectSocket();
    this.updateConnectionState('disconnected');
  }
  
  /** Check if currently connected or connecting */
  isConnected(): boolean {
    return this.state === 'connected' || this.state === 'connecting' || this.state === 'reconnecting';
  }
  
  /** Get current connection state */
  getConnectionState(): ConnectionState {
    return this.state;
  }
  
  private disconnectSocket(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.stopHeartbeatMonitor();
  }
  
  private scheduleReconnect(): void {
    if (!this.reconnectEnabled || this.intentionalDisconnect) {
      console.debug('[simulation] reconnect disabled or intentional disconnect');
      return;
    }
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[simulation] max reconnect attempts reached', this.reconnectAttempts);
      return;
    }
    
    this.clearReconnectTimer();
    
    // Exponential backoff with jitter
    const delay = Math.min(
      this.baseReconnectDelayMs * Math.pow(1.5, this.reconnectAttempts) + Math.random() * 500,
      this.maxReconnectDelayMs
    );
    
    this.reconnectAttempts++;
    console.info('[simulation] scheduling reconnect', {
      attempt: this.reconnectAttempts,
      delayMs: Math.round(delay)
    });
    
    this.updateConnectionState('reconnecting');
    
    this.reconnectTimerId = window.setTimeout(() => {
      this.reconnectTimerId = null;
      if (this.lastUrl && !this.intentionalDisconnect) {
        this.connect(this.lastUrl);
      }
    }, delay);
  }
  
  private clearReconnectTimer(): void {
    if (this.reconnectTimerId !== null) {
      window.clearTimeout(this.reconnectTimerId);
      this.reconnectTimerId = null;
    }
  }
  
  /** Enable or disable auto-reconnection */
  setReconnectEnabled(enabled: boolean): void {
    this.reconnectEnabled = enabled;
    if (!enabled) {
      this.clearReconnectTimer();
    }
  }

  onWorldUpdate(listener: WorldListener): () => void {
    this.listeners.add(listener);
    console.debug('[simulation] registered world listener', { count: this.listeners.size });
    if (this.world) {
      console.debug('[simulation] replaying latest world to new listener', { tick: this.world.tick });
      listener(this.world);
    }
    return () => {
      this.listeners.delete(listener);
      console.debug('[simulation] removed world listener', { count: this.listeners.size });
    };
  }

  onConnectionStateChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    console.debug('[simulation] registered connection listener', { count: this.connectionListeners.size });
    listener(this.state);
    return () => {
      this.connectionListeners.delete(listener);
      console.debug('[simulation] removed connection listener', { count: this.connectionListeners.size });
    };
  }

  onLLMTrace(listener: LLMTraceListener): () => void {
    this.llmTraceListeners.add(listener);
    console.debug('[simulation] registered LLM trace listener', { count: this.llmTraceListeners.size });
    return () => {
      this.llmTraceListeners.delete(listener);
      console.debug('[simulation] removed LLM trace listener', { count: this.llmTraceListeners.size });
    };
  }

  getWorld(): WorldSnapshot | null {
    return this.world;
  }

  private handleMessage(rawData: string | ArrayBufferLike | Blob): void {
    if (rawData instanceof Blob) {
      rawData
        .text()
        .then(text => this.handleMessage(text))
        .catch(error => console.warn('Failed to decode blob payload', error));
      return;
    }

    if (rawData instanceof ArrayBuffer) {
      const decoded = new TextDecoder().decode(rawData);
      this.handleMessage(decoded);
      return;
    }

      let message: ServerMessage;

      const payload = typeof rawData === 'string'
        ? rawData
        : new TextDecoder().decode(new Uint8Array(rawData as ArrayBufferLike));

      try {
        message = JSON.parse(payload) as ServerMessage;
    } catch (error) {
      console.warn('Failed to parse simulation payload', error);
      return;
    }

    switch (message.type) {
      case 'handshake': {
          console.debug('[simulation] received handshake');
          this.lastHeartbeatAt = Date.now();
        break;
      }
      case 'snapshot': {
        console.debug('[simulation] received snapshot tick', message.payload.tick);
        this.world = this.cloneWorld(message.payload);
        this.emitWorldUpdate();
        break;
      }
      case 'state-update': {
        console.debug('[simulation] received delta tick', message.payload.tick, 'agents', message.payload.agents.length);
        this.applyDelta(message.payload);
        break;
      }
      case 'heartbeat': {
        console.debug('[simulation] received heartbeat tick', message.payload.tick);
        this.lastHeartbeatAt = Date.now();
        break;
      }
      case 'error': {
        console.error('Simulation server error:', message.payload);
        break;
      }
      case 'llm-trace': {
        console.debug('[simulation] received LLM trace', { 
          agentName: message.payload.agentName, 
          requestType: message.payload.requestType,
          goalType: message.payload.parsedDecision?.goalType
        });
        for (const listener of this.llmTraceListeners) {
          listener(message.payload);
        }
        break;
      }
      default:
        console.warn('Unhandled simulation message type', (message as { type: string }).type);
    }
  }

  private applyDelta(delta: WorldDelta): void {
    console.debug('[simulation] applying delta', {
      tick: delta.tick,
      removed: delta.removedAgents.length,
      updated: delta.agents.length,
      hasWorld: Boolean(this.world)
    });
    if (!this.world) {
      console.warn('Received delta before initial snapshot');
      return;
    }

    const removed = new Set(delta.removedAgents);
    const deltaById = new Map(delta.agents.map(entry => [entry.id, entry]));

    const updatedAgents: AgentSnapshot[] = [];

    for (const agent of this.world.agents) {
      if (removed.has(agent.id)) {
        console.debug('[simulation] delta removing agent', agent.id);
        continue;
      }

      const deltaEntry = deltaById.get(agent.id);
      if (!deltaEntry) {
        updatedAgents.push(this.cloneAgent(agent));
        continue;
      }

      const cloned = this.cloneAgent(agent);

      if (deltaEntry.summaryChanged && deltaEntry.summary) {
        console.debug('[simulation] delta summary update', agent.id, deltaEntry.summary);
        cloned.activityState = deltaEntry.summary.activityState;
        cloned.locationState = deltaEntry.summary.locationState;
        cloned.currentZone = deltaEntry.summary.currentZone;
        cloned.currentGoal = deltaEntry.summary.currentGoal;
      }

      if (deltaEntry.movementChanged && deltaEntry.movement) {
        console.debug('[simulation] delta movement update', agent.id, {
          position: deltaEntry.movement.position,
          velocity: deltaEntry.movement.velocity,
          pathPoints: deltaEntry.movement.path.length
        });
        cloned.movement = {
          ...deltaEntry.movement,
          position: { ...deltaEntry.movement.position },
          velocity: { ...deltaEntry.movement.velocity },
          path: deltaEntry.movement.path.map(point => ({ ...point }))
        };
      }

      if (deltaEntry.aiStateChanged && deltaEntry.aiState) {
        console.debug('[simulation] delta AI state update', agent.id, {
          isThinking: deltaEntry.aiState.isThinking,
          currentThought: deltaEntry.aiState.currentThought?.substring(0, 30),
          recentSpeech: deltaEntry.aiState.recentSpeech?.substring(0, 30),
          visibleAgents: deltaEntry.aiState.visibleAgentIds?.length ?? 0,
          tasks: deltaEntry.aiState.assignedTasks?.length ?? 0
        });
        cloned.isThinking = deltaEntry.aiState.isThinking;
        cloned.currentThought = deltaEntry.aiState.currentThought;
        cloned.recentSpeech = deltaEntry.aiState.recentSpeech;
        cloned.visibleAgentIds = deltaEntry.aiState.visibleAgentIds;
        cloned.assignedTasks = deltaEntry.aiState.assignedTasks;
        cloned.currentTaskIndex = deltaEntry.aiState.currentTaskIndex;
        cloned.tasksCompleted = deltaEntry.aiState.tasksCompleted;
      }

      updatedAgents.push(cloned);
      deltaById.delete(agent.id);
    }

    if (deltaById.size > 0) {
      for (const entry of deltaById.values()) {
        console.warn('Delta referenced unknown agent, ignoring', entry.id);
      }
    }

    this.world = {
      tick: delta.tick,
      timestamp: delta.timestamp,
      agents: updatedAgents,
      // Preserve world-level state from delta or previous
      taskProgress: delta.taskProgress ?? this.world?.taskProgress ?? 0,
      gamePhase: delta.gamePhase ?? this.world?.gamePhase ?? 'PLAYING',
      recentThoughts: delta.recentThoughts ?? this.world?.recentThoughts ?? [],
      recentSpeech: delta.recentSpeech ?? this.world?.recentSpeech ?? [],
      llmQueueStats: delta.llmQueueStats ?? this.world?.llmQueueStats,
    };
    console.debug('[simulation] world updated to tick', delta.tick, 'agent count', updatedAgents.length, 'taskProgress', this.world.taskProgress);

    this.emitWorldUpdate();
  }

  private emitWorldUpdate(): void {
    if (!this.world) return;
    console.debug('[simulation] emitting world update to listeners', { tick: this.world.tick, listeners: this.listeners.size });
    for (const listener of this.listeners) {
      listener(this.world);
    }
  }

  private updateConnectionState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    for (const listener of this.connectionListeners) {
      listener(next);
    }
  }

  private startHeartbeatMonitor(): void {
    if (this.heartbeatMonitorId !== null) return;

    console.debug('[simulation] starting heartbeat monitor', { timeout: this.heartbeatTimeoutMs });
    this.heartbeatMonitorId = window.setInterval(() => {
      const elapsed = Date.now() - this.lastHeartbeatAt;
      if (elapsed > this.heartbeatTimeoutMs) {
        console.warn('[simulation] heartbeat timeout, triggering reconnect');
        this.updateConnectionState('stale');
        this.disconnectSocket();
        this.scheduleReconnect();
      }
    }, Math.max(5000, this.heartbeatTimeoutMs / 3));
  }

  private stopHeartbeatMonitor(): void {
    if (this.heartbeatMonitorId !== null) {
      console.debug('[simulation] stopping heartbeat monitor');
      window.clearInterval(this.heartbeatMonitorId);
      this.heartbeatMonitorId = null;
    }
  }

  private cloneWorld(snapshot: WorldSnapshot): WorldSnapshot {
    console.debug('[simulation] cloning world snapshot', { tick: snapshot.tick, agents: snapshot.agents.length });
    return {
      tick: snapshot.tick,
      timestamp: snapshot.timestamp,
      agents: snapshot.agents.map(agent => this.cloneAgent(agent))
    };
  }

  private cloneAgent(agent: AgentSnapshot): AgentSnapshot {
    console.debug('[simulation] cloning agent snapshot', agent.id);
    return {
      ...agent,
      movement: {
        ...agent.movement,
        position: { ...agent.movement.position },
        velocity: { ...agent.movement.velocity },
        path: agent.movement.path.map(point => ({ ...point }))
      }
    };
  }

  private resolveUrl(): string {
    const env = import.meta.env;
    const explicit = env?.VITE_SIMULATION_WS_URL;
    if (explicit) {
      console.debug('[simulation] using explicit websocket URL from env', explicit);
      return explicit;
    }

    const port = env?.VITE_SIMULATION_WS_PORT ?? '4000';
    const { protocol, hostname } = window.location;
    const scheme = protocol === 'https:' ? 'wss' : 'ws';
    const inferred = `${scheme}://${hostname}:${port}/ws/state`;
    console.debug('[simulation] inferred websocket URL', inferred);
    return inferred;
  }
}

// Store singleton in window to survive HMR full page reloads
const win = window as unknown as { __simulationClient?: SimulationClient };

export function getSimulationClient(): SimulationClient {
  if (!win.__simulationClient) {
    win.__simulationClient = new SimulationClient();
  }
  return win.__simulationClient;
}

export type { ConnectionState };
