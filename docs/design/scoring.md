# Scoring spec

Owner: Stage 4. Balanced in Stage 6. Proximity reworked as risk-weighted, with near-miss stamps, in Stage 9. Scoring is secondary to the experience, so it must never nag. It shows up as quiet HUD ticks during flight and a satisfying tally on the results screen.

## 1. Components

| Component | What it measures | Formula (starting point) | Cap |
|---|---|---|---|
| Distance | Horizontal metres from exit to touchdown (or crash point, halved) | `distanceM * 1.0` | 6,000 |
| Air time | Seconds in `freefall` + `wingsuit` phases | `airTimeS * 40` | 4,000 |
| Proximity | Danger, not time: closeness to terrain, times speed, times how closed in the pilot is | per 120 Hz step: let `clear = min(aglM, nearest sampled terrain)`; if `clear < 50` and `airspeed > 35`: add `dt * airspeed * (50 - clear) / 50 * 2 * (0.25 + 4.5 * narrowness)` (Stage 9; section 1a) | 5,000 |
| Near misses | Passes within 6 m of terrain at speed | a lump sum per pass, `300 * (0.3 + 0.7 * narrowness)`, one stamp per pass (section 1b) | 3,000 |
| Landing | Zone and softness | zone base: 1,500 in a zone, 300 anywhere else on land, 0 in water. Multiply by softness: soft 1.0, ok 0.7, hard 0.35, crash 0. Plus zone difficulty bonus: ×1.0 / ×1.25 / ×1.5 for difficulty 1 / 2 / 3. Plus accuracy: `+500 * max(0, 1 - dist_to_centre / radius)` | 3,500 |
| Style bonuses | Named moments | see section 2 | 3,000 total |

Total = sum (distance, air time, proximity, near misses, landing, bonuses). Crash: distance halved, air time kept, proximity kept, landing 0, no style bonuses except those earned before the crash. A crash still shows a score so the run was not wasted.

Scores are integers. Tally on the results screen in the order above with a tick sound per 100 points, fast.

### 1a. Risk-weighted proximity (Stage 9)

Stage 6's proximity paid for seconds spent low and fast, so the best line was to skim an open slope at 10 m for a minute and ignore the gaps (research note 2.2, Superflight's best-documented flaw). It now pays for danger.

Every 30 Hz (one step in four of the 120 Hz simulation) the tracker samples the terrain through the `TerrainSampler` around the pilot, along and across the direction of travel (`src/game/risk.ts`, 12 height lookups):

- **Clearance** is the nearest terrain among the ground below, one close sample 8 m to each side and two ahead (12 m and 25 m). A wall 8 m off the wingtip counts as 8 m.
- **Narrowness**, 0 to 1, from how much rock stands above flight level: at 30 m and 70 m to each side and at 50 m and 110 m ahead, `wall(sample)` is 0 when the ground there is no higher than the ground under the pilot (or 15 m below flight level, whichever is higher) and 1 when it is 20 m above that. Narrowness is `0.7 * min(left, right) + 0.3 * max(ahead)`: both sides closed is most of it, rock ahead the rest. Open slope reads under 0.05 at any height; the Platteklip gully 0.3 to 0.7; a closed slot would reach 1.
- The rate is `airspeed * closeness * 2 * (0.25 + 4.5 * narrowness)` points per second, `closeness = (50 - clear) / 50`. Open ground is worth 0.25 to 0.5 of a point-unit, a gorge 3 to 4.75.

At 12 m and 50 m/s that is about 20 points a second over open slope and 90 in the Platteklip gully, up to 270 in a closed gorge. The cap stays 5,000, but skimming open ground can no longer reach it in a reasonable time (a minute of skimming is about 1,200).

### 1b. Near misses (Stage 9)

A discrete event, with a HUD stamp (`NEAR MISS +n`) and a NEAR MISSES line in the tally with the count. A pass starts when the clearance is 6 m or less at 40 m/s or more in the wingsuit or freefall, after the first 3 s. It pays `300 * (0.3 + 0.7 * narrowness)`: 90 over open ground, about 190 in the Platteklip gully, 300 in a closed gap. One pass, one stamp: the next pass can start only after the clearance has opened to 20 m and 4 s have passed since the last stamp, so skimming at 5 m for a minute is one stamp, not twenty, and a wobble beside a wall cannot stamp twice. The line is capped at 3,000. `RunResult` (a frozen shared type) has no near-miss field, so near misses are added to its `proximityScore`; the tally reads them from the breakdown.

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

Minimal. Airspeed (km/h), AGL (m), glide ratio, elapsed time, and a small running score that only appears when it changes. Altimeter beeps are audio only. A thin "line" indicator shows proximity building when under 50 m; it fills faster the more closed in the pilot is. A `NEAR MISS` stamp appears with each near miss. Nothing flashes except the deploy warning under 160 m.

## 5. Tuning constants

All in `src/game/scoring-tuning.ts` with the table above as the initial values. Stage 6 adjusts after playtests so that a good first-time run scores around 5,000 and an expert run around 15,000. Stage 9 keeps both targets: a first-time run that lands in a zone scores about 4,000 to 7,000 with a few hundred of proximity, and an expert line (the Platteklip gully at low height, the Apostles traverse, near misses, a soft landing on the beach) is built from about 5,000 of proximity, 1,000 to 2,500 of near misses, 3,000 of bonuses, up to 6,000 of distance and 3,000 of air time; see `docs/status/stage-9-report.md` for the probe numbers.
