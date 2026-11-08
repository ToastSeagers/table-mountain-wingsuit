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
2026-11-08 · Stage 1 · Terrain data engineer · NOTE · Owner confirmed the project is personal and non-commercial, so the shipped textures are now the City of Cape Town January 2025 aerial mosaic (5 cm source at 1.25 m/px); total 26.7 MB, validate.py still PASS; Sentinel-2 kept as the water index and `--imagery s2` fallback · see stage-1-report.md
2026-11-08 · Stage 3 · Flight physics engineer · DONE · Headless wingsuit and canopy model in src/flight (pure TS), 64 Vitest tests, tsx harness with CSV, plots and measured-vs-target table; Camps Bay scenario lands on the beach at x 3,026; two spec rows (min sink, opening height loss) documented as physically inconsistent with their neighbours · see stage-3-report.md
2026-11-08 · Stages 1+3 · Orchestrator · NOTE · Gate 1 PASS (validate.py 6/6 within 5 m, seams exact, 26.7 MB) and Gate 3 PASS (64 tests, trim glide 2.90, Camps Bay soft at x 3,026) re-run by the Orchestrator; both branches merged to main. Both sessions ran on Fable 5.1 in auto mode, not Opus (restart after the worktree trust prompt dropped the override; see docs/05-agent-settings.md section 6 step 5). Shipped texture is the City aerial under non-commercial terms; Sentinel-2 fallback via build.py --imagery s2. Stage 2 may start; Stage 4 waits on Stage 2. · see stage-1-report.md, stage-3-report.md
2026-11-08 · Stage 2 · Rendering engineer · DONE · Quadtree terrain renderer with streamed tiles, skirts, golden-hour sky/sun/fog/sea, sampler within 4e-5 m of the mesh (under 1 m within 700 m of the drawn LOD), RTX 4060 at 1080p: under 3 ms per frame, at most 559k triangles and 66 draw calls, 60 fps vsync-capped; Stage 1 blank patch off Clifton noted · see stage-2-report.md
