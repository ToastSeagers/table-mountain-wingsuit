# CLAUDE.md — project conventions for every agent session

You are working on **Table Mountain Wingsuit**, a browser wingsuit game on real Table Mountain terrain. Start by reading, in this order:

1. `PLAN.md` (scope, architecture, stages, gates, working agreements)
2. Your brief in `docs/agents/` (the kickoff prompt you were given names it)
3. `docs/status/STATUS.md` (what has happened so far, open blockers)
4. The design specs in `docs/design/` relevant to your stage

## Stack and commands

- Vite + TypeScript (strict) + Three.js. Vitest for tests. ESLint + Prettier.
- `npm run dev` — dev server. `npm run build` — production build. `npm test` — Vitest. `npm run lint` — ESLint. `npm run typecheck` — tsc --noEmit.
- Terrain pipeline: Python 3.11+ in `tools/terrain/`, `pip install -r tools/terrain/requirements.txt`.

## Rules

- **Coordinate frame is fixed:** metres, X east, Y up (metres above sea level), Z south. Origin lat −33.9500, lon 18.4100. See `docs/01-architecture.md` §3. Never put lat/lon into gameplay code; convert at the data boundary.
- **`src/flight/` imports nothing from Three.js.** It is pure TypeScript so it can be unit-tested headless. Use the tiny `Vec3` in `src/types/math.ts`.
- **Shared types live in `src/types/` and are frozen.** If you must change one, note it in `docs/status/STATUS.md` with the reason.
- **Exits and landing zones are data,** read from `data/exits.json` and `data/landing-zones.json`. No hard-coded positions in code.
- **Stay in your stage's folders** (your brief lists them). Touching other folders needs a line in your report.
- **Branch per stage:** `stage-N-short-name`. Commit small, message in imperative mood. Do not merge to `main`; the Orchestrator does.
- **Git identity is the ToastSeagers account.** The repo's local `user.name` is `ToastSeagers` and `user.email` is that account's GitHub noreply address; never change either or set a global identity. This machine also has a RhinoSFAdmin GitHub login that must not be used for this project. Only the Orchestrator creates the GitHub remote or pushes, after `gh auth switch --user ToastSeagers`.
- **Keep it green:** `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` must pass before you report.
- **Finish by reporting:** `docs/status/stage-N-report.md` from the template in `docs/03-handoff-protocol.md`, plus one line appended to `docs/status/STATUS.md`. Then stop. Do not start the next stage.
- **Tuning constants** live in `src/flight/tuning.ts` and `src/game/scoring-tuning.ts`, each with a comment giving the source or reasoning. Record every change in your report (old, new, why).
- **No real BASE exit coordinates, no real jump footage, no real jumpers' names in the game.** Launch points are game designs on real geography. See `docs/design/exits.md`.
- Assets must be licensed for redistribution. Record every asset's source and licence in `docs/ASSETS.md`.
- Performance budget: 60 fps at 1920×1080 on the reference laptop, under 60 MB of terrain data, under 10 s first load.

## Style

- TypeScript strict, no `any` without a comment. Named exports. One class or system per file.
- Prefer plain functions and small classes over deep inheritance. Three.js objects are created in `src/world/` and `src/fx/` only.
- Comments explain why, not what. Units in variable names where ambiguous (`speedMps`, `aglM`, `headingDeg`).
