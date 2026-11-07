# Flight model spec

Owner: Stage 3. Tuned in Stage 6. Numbers are targets with tolerances; the model is a game model that reads as real, not a CFD simulation.

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
| Start arc duration (exit to trim glide) | 3.5 s | 3 to 4.5 s | Height lost about 90 m, horizontal about 60 m |
| Trim glide ratio | 3.0 | 2.8 to 3.2 | Horizontal over vertical speed |
| Trim airspeed | 45 m/s | 42 to 48 | About 160 km/h |
| Trim sink rate | 15 m/s | 13 to 17 | |
| Max glide ratio (flattest sustainable) | 3.4 | 3.2 to 3.6 | At about 38 m/s; below that mush sets in |
| Min sink rate | 12 m/s | 11 to 14 | |
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
- Orientation: quaternion. Pitch and roll inputs set target body rates scaled by control authority `clamp(v / v_trim, 0.3, 1.2)^2`. Yaw is coupled to roll (bank produces a turn via the lift vector tilting) plus a small direct nudge.
- Angle of attack derived from body axis versus velocity. Sideslip adds drag.
- Mush: below mush onset, add a sink term and halve roll authority.
- Crash: terrain penetration, or AGL under 0.5 m at airspeed over 12 m/s in wingsuit phase. Landing only in canopy phase.
- Canopy: separate parameter set, same integrator. Opening is a scripted 2.5 s blend of drag coefficient and a one-time heading preservation. Brakes and flare modify CL/CD. Flare is a timed effect so holding it too early uses it up.

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
- Canopy: deploy at trim; after 2.5 s phase is `canopy`, airspeed 9 to 13, height lost 55 to 90.
- Flare: flare at 3.5 m AGL from full flight lands under 1.5 m/s vertical.
- Determinism: two runs with identical input scripts produce bit-identical state arrays.
- Camps Bay scenario (harness): exit 1 position, trim with a slight dive early, deploy at 200 m AGL, lands with x between 2,900 and 3,100.

## 8. Harness

`tools/flight-harness.ts`, run with `npx tsx tools/flight-harness.ts <scenario> > out.csv`. Scenarios are small TS files describing input over time. The CSV columns: `t,x,y,z,vx,vy,vz,airspeed,glide,agl,alpha,phase`. The report includes a plot (any quick PNG from Python or a spreadsheet) of y versus x for the trim and Camps Bay scenarios.
