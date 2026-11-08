# Stage 6 bug log

Status: FIXED, MITIGATED (improved, not fully proven), OPEN (carried to the roadmap), WONTFIX.

| # | Playtest item | Status | What was found and done |
|---|---|---|---|
| 1 | P1 Lion's Head line not survivable | FIXED (tooling) + decision | `tools/lions-head-dives.ts` flew 45 scripted wingsuit dives per heading (dive 0 to 6 s at -0.3, -0.6, -1, then cruise 0, 0.15, 0.4) for 40 s. Heading 275: 42 of 45 survive (the three losses are a 6 s full dive); heading 240: 45 of 45. Minimum clearance 4 m (275) and 5 m (240), independent of the dive, so the exit is flyable by hand. The "crash at 14.6 s" was the **Autopilot**: its safety deploy fired at AGL under 130 m while the ground was still falling away, opening the canopy at 87 m AGL on a cliff. It now ignores an AGL that is still rising (`src/game/Autopilot.ts`). Clifton lines now land in the zone (10 and 24 m from centre). Headings 275 / 240 and the exit position are unchanged. |
| 1b | Sea Point zone out of glide range | FIXED (data) | The zone was 2.6 km from the summit, which needs glide 4.1 against a best of 3.4 plus a short canopy leg. Moved to lat -33.9202, lon 18.3805 (south end of the Sea Point promenade, 1.86 km away, ground 2 to 4 m), radius kept at 70 m. The best scripted pilot still ends 470 m short, so it is an expert stretch; Clifton is the standard line. `docs/design/exits.md` updated. |
| 2 | P1 Results screen GPU cost | MITIGATED, not proven | The pane was hidden, so GPU timer queries here were dominated by frame pacing and GPU clock state (17 ms when frames were paced at 16 ms, 3 to 9 ms otherwise) and cannot support a number. Change: the replay behind the results panel renders at 0.75 pixel ratio (`World.setRenderScale`, called from `Game.onState`), about 44 % fewer pixels. **The Orchestrator should re-read the overlay with the pane visible (target under 4 ms).** |
| 3 | P1 second machine and first load | PARTIAL | No second GPU could be forced from here. First load of the production build served locally: 26 requests, 11.5 MB raw to a rendered title (10.5 MB height tiles, 0.84 MB webp, 0.2 MB JS); at 20 Mbps that is about 4.6 s plus latency, under the 10 s budget. Computed from sizes, not measured with real throttling. The low preset was not re-measured. |
| 4 | P2 Sun glitter column | FIXED | `src/world/atmosphereGlsl.ts` sea spec `pow(nh,900)*40 + pow(nh,80)*0.25` to `pow(nh,2400)*9 + pow(nh,120)*0.12`: narrower lobe, peak 4.4 times lower. Not re-viewed at the exit with the live sun; look at it at Gate 6. |
| 5 | P2 Canopy dark slab | FIXED | Emissive `0x6a5c44` to `0xb4a484` on the canopy material (`src/fx/PlayerAvatar.ts`). Not re-viewed in a landing shot. |
| 6 | P2 Clifton blank patch | MITIGATED | Shader mask for pale, low-saturation pixels under 4 m with no land within 30 m (`TerrainMaterial.ts`). No tile rebuild. I could not locate the original patch pixel for pixel; a top-down view of the Clifton coast showed no pale island. Risk noted in the code review. |
| 7 | P2 Ear test | OPEN | Needs a person with headphones. |
| 8 | P2 Physical gamepad | OPEN | No controller available. |
| 9 | P2 Mouse pointer lock | OPEN | Needs a visible pane. |
| 10 | P2 Trigger volumes flown | OPEN | Not flown by a person; the autopilot still earns Apostles and gorge. |
| 11 | P2 Score differs between frame drivers | FIXED (explained, test added) | The sim only advances in fixed steps. `game.test.ts` "determinism across frame rates" flies one input stream at 30, 60 and 144 fps frame times and gets identical results. The earlier 6,767 vs 6,244 came from different start offsets (the countdown waits on terrain), not the loop. |
| 12 | P3 Camera under ledges, intro cut | OPEN | Roadmap. |
| 13 | P3 Close-range texture soft | WONTFIX | Accepted for v0.1. |
| 14 | P3 Glide readout never 99 | VERIFIED | `Hud.ts` shows `--` above `GLIDE_DISPLAY_MAX` or under 0.5 m/s sink. |
| 15 | P3 Dev overlay covers speed | WONTFIX | Dev only. |
| 16 | P3 Bundle, fonts path | FIXED | Three.js in its own chunk (528 kB, 131 kB gzip; game code 187 kB, 64 kB gzip). Vite rewrites the CSS `/fonts/` URL to `/table-mountain-wingsuit/fonts/...` in the build. `base` is set for build and preview only; `npm run dev` stays at root. |
| 17 | P3 Spec inconsistencies | FIXED | `docs/design/flight-model.md`: min sink 10 (9.5 to 14), opening height 45 to 90 with end speed kept, start arc height lost about 60 m. |
| 18 | P3 Balance | DONE | See the tuning table in the stage report. |
| 19 | P3 Audit advisories | OPEN | vitest 3 dev-only advisories carried. The 500 kB warning is silenced with a justified limit of 560 kB. |
| n1 | Probe typecheck | FIXED | New `tools/low-line.ts` referenced fields that do not exist on `RunResult`; found while handling the code review. |
| n2 | `vite preview` ignored `base` | FIXED | Config now applies the base for `isPreview` too. |

## Keyboard pass

On the production build at `/table-mountain-wingsuit/` the keyboard path title, exit select, intro, countdown (Enter x3) works, and the autopilot ran The Table end to end in dev (title to results). Not done by hand: a manual flight of every exit and phase, and mouse and gamepad passes (pane hidden, no pad).
