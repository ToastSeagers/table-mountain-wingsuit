// Stage 9 scoring probe: flies three kinds of line from the same exit and prints what each scores, to
// show that a gorge pass out-scores skimming open slope and that a hands-off run scores neither.
//
//   lazy   hands-off: no steering after the exit, no dive, deploys at 160 m AGL (as tools/lazy-run.ts)
//   skim   terrain-following at a fixed AGL over open ground, steering for the landing zone
//   gorge  Platteklip: a scripted pilot down the gully floor at a fixed AGL (it cannot yet fly the 40 degree
//          gully without hitting the rim, see the Stage 9 report; kept for when it can)
//   ghost  a kinematic pass: the tracker is fed a pilot that follows a polyline at a fixed AGL and speed with no
//          flight model, so the score of the same height in a gully, over open slope and over a ridge crest can
//          be compared on the real terrain
//
// Usage: npx tsx tools/risk-probe.ts [lazy|skim|gorge|ghost|all] [aglM] [verbose]
// Works on the old scoring too (the near-miss and narrowness columns read 0 there), which is how the
// "before" column of the Stage 9 report was made.
import { fileURLToPath } from 'node:url';
import { Autopilot, headingError } from '../src/game/Autopilot';
import { ExitRegistry } from '../src/game/ExitRegistry';
import { LandingZoneRegistry } from '../src/game/LandingZoneRegistry';
import { RunController } from '../src/game/RunController';
import { TriggerRegistry } from '../src/game/TriggerRegistry';
import { TerrainSamplerImpl } from '../src/world/TerrainSamplerImpl';
import type { FlightInput } from '../src/types/flight';

(globalThis as unknown as { __dirname: string }).__dirname = fileURLToPath(new URL('../src/world/terrain', import.meta.url));
const { loadFullStore } = await import('../src/world/terrain/testFixtures');
const terrain = new TerrainSamplerImpl(await loadFullStore());
const exits = ExitRegistry.fromData();
const zones = LandingZoneRegistry.fromData();
const triggers = TriggerRegistry.fromData();
const [modeArg = 'all', aglArg, verboseArg] = process.argv.slice(2);
const verbose = verboseArg === 'verbose';
const DT = 1 / 120;

interface Line {
  name: string;
  exitId: string;
  headingDeg: number;
  zoneId: string;
  mode: 'lazy' | 'skim' | 'gorge';
  aglM: number;
  /** Deploy when this far above the landing zone's ground. */
  deployAboveZoneM: number;
}

const LINES: Line[] = [
  { name: 'Table lazy', exitId: 'the-table', headingDeg: 265, zoneId: 'camps-bay-beach', mode: 'lazy', aglM: 0, deployAboveZoneM: 0 },
  { name: 'Platteklip lazy', exitId: 'platteklip', headingDeg: 350, zoneId: 'tafelberg-road', mode: 'lazy', aglM: 0, deployAboveZoneM: 0 },
  { name: 'Table open-slope skim', exitId: 'the-table', headingDeg: 265, zoneId: 'camps-bay-beach', mode: 'skim', aglM: 15, deployAboveZoneM: 150 },
  { name: 'Lion\'s Head open-slope skim', exitId: 'lions-head', headingDeg: 240, zoneId: 'clifton', mode: 'skim', aglM: 15, deployAboveZoneM: 150 },
  { name: 'Platteklip gorge line', exitId: 'platteklip', headingDeg: 350, zoneId: 'tafelberg-road', mode: 'gorge', aglM: 20, deployAboveZoneM: 150 },
];

/** The gully floor read off tools/gorge-xs.ts (the lowest ground across the gully at each z), rim to mouth. */
const GULLY: { x: number; z: number }[] = [
  { x: 40, z: 960 }, { x: 0, z: 920 }, { x: -20, z: 880 }, { x: -40, z: 840 }, { x: -40, z: 800 },
  { x: -40, z: 760 }, { x: -20, z: 720 }, { x: 20, z: 680 }, { x: 20, z: 640 }, { x: 20, z: 600 },
];


/** One kinematic pass over `path` at `aglM` and `speedMps`, scored by a fresh tracker; prints points and points per second. */
function ghost(name: string, path: { x: number; z: number }[], aglM: number, speedMps = 50): void {
  const exit = exits.get('platteklip');
  const run = new RunController({ exit, headingDeg: 0, terrain, zones, triggers });
  const tracker = run.tracker;
  const st = run.state;
  st.phase = 'wingsuit';
  let seg = 0;
  let t = 3.5; // past the grace period for near misses
  let pos = { ...path[0] };
  let secondsUnder = 0;
  const stampsAt: number[] = [];
  for (let i = 0; i < 120 * 120 && seg < path.length - 1; i++) {
    const to = path[seg + 1];
    const d = Math.hypot(to.x - pos.x, to.z - pos.z);
    const step = speedMps * DT;
    if (d <= step) {
      pos = { ...to };
      seg++;
    } else {
      pos = { x: pos.x + ((to.x - pos.x) / d) * step, z: pos.z + ((to.z - pos.z) / d) * step };
    }
    const g = terrain.heightAt(pos.x, pos.z);
    const dir = { x: (to.x - pos.x) / (d || 1), z: (to.z - pos.z) / (d || 1) };
    st.position = { x: pos.x, y: g + aglM, z: pos.z };
    st.velocity = { x: dir.x * speedMps, y: -10, z: dir.z * speedMps };
    st.airspeedMps = Math.hypot(speedMps, 10);
    st.aglM = aglM;
    st.headingDeg = (Math.atan2(dir.x, -dir.z) * 180) / Math.PI;
    tracker.step(DT, st, 0);
    t += DT;
    if (tracker.drainStamps().some((x) => x.label === 'NEAR MISS')) stampsAt.push(t);
    if (aglM < 50) secondsUnder += DT;
  }
  const b = tracker.finish({ x: pos.x, z: pos.z, groundHeightM: terrain.heightAt(pos.x, pos.z), landingClass: 'soft', crashed: true, deployAglM: null });
  const loose = b as unknown as { nearMissScore?: number; nearMissCount?: number };
  console.log(
    `${name.padEnd(36)} AGL ${String(aglM).padStart(2)} m ${secondsUnder.toFixed(1).padStart(5)}s  prox=${String(b.proximityScore).padStart(5)} (${(b.proximityScore / secondsUnder).toFixed(0).padStart(3)}/s)` +
      `  nearMiss=${String(loose.nearMissScore ?? 0).padStart(4)} (${loose.nearMissCount ?? 0})  peakNarrow=${(tracker as unknown as { peakNarrowness?: number }).peakNarrowness?.toFixed(2) ?? '0.00'}`,
  );
}

function ghostLines(): void {
  const open = (x0: number, z0: number, x1: number, z1: number): { x: number; z: number }[] => [{ x: x0, z: z0 }, { x: x1, z: z1 }];
  for (const agl of [5, 10, 20, 35]) {
    ghost('Platteklip gully floor', GULLY, agl);
    // The same gully seen from a line 70 m up the east face: a wall on one side only.
    ghost('Platteklip east face (one wall)', GULLY.map((p) => ({ x: p.x + 90, z: p.z })), agl);
    // Open ground: the long even slope of Camps Bay below the Apostles, and the Table's top.
    ghost('Camps Bay lower slope (open)', open(-2300, 250, -2900, 20), agl);
    ghost('Table top plateau (open, flat)', open(-300, 500, 300, 150), agl);
  }
}

function fly(line: Line): void {
  const exit = exits.get(line.exitId);
  const zone = zones.get(line.zoneId);
  if (!zone) throw new Error(`zone ${line.zoneId}`);
  const run = new RunController({ exit, headingDeg: line.headingDeg, terrain, zones, triggers });
  run.start();
  const ap = new Autopilot({ target: zone.centre, deployAglM: line.mode === 'lazy' ? 160 : 130, straightS: line.mode === 'lazy' ? 1e9 : 3 });
  const input: FlightInput = { pitch: 0, roll: 0, yaw: 0, deploy: false, flare: false, brake: false };
  const waypoints = line.mode === 'gorge' ? GULLY : [];
  let wp = 0;
  let underS = 0;
  let minClear = Infinity;
  let next = 0;
  for (let i = 0; i < 120 * 420 && !run.ended; i++) {
    const s = run.state;
    ap.update(s, input);
    if (line.mode === 'lazy') {
      input.pitch = s.phase === 'wingsuit' ? 0 : input.pitch;
      input.roll = 0;
      input.deploy = s.phase === 'wingsuit' && s.elapsedS > 6 && s.aglM <= 160;
    } else if (s.phase === 'wingsuit' || s.phase === 'freefall') {
      const nearZone = Math.hypot(s.position.x - zone.centre.x, s.position.z - zone.centre.z) < 2500;
      input.deploy = s.elapsedS > 6 && nearZone && s.position.y - zone.centre.y <= line.deployAboveZoneM;
      if (s.elapsedS > 3 && !input.deploy) {
        // Steer: down the gully waypoints first (gorge), else straight at the zone.
        let tx = zone.centre.x;
        let tz = zone.centre.z;
        if (waypoints.length) {
          while (wp < waypoints.length - 1 && Math.hypot(waypoints[wp].x - s.position.x, waypoints[wp].z - s.position.z) < 60) wp++;
          const w = waypoints[Math.min(waypoints.length - 1, wp + 1)];
          if (!(wp >= waypoints.length - 1 && Math.hypot(w.x - s.position.x, w.z - s.position.z) < 60)) {
            tx = w.x;
            tz = w.z;
          }
        }
        const want = (Math.atan2(tx - s.position.x, -(tz - s.position.z)) * 180) / Math.PI;
        input.roll = Math.max(-1, Math.min(1, headingError(s.headingDeg, want) / 25));
        // Follow the ground: fly to where the ground will be, plus the target clearance, in the next 1.5 s.
        let gAhead = -1e9;
        for (const t of [0.5, 1, 1.5, 2.5]) gAhead = Math.max(gAhead, terrain.heightAt(s.position.x + s.velocity.x * t, s.position.z + s.velocity.z * t));
        const wantVs = Math.max(-62, Math.min(10, (gAhead + line.aglM - s.position.y) / 1.5));
        input.pitch = Math.max(-1, Math.min(1, 0.1 + 0.05 * (wantVs - s.velocity.y)));
      }
    }
    run.step(DT, input);
    const q = run.state;
    if (q.elapsedS > 3 && (q.phase === 'wingsuit' || q.phase === 'freefall')) {
      minClear = Math.min(minClear, q.aglM);
      if (q.aglM < 50 && q.airspeedMps > 35) underS += DT;
    }
    if (verbose && q.elapsedS >= next) {
      next += 1;
      console.log(`  t=${q.elapsedS.toFixed(0)} ${q.phase} x=${q.position.x.toFixed(0)} z=${q.position.z.toFixed(0)} agl=${q.aglM.toFixed(0)} v=${q.airspeedMps.toFixed(0)} vs=${q.velocity.y.toFixed(0)} wp=${wp}`);
    }
  }
  const o = run.outcome;
  const b = o?.breakdown;
  // Fields that exist only with the Stage 9 scoring; the old tracker reads 0.
  const loose = b as unknown as { nearMissScore?: number; nearMissCount?: number } | undefined;
  const tr = run.tracker as unknown as { peakNarrowness?: number };
  console.log(
    `${line.name.padEnd(28)} ${String(o?.reason).padEnd(9)} t=${run.state.elapsedS.toFixed(0).padStart(3)}s ` +
      `under50=${underS.toFixed(1).padStart(5)}s minAGL=${(Number.isFinite(minClear) ? minClear : 0).toFixed(0).padStart(3)} ` +
      `prox=${String(b?.proximityScore).padStart(5)} nearMiss=${String(loose?.nearMissScore ?? 0).padStart(4)} (${loose?.nearMissCount ?? 0}) ` +
      `peakNarrow=${(tr.peakNarrowness ?? 0).toFixed(2)} total=${String(b?.total).padStart(5)} bonuses=${b?.bonuses.map((x) => x.id).join(',')}`,
  );
}

if (modeArg === 'ghost' || modeArg === 'all') ghostLines();
for (const line of LINES) {
  if (modeArg === 'ghost' || (modeArg !== 'all' && line.mode !== modeArg)) continue;
  if (aglArg && line.mode !== 'lazy') line.aglM = Number(aglArg);
  fly(line);
}
