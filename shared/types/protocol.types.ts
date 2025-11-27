import type { AgentSnapshot, AgentSummarySnapshot, WorldSnapshot } from './simulation.types.ts';

export const PROTOCOL_VERSION = '0.1.0';

export interface HandshakePayload {
  protocolVersion: string;
  serverTime: number;
}

export interface SnapshotMessage {
  type: 'snapshot';
  payload: WorldSnapshot;
}

export interface StateDeltaMessage {
  type: 'state-update';
  payload: WorldDelta;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  payload: HeartbeatPayload;
}

export interface ErrorMessage {
  type: 'error';
  payload: {
    code: string;
    message: string;
  };
}

export type ServerMessage =
  | ({ type: 'handshake'; payload: HandshakePayload })
  | SnapshotMessage
  | StateDeltaMessage
  | HeartbeatMessage
  | ErrorMessage;

export interface WorldDelta {
  tick: number;
  timestamp: number;
  agents: AgentDelta[];
  removedAgents: string[];
}

export interface AgentDelta {
  id: string;
  summaryChanged: boolean;
  summary?: AgentSummarySnapshot;
  movementChanged: boolean;
  movement?: AgentSnapshot['movement'];
}

export interface HeartbeatPayload {
  serverTime: number;
  tick: number;
}
