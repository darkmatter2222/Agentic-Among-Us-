# Shared Contracts

This workspace contains all TypeScript contracts and simulation logic shared between the Fastify simulation service and the React client.

- Place plain data definitions under `constants/`.
- Keep serializable runtime types and interfaces under `types/`.
- Group enumerations that describe common state under `enums/`.
- Authoritative AI/navigation logic now lives under `engine/` and should remain platform agnostic.

All files in this package should remain platform-agnostic—no DOM, PIXI, or Node-specific dependencies.
