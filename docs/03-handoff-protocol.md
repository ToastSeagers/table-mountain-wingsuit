# 03 — Handoff protocol

How work moves between agents and the Orchestrator without anyone re-deriving context.

## 1. Definition of done for a stage

A stage is done when all of these are true:

1. The gate checklist in `docs/02-stages.md` passes on the agent's branch.
2. `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` pass.
3. `docs/status/stage-N-report.md` exists and follows the template below.
4. One line is appended to `docs/status/STATUS.md`.
5. The agent has stopped. It has not started the next stage.

## 2. Report template

Copy this into `docs/status/stage-N-report.md`.

```markdown
# Stage N report — <name>

**Agent:** <role> · **Model/effort:** <e.g. Opus 5.5 / high> · **Branch:** stage-N-xxx · **Date:** YYYY-MM-DD

## What was built
Three to ten bullets. Name the files a reader should open first.

## How to run and verify
Exact commands. What the Orchestrator should see.

## Gate results
Copy the gate checklist and tick each item. For every numeric gate, give the measured number.

## Interface or shared-file changes
List every file touched outside the stage's own folders, with why. "None" if none.

## Tuning changes
| constant | old | new | why |

## Known issues and deferred items
Anything that does not block the gate but someone should know. Say which stage should pick it up.

## Decisions made
Choices the brief left open and what was chosen, in one line each, so later agents do not reopen them.

## Suggested next step
One or two lines.
```

## 3. STATUS.md entry format

One line per event, newest at the bottom:

```
YYYY-MM-DD · Stage N · <agent role> · <DONE | BLOCKED | NOTE> · <one sentence> · see stage-N-report.md
```

Blockers also get a short paragraph under the "Open blockers" heading in `STATUS.md`, removed when resolved.

## 4. Orchestrator gate review procedure

1. Read the report. If it does not follow the template, send it back with one message.
2. Check out the branch, run the gate checklist yourself. Do not trust numbers you did not see.
3. Pass: merge to `main` with a merge commit named `Stage N: <name>`, update the progress tracker, archive the session.
4. Fail: write the failing items into a short new session prompt ("Fix these three items from Gate N on branch stage-N-xxx, then update the report") using the same model as the stage. Do not reopen the long session.
5. If the report changed a shared type or constant, read `STATUS.md` for any running stage that depends on it and message that session.

## 5. Asking questions

Agents should not stop to ask about anything the briefs and specs answer. For true unknowns, the agent picks the most reasonable option, writes it under "Decisions made" and continues. It stops only for the blockers listed in `PLAN.md` section 5 rule 6.

## 6. Branch and merge rules

- `main` is always green and playable to the latest merged stage.
- One branch per stage, named `stage-N-short-name`.
- Rebase onto `main` before reporting if `main` moved during the stage. Resolve conflicts in your own folders; conflicts in shared folders go into the report.
- No force pushes to `main`.
