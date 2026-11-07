# 05 — Agent settings: which model, effort and mode for each job

Goal: spend credits where judgement and iteration matter, save them where the work is well specified. The briefs in `docs/agents/` repeat the relevant row; this file explains the reasoning and the general credit strategy.

## 1. The levers you have

| Lever | Where to set it | What it changes |
|---|---|---|
| Model | New session dialog, or the model picker in the session header | Capability versus cost. Fable 5.1 is the most capable and most expensive, then Opus 5.5, Sonnet 5.5, Haiku 5.5. |
| Effort | Session settings (effort: low, medium, high, xhigh, max) | How much the model thinks before acting. High effort on a cheap model is often better value than low effort on an expensive one. |
| Permission mode | Session settings | `auto` lets the agent run commands and edit without prompting (fast, fewer round trips). `plan` makes it design first and wait for approval. |
| Context | Fresh session versus fork | A fresh session starts cold and cheap; a fork carries this whole conversation. Every stage here starts fresh because the briefs carry the context. |
| Fast mode | `/fast` or session settings | Opus with faster output. Useful for long mechanical edits, not for design decisions. |
| Subagents | The agent decides | Explore and Haiku subagents are cheap for searching and reading; the agent should not spawn Opus subagents for routine work. |

## 2. Recommendation per job

| Job | Model | Effort | Mode | Why |
|---|---|---|---|---|
| Stage 0 bootstrap | Sonnet 5.5 | medium | auto | Scaffold, config, type files. Fully specified in the brief; no design judgement. |
| Stage 1 terrain data | Opus 5.5 | high | auto, browser allowed | Finding the right download, handling projections, GDAL quirks and odd endpoints needs debugging judgement. Browser use to inspect the City's portal. |
| Stage 2 renderer | Opus 5.5 | high | plan mode first, then auto | LOD design and hitting 60 fps is where a weak plan costs days. Approve the plan, then let it build. |
| Stage 3 flight model | Opus 5.5 | xhigh | plan mode first, then auto | This is the game. The feel comes from the model and the tuning harness. Highest effort of any stage. If credits allow, have the Orchestrator (Fable) review the plan before coding starts. |
| Stage 4 game loop and UI | Sonnet 5.5 | high | auto | Large volume of well-specified code: state machine, DOM screens, scoring from the spec. Sonnet at high effort handles this well and is far cheaper per token. |
| Stage 5 audio and post-FX | Sonnet 5.5 | medium | auto | Wiring Web Audio and Three.js postprocessing passes to existing state. Bump to high only for the replay camera if it struggles. |
| Stage 6 QA and release | Sonnet 5.5, Haiku 5.5 for sweeps | medium | auto | Bug bash, perf measurement, deploy. Use the `/code-review` skill at medium on the final diff. Haiku is fine for lint cleanup and dead-code sweeps. |
| Orchestrator (gate reviews, merges, plan changes) | Fable 5.1 or Opus 5.5 | medium | default | Short sessions, high-value decisions. Keep this session for reviewing reports and resolving conflicts, not for writing code. |
| Playtest note-taking | Haiku 5.5 | low | default | Turning your raw notes into `playtest-notes.md` and tickets. |

## 3. Credit strategy

1. **One stage, one fresh session.** Briefs are written so an agent can start cold. Never fork the planning conversation into a build session; that drags thousands of tokens of planning into every call.
2. **Plan mode for Stages 2 and 3 only.** Approving a plan costs one round trip and saves rework on the two stages where the design matters most. Everywhere else the brief is the plan.
3. **Auto permission mode for build stages.** Every permission prompt is a round trip you pay for in time, and the agent often re-reads context afterward.
4. **Say "stop and report" in every kickoff prompt.** It is in the briefs already. An agent that wanders into the next stage spends credits on work that will be redone.
5. **Keep sessions short.** When a stage report is written, archive the session. Follow-up fixes after a gate review go to a new short session with the report as context, not back into the long one.
6. **Let cheap models do the reading.** Agents should use Explore or Haiku subagents for codebase searches. This is in `CLAUDE.md`.
7. **Reserve Fable for review.** Reading a stage report, checking a gate and deciding what to merge is a few thousand tokens. That is the right use of the top model. Writing 2,000 lines of UI code is not.
8. **Pin versions.** Stage 0 pins Three.js and Vite versions so later agents do not spend tokens discovering API changes.

## 4. Rough relative cost expectation

Not a quote; a guide to where the budget goes. Assume Sonnet is 1x per token, Opus about 5x, Fable higher, and that effort multiplies output tokens.

| Stage | Expected share of total build credits |
|---|---|
| 0 | 2% |
| 1 | 15% |
| 2 | 20% |
| 3 | 25% |
| 4 | 18% |
| 5 | 8% |
| 6 | 7% |
| Orchestrator | 5% |

If you need to cut, cut effort on Stage 2 from high to medium before touching Stage 3.

## 5. Local lane: tasks that run on the laptop GPU instead of credits

The laptop has an RTX 4060 (8 GB VRAM) and Ollama is installed. Claude Code sessions cannot swap their own reasoning for a local model, so the local lane is a separate assistant used for small, well-specified, mechanical jobs, with a Claude session reviewing the result. Credits are only spent on model tokens; the terrain pipeline, builds, tests and the game itself already run locally.

**Model:** `qwen2.5-coder:7b` (4.7 GB download, installed 2026-11-07). Measured warm speed on the 4060: about 42 tokens per second with 91 percent of the model on the GPU at Ollama's default 32k context. Set the context to 8k or 16k (`OLLAMA_CONTEXT_LENGTH=16384` before starting Ollama, or `num_ctx` in the client) to fit it entirely on the GPU. Anything 14B or larger spills to CPU on 8 GB and becomes too slow to be worth it.

**Tool:** Aider in a terminal in the repo (`pip install aider-chat`, then `aider --model ollama/qwen2.5-coder:7b <files>`), or the Continue extension in VS Code pointed at Ollama. Both can read and edit files directly.

**Local-eligible tasks** (expect to check the output, these models are roughly Haiku-level and weaker on long context):

| Task | Stage | Why it fits |
|---|---|---|
| Writing harness scenario files from a described input timeline | 3 | Small, pattern-based TypeScript |
| CSV-to-PNG plot scripts (matplotlib) for stage reports | 3, 6 | Boilerplate Python |
| Tidying raw playtest notes into `playtest-notes.md` and bug lines | 4 to 6 | Text reshaping |
| Draft commit messages from a diff | all | Short, local context |
| Boilerplate unit tests from an explicit list of cases | 3, 4 | Mechanical once the list exists |
| Attribution text from `docs/ASSETS.md` | 5 | Text assembly |
| Single-file lint or formatting fixes | 6 | Tiny scope |
| Exit blurbs, menu copy, "WIPEOUT" one-liners | 4 | Low stakes, fun to iterate locally |

**Never local:** the flight model, the terrain LOD, the data pipeline's projection work, the state machine, anything touching `src/types/`, and all gate reviews. A wrong answer there costs more credits to repair than it saved.

**Realistic saving:** 5 to 10 percent of the build budget. The model and effort table above saves far more; the local lane is a bonus for the fiddly bits.

## 6. Kickoff checklist (do this for every session)

1. New session in this folder, fresh context.
2. Set model and effort from the table above.
3. Set permission mode (auto, or plan for Stages 2 and 3).
4. Paste the kickoff prompt from the bottom of the agent's brief.
5. When the report lands, read it in the Orchestrator session, run the gate, merge or send back.
6. Archive the build session.
