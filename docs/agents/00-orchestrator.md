# Agent brief 00 — Orchestrator (and Stage 0 bootstrap)

Two jobs live here: the standing Orchestrator role (the person plus a review session) and the one-off Stage 0 bootstrap, which the Orchestrator can run in a cheap session.

## Part A — Orchestrator role

**Who:** you, with a Claude session for reviews. Recommended: Fable 5.1 or Opus 5.5, effort medium, default permission mode. Keep this session for judgement, not for writing code.

**Responsibilities**
1. Start each stage session with the right model and settings (`docs/05-agent-settings.md` section 5) and the kickoff prompt at the bottom of each brief.
2. Run gate checklists from `docs/02-stages.md` yourself. Merge passing branches to `main` with a merge commit named `Stage N: <name>`.
3. Keep `docs/status/STATUS.md` honest and update the progress tracker artifact after each gate.
4. Resolve shared-type or constant changes between running stages.
5. Playtest after Stage 4 and Stage 5 and write `docs/status/playtest-notes.md`.
6. Keep scope: anything new goes to `docs/04-roadmap.md`.

**Gate review prompt (paste into the Orchestrator session when a report lands)**

```
Stage N has reported. Read docs/status/stage-N-report.md and docs/02-stages.md Gate N. Check out branch stage-N-xxx, run every item on the Gate N checklist yourself, and tell me pass or fail per item with the numbers you measured. Do not merge. If anything fails, draft a short fix prompt I can give to a new session.
```

## Part B — Stage 0 bootstrap

**Recommended settings:** Sonnet 5.5, effort medium, permission mode auto, fresh session.

**Owns:** everything at this stage (the repo is empty). Creates the folder layout and shared types that all later stages depend on.

**Deliverables** (detail in `docs/02-stages.md` Stage 0)
- Git repo, `.gitignore`, first commit on `main`.
- Vite vanilla-ts project at the repo root with `three`, `vitest`, `eslint` (typescript-eslint), `prettier`, all exact-pinned.
- Folder layout from `docs/01-architecture.md` section 2, each with an `index.ts` placeholder.
- `src/types/{math,terrain,flight,game}.ts` exactly as in `docs/01-architecture.md` section 5.
- `src/world/geo.ts` with the frame constants and conversions, plus `src/world/geo.test.ts` against `data/checkpoints.json` (world X/Z within 2 m of the values computed by the formula; this is a self-consistency test, elevations are not checked here).
- Minimal scene with a DOM HUD in the chosen pixel font (self-hosted woff2 in `public/fonts/`, row added to `docs/ASSETS.md`).
- `package.json` scripts: `dev`, `build`, `preview`, `test`, `lint`, `typecheck`, `format`.
- `docs/status/stage-0-report.md` including the reference laptop spec.

**Do not** build terrain loading, physics or game states. Placeholders only.

**Kickoff prompt (paste into a new Sonnet 5.5 session, effort medium, auto mode)**

```
You are the Stage 0 bootstrap engineer for Table Mountain Wingsuit. Read CLAUDE.md, PLAN.md, docs/01-architecture.md, docs/02-stages.md (Stage 0 only), docs/03-handoff-protocol.md and docs/agents/00-orchestrator.md Part B. Then do Stage 0 exactly as specified: git init, Vite + TypeScript + Three.js scaffold with pinned versions, the folder layout, the shared types verbatim from the architecture doc, geo.ts with its test against data/checkpoints.json, a minimal scene with a pixel-font HUD, and all npm scripts. Make npm test, lint, typecheck and build pass. Commit on main. Write docs/status/stage-0-report.md using the template, append a line to docs/status/STATUS.md, then stop. Do not start any other stage.
```
