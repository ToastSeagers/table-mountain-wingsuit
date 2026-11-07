# STATUS — running log

Format: `YYYY-MM-DD · Stage N · role · DONE | BLOCKED | NOTE · one sentence · see file`. Newest at the bottom. Progress tracker artifact: https://claude.ai/artifact/4y7kfEUyNZVP5E54KU7iGN (source: `docs/status/tracker.html`).

## Decisions

- 2026-11-07 · Stack is Vite + TypeScript + Three.js, Python pipeline for terrain, no backend. See PLAN.md.
- 2026-11-07 · Coordinate frame fixed: metres, X east, Y up, Z south, origin -33.95 / 18.41. See docs/01-architecture.md section 3.
- 2026-11-07 · Launch points are fictional placements on real geography; no real BASE exits or footage. See docs/design/exits.md section 4.
- 2026-11-07 · Static host for v0.1: (Orchestrator to choose: GitHub Pages or Netlify).
- 2026-11-07 · Git and GitHub identity is the ToastSeagers account. Local repo `user.name` set to `ToastSeagers` and `user.email` to the account's GitHub noreply address (`61140937+ToastSeagers@users.noreply.github.com`); remote and pushes only by the Orchestrator after `gh auth switch --user ToastSeagers`. The RhinoSFAdmin login on this machine is not used for this project.

## Open blockers

(none)

## Log

2026-11-07 · Planning · Orchestrator · DONE · Plan, specs, briefs and data files written; build not started · see PLAN.md
2026-11-07 · Stage 0 · Bootstrap engineer · DONE · Vite/TS/Three scaffold, frozen types, geo module + test, pixel-font HUD scene, all scripts green · see stage-0-report.md
2026-11-07 · Stage 0 · Orchestrator · NOTE · Gate 0 PASS (test 8/8, lint, typecheck, build re-run by the Orchestrator). Shared type change: `ExitDefinition.unlock` gains `{ type: 'completed'; exitId }` to match docs/design/exits.md and data/exits.json. Stages 1 and 3 may start. · see docs/01-architecture.md section 5
2026-11-08 · Stage 1 · Terrain data engineer · DONE · Terrain tiles built from City 2 m LiDAR contours + Sentinel-2 (13.6 MB, validate.py passes all six checkpoints within 5 m); checkpoints, exits and landing zones snapped to the DEM, City aerial imagery available as an opt-in (non-commercial) · see stage-1-report.md
