// Prints the autopilot track for an exit/zone: position, height and AGL every N seconds.
// Usage: npx tsx tools/track.ts <exitId> <zoneId> [everyS] [headingDeg]
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
const [exitId, zoneId, every = '5', heading] = process.argv.slice(2);
const exit = exits.get(exitId);
const zone = zones.get(zoneId);
if (!zone) throw new Error('zone');
const run = new RunController({ exit, headingDeg: heading ? Number(heading) : exit.headingDeg, terrain, zones, triggers: TriggerRegistry.fromData() });
run.start();
const ap = new Autopilot({ target: zone.centre, deployAglM: Number(process.env.DEPLOY_AGL ?? 130) });
const input: FlightInput = { pitch: 0, roll: 0, yaw: 0, deploy: false, flare: false, brake: false };
let next = 0;
for (let i = 0; i < 120 * 400 && !run.ended; i++) {
  ap.update(run.state, input);
  run.step(1 / 120, input);
  const s = run.state;
  if (s.elapsedS >= next) {
    next += Number(every);
    console.log(`t=${s.elapsedS.toFixed(0)} ${s.phase} x=${s.position.x.toFixed(0)} z=${s.position.z.toFixed(0)} y=${s.position.y.toFixed(0)} ground=${(s.position.y - s.aglM).toFixed(0)} agl=${s.aglM.toFixed(0)} v=${s.airspeedMps.toFixed(0)}`);
  }
}
console.log(run.outcome?.reason, run.outcome?.result.total);
