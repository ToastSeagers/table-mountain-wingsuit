# Table Mountain Wingsuit

A browser game: jump from Table Mountain, fly a wingsuit down the real terrain, deploy, land at Camps Bay. Cinematic 3D world, old-school "California Games" interface.

**Status:** planning complete, build not started. Progress tracker: https://claude.ai/artifact/4y7kfEUyNZVP5E54KU7iGN (source in `docs/status/tracker.html`).

## Where to start

| If you are… | Read |
|---|---|
| The person running the project | `PLAN.md` §6 (order of play), then `docs/agents/00-orchestrator.md` |
| An agent assigned a stage | `CLAUDE.md`, then your brief in `docs/agents/` |
| Looking for a spec | `docs/design/` (flight model, scoring, exits, look and feel) |
| Looking for what happened so far | `docs/status/STATUS.md` |

## Document map

```
PLAN.md                        master plan: scope, architecture, stages, gates, agreements
CLAUDE.md                      conventions every agent session follows
docs/01-architecture.md        stack, folders, coordinate frame, shared interfaces, data formats
docs/02-stages.md              step-by-step process per stage with checklists
docs/03-handoff-protocol.md    how agents report, report template, definition of done
docs/04-roadmap.md             everything deferred past v0.1
docs/05-agent-settings.md      model, effort and mode per job, credit strategy
docs/ASSETS.md                 asset sources and licences
docs/design/look-and-feel.md   art direction: retro chrome over cinematic 3D
docs/design/flight-model.md    wingsuit + canopy physics spec with numbers
docs/design/scoring.md         scoring rules
docs/design/exits.md           the three launch points, landing zones, realism policy
docs/agents/00..06-*.md        one brief per agent role, each with a kickoff prompt
docs/status/STATUS.md          running log, blockers, decisions
docs/status/tracker.html       source of the progress tracker artifact
data/checkpoints.json          known lat/lon/elevation points for validation
data/exits.json                launch point definitions
data/landing-zones.json        landing zone definitions
```

## Running (after Stage 0)

```
npm install
npm run dev
```
