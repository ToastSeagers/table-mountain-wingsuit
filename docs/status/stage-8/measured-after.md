| Group | Quantity | Target | Measured | OK | Note |
|---|---|---|---|---|---|
| wingsuit | Start arc duration (glide > 2.5) | 3.5 s (3 to 4.5) | 4.33 s | yes | wingsuit phase at 2.51 s |
| wingsuit | Start arc height lost | about 90 m (< 120) | 60 m | yes |  |
| wingsuit | Start arc horizontal | about 60 m | 50 m | info | peak sink 20.1 m/s, peak g 2.13 |
| wingsuit | Trim glide ratio | 3.0 (2.8 to 3.2) | 2.84 | yes |  |
| wingsuit | Trim airspeed | 45 m/s (42 to 48) | 44.1 m/s | yes |  |
| wingsuit | Trim sink rate | 15 m/s (13 to 17) | 14.6 m/s | yes | g-load 1.01 |
| wingsuit | Max glide ratio (sustained, held pitch) | 3.4 (3.2 to 3.6) at about 38 m/s | 3.47 at 35.2 m/s | yes | pitch input +0.5 |
| wingsuit | Min sink rate (sustained) | 10 m/s (9.5 to 14, Stage 6 row) | 9.7 m/s at 35.2 m/s | yes | pitch input +0.5 |
| glide | Polar best L/D (clean, steady) | 3.3 to 3.5 at best-glide speed | 3.44 at alpha 7.1 deg, 35.9 m/s | yes | trim alpha 3.71 deg gives 3.00 at 45.0 m/s |
| glide | Full dive steady glide (held full nose down) | 1.5 or less, 70 to 80 m/s | 0.38 at 76.9 m/s | yes | quarter nose down: 2.12 at 60.1 m/s (faster is lower L/D) |
| glide | Horizontal speed, trim to full dive | roughly 100 to 180 km/h | 150 km/h at trim, 98 km/h horizontal in the full dive | yes |  |
| glide | Held bank (roll 0.3): load factor and sink | load factor > 1.2, more sink, lower glide than level | bank 48 deg, 1.33 g, sink 17.3 m/s, glide 2.36 | yes | level: sink 14.2 m/s, glide 2.99 |
| glide | Full pull-back: float then mush | glide rises, then airspeed under mush onset with sink back up | peak glide 6.39 at 16.2 s, then 24.8 m/s at 28.1 s with sink 11.5 m/s, mush 0.97 | yes |  |
| glide | Ground effect | off by default (research 2.6: 1.0 to 1.3 over 20 m, for a human to judge) | maxLiftGain 0, heightM 20 | info |  |
| wingsuit | Dive: airspeed after 6 s full nose down | 70 to 80 m/s | 73.3 m/s | yes | glide 0.38 at that point |
| wingsuit | Max dive airspeed (whole run) | 75 m/s (70 to 80), never > 80 | 73.3 m/s | yes |  |
| wingsuit | Half nose-down steady glide | glide about 1.2 (spec dive note) | 1.12 at 69.4 m/s | info |  |
| wingsuit | Max g-load (full pull from the dive) | 3.5 g cap | 3.90 g | yes |  |
| wingsuit | Mush onset airspeed | 32 m/s (30 to 35) | 30.0 m/s | yes | sink 6.3 at 35 m/s, 11.5 at the slowest point (24.8 m/s) |
| wingsuit | Roll rate at trim (full input) | 120 deg/s (100 to 150) | 108 deg/s | yes |  |
| wingsuit | Roll rate at 30 m/s (full input) | under 75 deg/s | 48 deg/s | yes | measured at 30.0 m/s |
| wingsuit | Pitch rate at trim (full input) | 45 deg/s (35 to 60) | 42 deg/s | yes |  |
| wingsuit | Yaw authority (heading rate, full yaw) | low | 2.8 deg/s | yes |  |
| canopy | Deploy to full canopy | 2.5 s | 2.51 s | yes |  |
| canopy | Opening height lost (2.5 s) | about 70 m (test 55 to 90) | 47 m | **NO** | airspeed at 2.5 s 12.5 m/s (test 9 to 13), peak 3.70 g (spec 2.5 g) |
| canopy | Minimum safe deploy AGL | 120 m (game rule) | 120 m flags lowPull | yes | rule, covered by canopy.test.ts |
| canopy | Canopy forward speed (full flight) | 11 m/s | 10.7 m/s | yes |  |
| canopy | Canopy sink rate (full flight) | 4 m/s (glide about 2.75) | 3.8 m/s, glide 2.87 | yes |  |
| canopy | Brakes held: forward / sink | 7 / 3 m/s | 6.9 / 2.9 m/s | yes |  |
| canopy | Turn rate at full input | 60 deg/s | 55 deg/s | yes |  |
| canopy | Flare at 3.5 m: touchdown vertical / forward | < 1.5 / < 5 m/s = soft | 1.21 / 4.88 m/s, soft | yes |  |
| canopy | No flare: touchdown vertical / forward | classification table | 3.94 / 10.99 m/s, crash | info |  |
| gate | Camps Bay scenario touchdown x | 2,900 to 3,100 (landed) | 2964 m, landed (soft) | yes | deploy at x 2457, AGL 200 m, t 65.4 s; flight 108.0 s |

33 rows, 1 outside tolerance.
