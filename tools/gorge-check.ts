// Flies Platteklip with a steering-and-diving script to confirm the gorge bonus is reachable.
import { fileURLToPath } from 'node:url';
import { ExitRegistry } from '../src/game/ExitRegistry';
import { LandingZoneRegistry } from '../src/game/LandingZoneRegistry';
import { RunController } from '../src/game/RunController';
import { TriggerRegistry } from '../src/game/TriggerRegistry';
import { TerrainSamplerImpl } from '../src/world/TerrainSamplerImpl';
import type { FlightInput } from '../src/types/flight';
import { headingError } from '../src/game/Autopilot';

(globalThis as unknown as { __dirname: string }).__dirname = fileURLToPath(new URL('../src/world/terrain', import.meta.url));
const { loadFullStore } = await import('../src/world/terrain/testFixtures');
const terrain = new TerrainSamplerImpl(await loadFullStore());
const exit = ExitRegistry.fromData().get('platteklip');
const trig = TriggerRegistry.fromData();
const v = trig.forBonus('gorge')[0];
const tx = (v.min.x + v.max.x) / 2;
const tz = (v.min.z + v.max.z) / 2;
for (const diveS of [0, 1, 2]) {
  for (const pitch of [-0.3, -0.6, -1]) {
    const run = new RunController({ exit, headingDeg: exit.headingDeg, terrain, zones: LandingZoneRegistry.fromData(), triggers: trig });
    run.start();
    const input: FlightInput = { pitch: 0, roll: 0, yaw: 0, deploy: false, flare: false, brake: false };
    let hit = false;
    for (let i = 0; i < 120 * 40 && !run.ended; i++) {
      const st = run.state;
      const want = (Math.atan2(tx - st.position.x, -(tz - st.position.z)) * 180) / Math.PI;
      input.pitch = st.elapsedS < diveS ? 0 : pitch;
      input.roll = st.elapsedS > 3 ? Math.max(-1, Math.min(1, headingError(st.headingDeg, want) / 25)) : 0;
      run.step(1 / 120, input);
      if (run.tracker.drainStamps().some((s) => s.id === 'gorge')) hit = true;
    }
    console.log(`diveS ${diveS} pitch ${pitch}: gorge ${hit} end ${run.outcome?.reason} t=${run.state.elapsedS.toFixed(1)}`);
  }
}
