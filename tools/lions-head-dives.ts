// Hand-flown style scripted dives from an exit: sweeps dive length, dive depth and cruise pitch
// in the wingsuit (no deploy) and reports the worst terrain clearance and whether it crashed.
// Usage: npx tsx tools/lions-head-dives.ts [exitId] [headingDeg...]
import { fileURLToPath } from 'node:url';
import { FlightModelImpl } from '../src/flight/FlightModelImpl';
import { ExitRegistry } from '../src/game/ExitRegistry';
import { TerrainSamplerImpl } from '../src/world/TerrainSamplerImpl';
import type { FlightInput } from '../src/types/flight';

(globalThis as unknown as { __dirname: string }).__dirname = fileURLToPath(new URL('../src/world/terrain', import.meta.url));
const { loadFullStore } = await import('../src/world/terrain/testFixtures');
const terrain = new TerrainSamplerImpl(await loadFullStore());
const exits = ExitRegistry.fromData();
const exit = exits.get(process.argv[2] ?? 'lions-head');
const headings = process.argv.length > 3 ? process.argv.slice(3).map(Number) : exit.altHeadings.map((a) => a.headingDeg);
const input: FlightInput = { pitch: 0, roll: 0, yaw: 0, deploy: false, flare: false, brake: false };

for (const h of headings) {
  const rows: string[] = [];
  for (const diveS of [0, 2, 3, 4, 6]) {
    for (const dive of [-0.3, -0.6, -1]) {
      for (const cruise of [0, 0.15, 0.4]) {
        const m = new FlightModelImpl();
        m.reset({ x: exit.position.x, y: exit.position.y, z: exit.position.z }, h, 1);
        let min = 1e9;
        let crashed = false;
        let tEnd = 0;
        for (let i = 0; i < 120 * 40; i++) {
          input.pitch = m.state.elapsedS < diveS ? dive : cruise;
          m.step(1 / 120, input, terrain);
          if (m.state.elapsedS > 0.5) min = Math.min(min, m.state.aglM);
          if (m.state.phase === 'crashed') { crashed = true; tEnd = m.state.elapsedS; break; }
        }
        rows.push(`  h${h} dive ${diveS}s@${dive} cruise ${cruise}: ${crashed ? `CRASH t=${tEnd.toFixed(1)}` : 'ok'} minAGL ${min.toFixed(0)} end y=${m.state.position.y.toFixed(0)} agl=${m.state.aglM.toFixed(0)} v=${m.state.airspeedMps.toFixed(0)}`);
      }
    }
  }
  const okRows = rows.filter((r) => !r.includes('CRASH'));
  console.log(`heading ${h}: ${okRows.length}/${rows.length} scripts survive 40 s`);
  console.log(okRows.slice(0, 40).join('\n'));
  console.log(rows.filter((r) => r.includes('CRASH')).slice(0, 6).join('\n'));
}
