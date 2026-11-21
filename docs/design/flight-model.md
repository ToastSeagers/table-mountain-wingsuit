# Flight model spec

Owner: Stage 3. Tuned in Stage 6. Glide made dynamic in Stage 8 (section 4a). Numbers are targets with tolerances; the model is a game model that reads as real, not a CFD simulation.

## 1. What the player should feel

1. **The exit.** You step off and for about three seconds you are falling, not flying. The ground comes up fast. Then the suit "catches" and the horizon tilts forward as speed turns into glide. This is the start arc and it is the scariest and best moment. Do not skip it.
2. **Dive to go fast, flatten to go far.** Pitching down trades height for airspeed; pitching up spends airspeed for a flatter glide. Hold too flat for too long and you mush: sink rate rises and controls go soft. Dive too hard and the ground arrives.
3. **Terrain is the texture of the flight.** Speed feels like speed only when the ground is close. The model must make proximity possible and survivable with skill.
4. **The pull.** Deploy is a decision with a cost. Too early loses the line and lands short. Too late is a crash. The opening takes real time and real height.
5. **Under canopy it slows down.** A gentler second act: pick the landing zone, set up, flare at the right height.

## 2. Reference numbers (wingsuit)

| Quantity | Target | Tolerance | Notes |
|---|---|---|---|
| Mass (pilot plus gear) | 90 kg | fixed | |
| Start arc duration (exit to trim glide) | 3.5 s | 3 to 4.5 s | Height lost about 60 m (model; under 120 required), horizontal about 40 m |
| Trim glide ratio | 3.0 | 2.8 to 3.2 | Horizontal over vertical speed |
| Trim airspeed | 45 m/s | 42 to 48 | About 160 km/h |
| Trim sink rate | 15 m/s | 13 to 17 | |
| Max glide ratio (flattest sustainable) | 3.4 | 3.2 to 3.6 | At about 38 m/s; below that mush sets in |
| Min sink rate | 10 m/s | 9.5 to 14 | Stage 6 decision: the model's polar gives 9.6 at 33 m/s, which follows from the max-glide row (3.4 at 38 m/s is 10.7 m/s of sink). The old 12 (11 to 14) contradicted that row, so the sink row yields |
| Max dive airspeed | 75 m/s | 70 to 80 | Steep dive, glide about 1.2 |
| Mush onset airspeed | 32 m/s | 30 to 35 | Below this, sink rises sharply and roll authority halves |
| Roll rate at trim | 120 deg/s | 100 to 150 | Scales with airspeed squared, clamped |
| Pitch rate at trim | 45 deg/s | 35 to 60 | |
| Yaw authority | low | | Mostly coordinated with roll; direct yaw input is a small nudge |
| Max g-load | 3.5 g | | Pull-ups above this bleed speed hard (simulated stall buffet) |

Table Mountain context: western table edge at about 1,050 m to Camps Bay beach at 0 m is roughly 3,000 m horizontal. At glide 3.0 that is reachable with little to spare. That is the design: the beach is a real target, not a given.

## 3. Reference numbers (canopy)

| Quantity | Target | Notes |
|---|---|---|
| Deploy input to full canopy | 2.5 s | Height lost about 70 m, airspeed decays to canopy speed with a 2.5 g peak |
| Minimum safe deploy AGL (game rule) | 120 m | Below this, opening completes but landing is "hard" unless terrain falls away |
| Canopy forward speed | 11 m/s | Full flight, no brakes |
| Canopy sink rate | 4 m/s | Glide about 2.75 |
| Brakes (hold) | forward 7 m/s, sink 3 m/s | Turns slower, steeper descent on release |
| Turn rate | 60 deg/s at full input | Banked turns increase sink |
| Flare | hold in the last 3 to 4 m | Vertical speed under 1.5 m/s and forward under 5 m/s = soft landing |
| Landing classification | soft under 1.5 m/s vertical; ok under 3; hard under 5; crash above 5 or forward over 9 | Feeds `landingScore` |
| Wind | none in v0.1 | Roadmap |

## 4. Model structure

Pure functions over `FlightState`, stepped at 120 Hz with semi-implicit Euler. No Three.js.

```
forces = gravity + lift + drag + (controls as moments)
lift  = 0.5 * rho * v^2 * S * CL(alpha)
drag  = 0.5 * rho * v^2 * S * CD(alpha)
```

- `rho` = 1.15 (sea level, warm day). Optionally vary with altitude (small effect, fine to ignore).
- `S` = 1.6 m^2 effective. Tune `S`, `CL(alpha)`, `CD(alpha)` to hit the table. A simple piecewise linear CL with a soft stall past 18 degrees and a CD parabola (`CD0 + k * CL^2`) is enough.
- Start arc: the suit's effective `S` ramps from 0.3 to 1.0 of full over the first 3 s after exit as the pilot "gets flying", gated also by airspeed. This produces the drop and the catch.
- Orientation: quaternion. Roll input sets a target body rate scaled by control authority `clamp(v / v_trim, 0.3, 1.2)^2`; pitch input commands a body attitude (section 4a). Yaw is coupled to roll (bank produces a turn via the lift vector tilting) plus a small direct nudge.
- Angle of attack derived from body axis versus velocity. Sideslip adds drag.
- Mush: below mush onset, add a sink term and halve roll authority.
- Crash: terrain penetration, or AGL under 0.5 m at airspeed over 12 m/s in wingsuit phase. Landing only in canopy phase.
- Canopy: separate parameter set, same integrator. Opening is a scripted 2.5 s blend of drag coefficient and a one-time heading preservation. Brakes and flare modify CL/CD. Flare is a timed effect so holding it too early uses it up.

## 4a. The glide ratio is an outcome, not a setting (Stage 8)

Stage 3 closed the pitch loop on a commanded flight-path angle, so zero input held glide 3.0 and the stick asked for a glide. Stage 8 replaced that with an attitude command, which is what a pilot actually holds:

- **Pitch input commands a body pitch attitude.** Zero input is the trim attitude, derived in `aero.ts` as trim alpha minus the trim path angle the polar gives (about -14.7 deg). Full nose-up is 12 deg above that; full nose-down is 55 deg below on a 1.3-power curve (half input about -37 deg).
- **Angle of attack is attitude plus the path angle below the horizon**, limited by alpha protection (20 deg, just past the soft stall). The alpha spring from Stage 3 tracks that target at the spec pitch rate. Nothing commands the glide: lift and drag at the resulting alpha, on the polar, decide the path, the speed and therefore the ratio the HUD shows.
- **Why it is stable.** Holding an attitude damps the phugoid strongly (as the path rises, alpha falls), so the 20 s oscillation Stage 3 fought never appears. A hands-off speed trim (0.8 deg of attitude per m/s away from the commanded attitude's own steady speed, capped at 10 deg, fading with any stick input) shortens the approach to trim speed after the catch and after a float; it does not move the steady state.
- **What emerges.** Trim settles at the polar's L/D for the trim alpha (3.0 at 45 m/s). A slight pull reaches best glide, 3.44 at 35 m/s (alpha 7). Pushing forward lowers alpha and the L/D with it: 2.1 at 60 m/s, 1.2 at 72 m/s (half input), 0.4 at 77 m/s (full), where the fold and the flutter wall pin the speed. A held bank tilts the lift so the path steepens until alpha supplies the extra load: roll 0.3 (48 deg of bank) is 1.33 g, 17 m/s of sink and glide 2.4. A full pull floats first (lift above weight: glide rises past 6 as sink drops to 6 m/s), then the suit decays through 35 m/s into mush with the sink coming back up to 11 to 15 m/s at 25 m/s. Holding too flat is the player's own doing, which is feel #2.
- **Ground effect** (research note 2.6) is a lift multiplier `1 + gain * (1 - agl / 20 m)^2` under 20 m AGL, `GROUND_EFFECT` in tuning, gain 0 (off) until a human judges it in play.
- `aero.ts` exposes the steady-state views used by the tests and harness: `steadyGlide(alpha)`, `steadyAirspeed(alpha)`, `bestGlideAlphaDeg()`, `steadyAlphaForAttitude(theta)` (a table built at load) and `attitudeCommandDeg(input, airspeed)`.

## 5. Inputs

`FlightInput`: `pitch` (-1 nose down, +1 nose up), `roll`, `yaw` in -1..1, `deploy` edge-triggered, `flare` and `brake` held.

Default keyboard: W/S pitch, A/D roll, Q/E yaw, Space deploy, Shift brake, Space held after deploy = flare, R restart, C camera, Esc pause. Mouse: Y pitch, X roll when pointer locked. Gamepad: left stick pitch and roll, triggers yaw, A deploy and flare, LB brake.

Input smoothing: a 120 ms low-pass on keyboard inputs so taps do not jerk. None on analog.

## 6. Stub terrain for headless work

`StubTerrain` in `src/flight/stub-terrain.ts`: heading west from x = 0, the ground is at y = 1,050 for x < 0, drops vertically to y = 350 at x = 0, then slopes at 15 degrees down to y = 0 at about x = 1,300, then flat at y = 0 (the "sea"). Camps Bay beach stand-in is x from 2,900 to 3,100. Good enough for every test in Gate 3.

## 7. Tests (Vitest, all deterministic)

- Trim test: hold zero input from exit for 20 s; after the start arc, glide 2.8 to 3.2 and airspeed 42 to 48.
- Start arc: time until glide exceeds 2.5 is 3 to 4.5 s; height lost under 120 m.
- Dive: full nose down for 6 s reaches 70 to 80 m/s and does not exceed 80.
- Flatten: full nose up from trim reaches max glide 3.2 to 3.6 then mushes; sink rises after airspeed drops below 35.
- Roll: full roll at trim gives 100 to 150 deg/s; at 30 m/s under 75 deg/s.
- Canopy: deploy at trim; after 2.5 s phase is `canopy`, airspeed 9 to 13, height lost 45 to 90 (model: about 50 m at 12.6 m/s, peak 3.7 g; Stage 6 decision: the end-speed row is kept over the old 55 to 90 height and 2.5 g, because a 2.5 g stop leaves about 20 m/s at 2.5 s).
- Flare: flare at 3.5 m AGL from full flight lands under 1.5 m/s vertical.
- Determinism: two runs with identical input scripts produce bit-identical state arrays.
- Polar and dynamic glide (Stage 8, `polar.test.ts`): best-glide alpha above trim with L/D 3.3 to 3.6 and lower either side; steady airspeed falls with alpha; L/D collapses past the stall; held pitch sweep gives 3.3 to 3.5 slower than trim, under 1.5 at full nose-down with faster always lower; a held bank raises load factor and sink and lowers glide; a full pull floats then mushes; release returns to trim speed within a few seconds; ground effect off by default.
- Camps Bay scenario (harness): exit 1 position, trim with a slight dive early, deploy at 200 m AGL, lands with x between 2,900 and 3,100.

## 8. Harness

`tools/flight-harness.ts`, run with `npx tsx tools/flight-harness.ts <scenario> > out.csv`. Scenarios are small TS files describing input over time. The CSV columns: `t,x,y,z,vx,vy,vz,airspeed,glide,agl,alpha,phase`. The report includes a plot (any quick PNG from Python or a spreadsheet) of y versus x for the trim and Camps Bay scenarios.
