# Launch points, landing zones and the realism policy

Owner: Stage 4 (data), Stage 1 (checkpoint verification). The three v0.1 launch points are game designs placed on real geography. Positions below are approximate and must be refined in Stage 1 against the DEM (snap each to a ledge with a steep drop in the stated direction) and then in Stage 4 by flying them.

## 1. The three launch points

### Exit 1 — The Table (western edge)
- **Approx lat/lon:** -33.9585, 18.4010 (western edge of the table top above the Twelve Apostles side, south-west of the upper cable station)
- **Elevation:** about 1,050 m
- **Heading:** 265 (west, slightly south)
- **Line:** straight off the edge, down the Apostles face, over Camps Bay Drive, to Camps Bay beach or The Glen.
- **Difficulty:** 1. The gentle introduction: big drop, obvious target, reachable beach.
- **Blurb:** "The classic. Step off the top of the Table and chase the sun down to Camps Bay."

### Exit 2 — Platteklip (north face)
- **Approx lat/lon:** -33.9605, 18.4090 (table edge at the head of Platteklip Gorge, just east of the gorge)
- **Elevation:** about 1,070 m
- **Heading:** 350 (north, into the City Bowl)
- **Line:** down the north face past the gorge, over Tafelberg Road, to the Upper Orange Road field or across to the UCT fields with a long right turn.
- **Difficulty:** 3. Steep, close to rock, and the city bowl landing zones are small. The gorge bonus is here.
- **Blurb:** "Down the front of the mountain with the whole city in your lap. Pick your field early."

### Exit 3 — Lion's Head
- **Approx lat/lon:** -33.9353, 18.3890 (summit)
- **Elevation:** about 669 m
- **Heading:** 300 (north-west toward Sea Point) or 240 (south-west toward Clifton), player chooses via two sub-exits in the JSON
- **Line:** a shorter, lower flight. Less height means less time, so this is the technical one for proximity over the lower slopes and a precise landing at Sea Point Promenade or Clifton beach.
- **Difficulty:** 2.
- **Blurb:** "Low, fast and short. There is not much mountain, so use all of it."

Unlocks: Exit 1 always open. Exit 2 and Exit 3 open after any completed run from Exit 1 (not a score threshold; we want people flying, not grinding).

## 2. Landing zones (v0.1)

These are real open areas used by the paragliding community around the mountain, which makes them plausible and recognisable. Positions approximate; refine in Stage 1 on imagery.

| id | Name | Approx lat/lon | Radius | Surface | Difficulty |
|---|---|---|---|---|---|
| `camps-bay-beach` | Camps Bay Beach | -33.9510, 18.3775 | 120 m | sand | 1 |
| `the-glen` | The Glen Country Club | -33.9437, 18.3800 | 60 m | grass | 2 |
| `clifton` | Clifton Fourth Beach | -33.9400, 18.3760 | 50 m | sand | 2 |
| `sea-point-prom` | Sea Point Promenade lawns | -33.9125, 18.3900 | 70 m | grass | 2 |
| `upper-orange` | Upper Orange Road field | -33.9385, 18.4140 | 55 m | grass | 3 |
| `uct-fields` | UCT sports fields | -33.9570, 18.4640 | 90 m | grass | 2 |
| `tafelberg-road` | Tafelberg Road verge (emergency) | -33.9530, 18.4120 | 40 m | tarmac | 3 |

Anywhere else on land is "landed, no zone" (300 base points). Water is a zero-point landing with a wet-suit joke on the results screen.

## 3. Checkpoints for terrain validation

`data/checkpoints.json`, used by Stage 0 (geo conversion test) and Stage 1 (DEM validation).

| Name | lat | lon | expected elevation (m) | tolerance |
|---|---|---|---|---|
| Maclear's Beacon | -33.9628 | 18.4098 | 1085 | 15 |
| Upper cable station | -33.9566 | 18.4036 | 1067 | 15 |
| Lion's Head summit | -33.9353 | 18.3890 | 669 | 15 |
| Signal Hill summit | -33.9218 | 18.3990 | 350 | 15 |
| Camps Bay beach (sea) | -33.9510 | 18.3770 | 0 | 3 |
| Sea Point promenade | -33.9125 | 18.3900 | 5 | 5 |

## 4. Realism policy (read this)

BASE jumping is illegal in Table Mountain National Park and there have been fatalities, including one in January 2026. The game is a fantasy of flight on real geography, not a guide. So:

- **No real BASE exit coordinates, routes or names.** Our launch points are chosen for gameplay from the DEM, not copied from anywhere. If a Stage 1 or Stage 4 agent finds a real exit documented online, do not use it or reference it.
- **No real jump footage, screenshots from it, or real jumpers' names or likenesses** in the game or the repo. Footage is reference for feel only (speed sensation, camera FOV, phase durations) and nothing from it is copied.
- **A short disclaimer on the title screen,** in the retro style: fictional launch points, do not attempt, BASE jumping is prohibited in the park.
- **Landing zones are real public places,** which is fine; they are in the public paragliding site guide.
- Tone: joyful, not edgy. No death counters, no gore on crash (a hard cut to black, a thud, a retro "WIPEOUT" card is the California Games way).
