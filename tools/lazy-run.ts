// Balance probe: a lazy pilot (no steering, no dive, deploys at a fixed AGL) from each exit.
// Usage: npx tsx tools/lazy-run.ts [exitId]
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
for (const exit of exits.exits) {
  if (process.argv[2] && exit.id !== process.argv[2]) continue;
  for (const h of exit.altHeadings.length ? exit.altHeadings.map((a) => a.headingDeg) : [exit.headingDeg]) {
    const run = new RunController({ exit, headingDeg: h, terrain, zones, triggers });
    run.start();
    const ap = new Autopilot({ target: exit.position, straightS: 1e9, deployAglM: 160 });
    const input: FlightInput = { pitch: 0, roll: 0, yaw: 0, deploy: false, flare: false, brake: false };
    for (let i = 0; i < 120 * 400 && !run.ended; i++) {
      ap.update(run.state, input);
      input.pitch = run.state.phase === 'wingsuit' ? 0 : input.pitch;
      input.roll = 0;
      // The lazy pilot opens at 160 m AGL and never turns the canopy.
      input.deploy = run.state.phase === 'wingsuit' && run.state.elapsedS > 6 && run.state.aglM <= 160;
      run.step(1 / 120, input);
    }
    const o = run.outcome;
    console.log(`${exit.id} h${h} lazy: ${o?.reason} ${o?.landingClass} t=${run.state.elapsedS.toFixed(0)} zone=${o?.result.landingZoneId} total=${o?.result.total}`);
  }
}
