# Agent brief 06 — QA, Balance and Release Engineer (Stage 6)

**Recommended settings:** Sonnet 5.5, effort medium, permission mode auto, fresh session. Use Haiku 5.5 subagents for lint sweeps and dead-code removal. Run the `/code-review` skill at medium once on the full diff. Why: this stage is breadth, not depth; a cheaper model with a good checklist outperforms an expensive one here.

**Depends on:** Stages 4 and 5 merged, and `docs/status/playtest-notes.md` written by the Orchestrator.

**Owns:** everything, but only for fixes. New features go to `docs/04-roadmap.md`. Tuning edits in `src/flight/tuning.ts` and `src/game/scoring-tuning.ts` must be logged.

## Mission

Ship v0.1: no crashes, feels good, runs fast, lives at a URL.

## Deliverables

1. **Bug bash.** Work through `docs/status/playtest-notes.md`, then do a fresh pass of every screen and phase for each exit, with keyboard, mouse and gamepad. Log each bug as a line in `docs/status/stage-6-bugs.md` with status.
2. **Balance pass.** Using the harness and real play: first-time runs should score about 5,000, expert runs about 15,000; the beach should be reachable from Exit 1 with a clean line and missed with a lazy one; Exit 2 should feel scary; Exit 3 should feel short and precise. Log every constant change with old, new and why.
3. **Perf pass.** Profile on the reference laptop and an integrated-GPU machine. Hit the budget in `docs/01-architecture.md` section 8. Typical wins: tile preloading on exit select, texture size, post preset defaults by GPU tier, removing allocations in the loop.
4. **Code review.** `/code-review medium` on the diff since the Stage 0 commit. Fix correctness findings; log the rest.
5. **Deploy.** Static host chosen by the Orchestrator (GitHub Pages or Netlify). Set `base` in `vite.config.ts`, long cache headers for `public/terrain/`, a `deploy` npm script. Verify the live URL in Chrome, Edge and Firefox.
6. **Lighthouse** performance 80 or better on the live URL.
7. **Release notes** `docs/status/release-v0.1.md`: what shipped, known issues, how to deploy again, attribution check against `docs/ASSETS.md`.
8. Tag `v0.1.0`.
9. `docs/status/stage-6-report.md`.

## Constraints

- No new features. If a fix needs a design decision, pick the simplest option and log it.
- Do not refactor for taste. Fix what is broken or slow.
- Keep every test green; add a regression test for each crash bug fixed.

## Kickoff prompt (paste into a new Sonnet 5.5 session, effort medium, auto mode)

```
You are the QA, Balance and Release Engineer for Table Mountain Wingsuit. Read CLAUDE.md, PLAN.md, docs/02-stages.md Stage 6, docs/03-handoff-protocol.md, docs/status/STATUS.md, docs/status/playtest-notes.md, all stage reports and your brief docs/agents/06-qa-release.md. Create branch stage-6-release. Do the bug bash, the balance pass, the performance pass, a /code-review at medium, the static deploy to the host named in STATUS.md, and Lighthouse. Log bugs in docs/status/stage-6-bugs.md and tuning changes in your report. Add no features. Commit as you go. Write docs/status/release-v0.1.md and docs/status/stage-6-report.md, append to STATUS.md, tag v0.1.0, then stop.
```
