// Flies each exit headless over the real terrain with the Autopilot and prints where it ends.
// Usage: npx tsx tools/exit-check.ts [exitId] [zoneId]
import { fileURLToPath } from 'node:url';
import { Autopilot } from '../src/game/Autopilot';
import { ExitRegistry } from '../src/game/ExitRegistry';
import { LandingZoneRegistry } from '../src/game/LandingZoneRegistry';
import { RunController } from '../src/game/RunController';
import { TriggerRegistry } from '../src/game/TriggerRegistry';
import { TerrainSamplerImpl } from '../src/world/TerrainSamplerImpl';
import type { FlightInput } from '../src/types/flight';

// testFixtures.ts is written for Vitest and reads __dirname; give it one under tsx.
(globalThis as unknown as { __dirname: string }).__dirname = fileURLToPath(new URL('../src/world/terrain', import.meta.url));
const { loadFullStore } = await import('../src/world/terrain/testFixtures');
const store = await loadFullStore();
const terrain = new TerrainSamplerImpl(store);
const exits = ExitRegistry.fromData();
const zones = LandingZoneRegistry.fromData();
const triggers = TriggerRegistry.fromData();
const only = process.argv[2];
const zoneArg = process.argv[3];
for (const exit of exits.exits) {
  if (only && exit.id !== only) continue;
  const zoneIds = zoneArg ? [zoneArg] : exit.recommendedLandingZones;
  for (const zid of zoneIds) {
    const zone = zones.get(zid);
    if (!zone) throw new Error(`zone ${zid}`);
    const headings = exit.altHeadings.length ? exit.altHeadings.map((a) => a.headingDeg) : [exit.headingDeg];
    for (const h of headings) {
      const run = new RunController({ exit, headingDeg: h, terrain, zones, triggers });
      run.start();
      const ap = new Autopilot({ target: zone.centre });
      const input: FlightInput = { pitch: 0, roll: 0, yaw: 0, deploy: false, flare: false, brake: false };
      let minAgl = 1e9;
      for (let i = 0; i < 120 * 400 && !run.ended; i++) {
        ap.update(run.state, input);
        run.step(1 / 120, input);
        if (run.state.elapsedS > 3) minAgl = Math.min(minAgl, run.state.aglM);
      }
      const o = run.outcome;
      const s = run.state;
      console.log(
        `${exit.id} h${h} -> ${zid}: ${o?.reason} class=${o?.landingClass} t=${s.elapsedS.toFixed(1)} pos=(${s.position.x.toFixed(0)},${s.position.z.toFixed(0)}) ` +
          `dist2zone=${Math.hypot(s.position.x - zone.centre.x, s.position.z - zone.centre.z).toFixed(0)} minAGL=${minAgl.toFixed(1)} score=${o?.result.total} zone=${o?.result.landingZoneId} bonuses=${o?.result.styleBonuses.map((b) => b.id).join(',')}`,
      );
    }
  }
}
