# Agent Runner Workspace

## Prerequisites
- Node.js 22 LTS or newer
- npm 10+

## Installation
```bash
npm install
```

## Development Commands
- `npm run dev:all` – start both the Fastify simulation server and the Vite client in watch mode
- `npm run dev:server` – run only the server workspace (`@agentrunner/server`)
- `npm run dev:client` – run only the React client
- `npm --workspace @agentrunner/server run probe` – execute a short headless simulation run to verify the engine

## Build & Lint
- `npm run build` – type-check shared contracts and server, then build the client bundle
- `npm run lint` – lint client, server, and shared TypeScript sources

## Tests & Smoke Checks
- `npm test` – run the Vitest suite across shared/server packages
- `npm run test:watch` – watch mode for the test suite during development
- `npm run smoke:test` – launch the full stack (`dev:all`), poll `/health`, then shut everything down when ready

## Manual QA Checklist
1. `npm run dev:all` to start the Fastify simulation server (port 4000) and Vite client (port 5173).
2. Open http://localhost:5173 in a Chromium-based browser and confirm:
	- Agents render on the Skeld map and continue moving for at least 30 seconds.
	- The Agent Activity panel updates without stalling (watch for frozen timestamps).
3. Open the browser devtools console and ensure the WebSocket handshake logs `connected` and periodic heartbeats from `SimulationClient`.
4. Simulate a dropped connection:
	- In devtools, toggle the Network tab to `Offline` for ~5 seconds, then return to `Online`.
	- Verify the console logs a `stale` state followed by a `connected` state after the connection recovers.
5. With the stack still running, curl or open http://localhost:4000/analytics/metrics to view current tick timing averages and confirm JSON output.
6. When finished, stop `npm run dev:all` with `Ctrl+C` in the terminal.

## Workspace Layout
- `shared/` – TypeScript contracts shared between client and server workspaces
- `server/` – Fastify application that will host the simulation and WebSocket protocol
- `src/` – React client responsible purely for rendering streamed state

Refer to `upgrade.md` for the migration checklist and current progress.
