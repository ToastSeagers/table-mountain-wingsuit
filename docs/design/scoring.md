# Scoring spec

Owner: Stage 4. Balanced in Stage 6. Scoring is secondary to the experience, so it must never nag. It shows up as quiet HUD ticks during flight and a satisfying tally on the results screen.

## 1. Components

| Component | What it measures | Formula (starting point) | Cap |
|---|---|---|---|
| Distance | Horizontal metres from exit to touchdown (or crash point, halved) | `distanceM * 1.0` | 6,000 |
| Air time | Seconds in `freefall` + `wingsuit` phases | `airTimeS * 40` | 4,000 |
| Proximity | Time spent close to terrain while fast | per 120 Hz step: if `aglM < 50` and `airspeed > 35`: add `dt * airspeed * (50 - aglM) / 50 * 4` (Stage 6: was 40 m and 2.5) | 5,000 |
| Landing | Zone and softness | zone base: 1,500 in a zone, 300 anywhere else on land, 0 in water. Multiply by softness: soft 1.0, ok 0.7, hard 0.35, crash 0. Plus zone difficulty bonus: ×1.0 / ×1.25 / ×1.5 for difficulty 1 / 2 / 3. Plus accuracy: `+500 * max(0, 1 - dist_to_centre / radius)` | 3,500 |
| Style bonuses | Named moments | see section 2 | 3,000 total |

Total = sum. Crash: distance halved, air time kept, proximity kept, landing 0, no style bonuses except those earned before the crash. A crash still shows a score so the run was not wasted.

Scores are integers. Tally on the results screen in the order above with a tick sound per 100 points, fast.

## 2. Style bonuses (v0.1 set)

| id | Label | Condition | Points |
|---|---|---|---|
| `ghost` | Ghost line | 5 continuous seconds under 15 m AGL above 40 m/s | 800 |
| `gorge` | Through the gorge | Pass through the Platteklip Gorge trigger volume (defined in `data/triggers.json`) below the rim height | 700 |
| `apostles` | Twelve Apostles traverse | Pass three Apostles trigger volumes in order | 700 |
| `beach` | Toes in the sand | Soft landing on Camps Bay beach zone | 500 |
| `late` | Late pull | Deploy between 120 and 160 m AGL and land soft or ok | 400 |
| `clean` | Clean exit | Start arc without pitch input oscillation over 0.6 amplitude | 200 |
| `long` | Long haul | Air time over 75 s | 300 |

Trigger volumes are axis-aligned boxes in world space in `data/triggers.json`, authored in Stage 4 using the free camera to find positions. Each bonus is awarded once per run and shows a brief HUD stamp in the retro style.

## 3. High scores

- Per exit, top 10, three-letter initials, stored in `localStorage` under `tmw.scores.v1`.
- Entry screen appears only when the run makes the table.
- Also store the best `RunResult` per exit (with replay) for a future ghost mode.

## 4. HUD during flight

Minimal. Airspeed (km/h), AGL (m), glide ratio, elapsed time, and a small running score that only appears when it changes. Altimeter beeps are audio only. A thin "line" indicator shows proximity multiplier building when under 50 m. Nothing flashes except the deploy warning under 160 m.

## 5. Tuning constants

All in `src/game/scoring-tuning.ts` with the table above as the initial values. Stage 6 adjusts after playtests so that a good first-time run scores around 5,000 and an expert run around 15,000.
