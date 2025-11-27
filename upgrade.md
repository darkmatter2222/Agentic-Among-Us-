# Migration Checklist: Client Simulation to Fastify Server

## 1. Workspace Restructure
- [x] Create `/shared` workspace folder for common types, enums, and constants
- [x] Configure TypeScript path aliases so client and server resolve shared contracts
- [x] Decide packaging strategy (workspace package vs. standalone npm publish) and document it in `upgrade.md`
	- We will manage `shared/` as an npm workspace package inside this monorepo, keeping publishing private and consuming it via local workspace references for both server and client builds.

## 2. Server Runtime Foundation
- [x] Initialize Fastify + TypeScript project under `/server`
- [x] Add linting, TS config, and build scripts for the server package
- [x] Introduce `concurrently` dev dependency and wire `npm run dev:all` to start server + client
- [x] Document Node.js 22 LTS requirement in README / upgrade notes

## 3. Simulation Engine Migration
- [x] Move engine modules (`AIAgentManager`, state machine, movement, pathing, etc.) from client to server
	- Engine, map data, and game type definitions now live under `shared/` so the Fastify service can import them directly while the client temporarily consumes them via the shared workspace.
- [x] Replace any PIXI or DOM references inside engine code with platform-neutral abstractions
	- Verified shared engine modules depend solely on math/navigation utilities without PIXI or browser APIs.
- [x] Add serialization helpers that convert agent/world state into transport-friendly DTOs
	- Implemented shared `simulation.types` DTO contracts and `serializeAgent/World` helpers under `shared/engine/serialization.ts`.
- [x] Validate the server engine still runs deterministically headless
	- Added `GameSimulation` in `server/src/simulation` and a `npm --workspace @agentrunner/server run probe` script that steps the engine and emits serialized snapshots.

## 4. Fastify Service Layer
- [x] Implement Fastify HTTP bootstrap with health endpoint
	- `/health` now reports simulation tick/agent counts while the `SimulationLoop` starts automatically when the server boots.
- [x] Add WebSocket plugin/controller for client connections
	- `/ws/state` streams serialized `WorldSnapshot` payloads to subscribed clients and sends an initial snapshot on connect.
- [x] Build a simulation runner that ticks at 60 Hz with drift compensation
	- Added `SimulationLoop` for drift-aware scheduling plus `GameSimulation` integration and a shutdown hook.
- [ ] Integrate Worker Threads (optional toggle) for heavy AI workloads; document when to enable

## 5. Messaging Protocol
- [x] Define TypeScript types for handshake, initial snapshot, incremental updates, and heartbeats
	- Added `shared/types/protocol.types.ts` covering handshake/snapshot/delta/heartbeat messages.
- [x] Version protocol messages and include metadata for future analytics extensions
	- Introduced `PROTOCOL_VERSION` plus server timestamps in handshake to support analytics.
- [x] Implement initial snapshot broadcast on connection
	- WebSocket controller now sends handshake followed by latest snapshot when a client connects.
- [x] Implement per-tick delta broadcasts with compression or change detection
	- Server diffs snapshots via `diffWorldSnapshots` and streams `state-update` deltas each tick.
- [x] Add heartbeat/timeout handling so clients detect stale sessions
	- Fastify server pushes heartbeat frames every 15s with tick + server time metadata.

## 6. Client Refactor
- [x] Replace direct engine initialization in `App.tsx` with WebSocket connection logic
	- `SimulationClient` now drives the UI via snapshots/deltas instead of spawning a local `AIAgentManager`.
- [x] Hydrate client renderers from server-provided snapshots
	- `App.tsx` applies the latest `WorldSnapshot` to the PIXI scene each frame before rendering.
- [x] Update renderers (`GameRenderer`, `AIAgentVisualRenderer`, `AgentInfoPanel`, etc.) to consume immutable state
	- `AIAgentVisualRenderer` consumes `AgentSnapshot` data, and the panel reads summaries directly from server payloads.
- [x] Implement local buffering/smoothing if visual jitter appears at 60 Hz
	- Renderer lerps sprite positions toward server targets each frame to smooth minor network jitter.
- [x] Remove server-owned logic from client bundle and verify tree-shaking results
	- Client no longer imports shared engine classes; only protocol/snapshot types remain in the bundle.

## 7. Observability & Analytics
- [x] Instrument server ticks (duration, agent count, message size) with logs/metrics
	- Added `server/src/observability/SimulationTelemetry.ts` and wired `SimulationLoop.onTickMetrics` to emit averages/p95 plus delta byte sizes to the Fastify logger every 10 seconds.
- [x] Add optional state history buffer or replay tool for debugging
	- Implemented `StateHistory` ring buffer (≈10s of frames) for replay diagnostics.
- [x] Expose analytics-friendly data feeds for future UI dashboards
	- New `/analytics/metrics` & `/analytics/state-history` endpoints return telemetry summaries or recent snapshots for dashboards.

## 8. Testing & QA
- [x] Write unit tests for serialization and protocol typing in the shared package
	- Added Vitest plus `tests/shared/serialization.test.ts` covering serialization helpers and world delta logic.
- [x] Add integration tests that run the server simulation for fixed ticks and assert state
	- `tests/server/simulation.integration.test.ts` steps `GameSimulation` across ticks and verifies agent continuity.
- [x] Create smoke test script that launches `npm run dev:all`, waits for readiness, and pings health
	- `scripts/smoke-test.js` spawns the dev workflow, polls `/health`, and shuts everything down once ready.
- [x] Document manual QA steps (browser verification, reconnect scenarios)
	- README now includes a manual QA checklist covering browser validation, offline/online reconnect checks, and analytics endpoint verification.

## 9. Deployment & Tooling
- [ ] Update `README.md` with new development workflow and commands
- [ ] Provide guidance for building/packaging the server (Dockerfile or npm script)
- [ ] Ensure ESLint/Prettier cover server + client + shared packages consistently

## 10. Follow-Up Enhancements (Future)
- [ ] Evaluate tick-rate adjustments based on profiling (30 Hz fallback if needed)
- [ ] Design interactive analytics/control protocol for future features
- [ ] Explore automating bundle size checks and CI integration once migration stabilizes
