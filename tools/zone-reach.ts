// Sweeps autopilot settings from an exit to find the best landing-zone approach reachable.
// Usage: npx tsx tools/zone-reach.ts <exitId> <zoneId> [headingDeg]
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
const [exitId, zoneId, hArg] = process.argv.slice(2);
const exit = exits.get(exitId);
const zone = zones.get(zoneId);
if (!zone) throw new Error('zone');
const results: { d: number; line: string }[] = [];
for (const h of hArg ? [Number(hArg)] : [exit.headingDeg]) {
  for (const cruise of [0.2, 0.25, 0.3, 0.35, 0.4]) {
    for (const straightS of [4, 6, 8, 10, 12]) {
      for (const [deployAglM, maxRoll] of [[122, 0.25], [122, 0.35], [122, 0.5], [135, 0.35]]) {
        const run = new RunController({ exit, headingDeg: h, terrain, zones, triggers });
        run.start();
        const ap = new Autopilot({ target: zone.centre, cruisePitch: cruise, straightS, deployAglM, maxRoll });
        const input: FlightInput = { pitch: 0, roll: 0, yaw: 0, deploy: false, flare: false, brake: false };
        for (let i = 0; i < 120 * 400 && !run.ended; i++) {
          ap.update(run.state, input);
          run.step(1 / 120, input);
        }
        const s = run.state;
        const d = Math.hypot(s.position.x - zone.centre.x, s.position.z - zone.centre.z);
        results.push({ d, line: `h${h} cruise ${cruise} straight ${straightS} deployAgl ${deployAglM} roll ${maxRoll}: ${run.outcome?.reason} ${run.outcome?.landingClass} t=${s.elapsedS.toFixed(0)} dist2zone=${d.toFixed(0)} score=${run.outcome?.result.total}` });
      }
    }
  }
}
results.sort((a, b) => a.d - b.d);
console.log(results.slice(0, 6).map((r) => r.line).join('\n'));
