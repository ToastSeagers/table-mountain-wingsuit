// Stage 8 dev tool: flies one exit line with the Autopilot over the real terrain and prints the
// phases, the deploy point and the touchdown. Usage: npx tsx tools/exit-trace.ts <exitId> <zoneId> [headingDeg]
import { fileURLToPath } from 'node:url';
import { Autopilot } from '../src/game/Autopilot';
import { ExitRegistry } from '../src/game/ExitRegistry';
import { LandingZoneRegistry } from '../src/game/LandingZoneRegistry';
import { RunController } from '../src/game/RunController';
import { TriggerRegistry } from '../src/game/TriggerRegistry';
import { TerrainSamplerImpl } from '../src/world/TerrainSamplerImpl';
import type { FlightInput } from '../src/types/flight';

(globalThis as unknown as { __dirname: string }).__dirname = fileURLToPath(
  new URL('../src/world/terrain', import.meta.url),
);
const { loadFullStore } = await import('../src/world/terrain/testFixtures');
const store = await loadFullStore();
const terrain = new TerrainSamplerImpl(store);
const exits = ExitRegistry.fromData();
const zones = LandingZoneRegistry.fromData();
const triggers = TriggerRegistry.fromData();
const exit = exits.exits.find((e) => e.id === process.argv[2]);
const zone = zones.get(process.argv[3] ?? '');
if (!exit || !zone) throw new Error('usage: exit-trace <exitId> <zoneId> [headingDeg]');
const h = process.argv[4] ? Number(process.argv[4]) : exit.headingDeg;
const run = new RunController({ exit, headingDeg: h, terrain, zones, triggers });
run.start();
const ap = new Autopilot({ target: zone.centre });
const input: FlightInput = { pitch: 0, roll: 0, yaw: 0, deploy: false, flare: false, brake: false };
let lastPhase = '';
let i = 0;
for (; i < 120 * 400 && !run.ended; i++) {
  ap.update(run.state, input);
  run.step(1 / 120, input);
  const s = run.state;
  if (s.phase !== lastPhase || i % 600 === 0) {
    console.log(
      `t=${s.elapsedS.toFixed(1)} ${s.phase.padEnd(9)} pos=(${s.position.x.toFixed(0)},${s.position.y.toFixed(0)},${s.position.z.toFixed(0)}) agl=${s.aglM.toFixed(0)} V=${s.airspeedMps.toFixed(1)} glide=${s.glideRatio.toFixed(2)} alpha=${s.alphaDeg.toFixed(1)} bank=${s.bankDeg.toFixed(0)} g=${s.gLoad.toFixed(2)} in=(${input.pitch.toFixed(2)},${input.roll.toFixed(2)}) dist=${Math.hypot(zone.centre.x - s.position.x, zone.centre.z - s.position.z).toFixed(0)}`,
    );
    lastPhase = s.phase;
  }
}
const o = run.outcome;
console.log(
  `${o?.reason} class=${o?.landingClass} touchdown=${JSON.stringify(o?.touchdown)} water=${o?.inWater} zone=${o?.result.landingZoneId} score=${o?.result.total}`,
);
