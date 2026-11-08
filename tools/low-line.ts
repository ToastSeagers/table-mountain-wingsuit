// Balance probe: a terrain-following pilot that holds a target height above the ground ahead,
// to see what a skilled low line scores. The Autopilot supplies roll, deploy and flare.
// Usage: npx tsx tools/low-line.ts <exitId> <zoneId> [targetAglM] [headingDeg] [deployAglM]
import { fileURLToPath } from 'node:url';
import { Autopilot } from '../src/game/Autopilot';
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
const [exitId, zoneId, aglArg = '12', headingArg, deployArg = '130'] = process.argv.slice(2);
const exit = exits.get(exitId);
const zone = zones.get(zoneId);
if (!zone) throw new Error('zone');
const targetAgl = Number(aglArg);
const run = new RunController({ exit, headingDeg: headingArg ? Number(headingArg) : exit.headingDeg, terrain, zones, triggers });
run.start();
const ap = new Autopilot({ target: zone.centre, deployAglM: Number(deployArg), straightS: 6, maxRoll: 0.6 });
const input: FlightInput = { pitch: 0, roll: 0, yaw: 0, deploy: false, flare: false, brake: false };
let lowS = 0;
let next = 0;
for (let i = 0; i < 120 * 400 && !run.ended; i++) {
  const s = run.state;
  ap.update(s, input);
  if (s.phase === 'wingsuit') input.deploy = s.elapsedS > 6 && s.aglM <= Number(deployArg);
  if (s.phase === 'wingsuit' && s.elapsedS > 6) {
    // Follow the ground: match the slope's descent rate, plus a pull toward the target clearance.
    const gNow = terrain.heightAt(s.position.x, s.position.z);
    let gAhead = -1e9;
    for (const t of [0.5, 1, 1.6]) gAhead = Math.max(gAhead, terrain.heightAt(s.position.x + s.velocity.x * t, s.position.z + s.velocity.z * t));
    const vsGround = (gAhead - gNow) / 1;
    const wantVs = Math.max(-55, Math.min(10, vsGround - (s.aglM - targetAgl) * 0.5));
    input.pitch = Math.max(-1, Math.min(1, 0.1 + 0.05 * (wantVs - s.velocity.y)));
    if (s.aglM < 40 && s.airspeedMps > 35) lowS += 1 / 120;
  }
  run.step(1 / 120, input);
  if (run.state.elapsedS >= next) {
    next += 2;
    const q = run.state;
    console.log(`t=${q.elapsedS.toFixed(0)} ${q.phase} x=${q.position.x.toFixed(0)} z=${q.position.z.toFixed(0)} agl=${q.aglM.toFixed(0)} v=${q.airspeedMps.toFixed(0)} vs=${q.velocity.y.toFixed(0)} pitch=${input.pitch.toFixed(2)} y=${q.position.y.toFixed(0)}`);
  }
}
const o = run.outcome;
const r = o?.result;
console.log(`${o?.reason} ${o?.landingClass} total=${r?.total} prox=${r?.proximityScore} landing=${r?.landingScore} zone=${r?.landingZoneId} lowS=${lowS.toFixed(1)} bonuses=${r?.styleBonuses.map((b) => b.id).join(',')}`);
