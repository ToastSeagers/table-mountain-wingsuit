// Searches around each exit for a ledge position and heading whose start arc clears the terrain.
// Usage: npx tsx tools/exit-search.ts [exitId] [maxHeadingOffsetDeg]
import { fileURLToPath } from 'node:url';
import { FlightModelImpl } from '../src/flight/FlightModelImpl';
import { ExitRegistry } from '../src/game/ExitRegistry';
import { TerrainSamplerImpl } from '../src/world/TerrainSamplerImpl';
import { worldToLatLon } from '../src/world/geo';
import type { FlightInput } from '../src/types/flight';

(globalThis as unknown as { __dirname: string }).__dirname = fileURLToPath(new URL('../src/world/terrain', import.meta.url));
const { loadFullStore } = await import('../src/world/terrain/testFixtures');
const terrain = new TerrainSamplerImpl(await loadFullStore());
const exits = ExitRegistry.fromData();
const only = process.argv[2];
const maxOffset = Number(process.argv[3] ?? 10);
const input: FlightInput = { pitch: 0, roll: 0, yaw: 0, deploy: false, flare: false, brake: false };

/** Two pilots: a modest early dive then cruise, and hands off the controls. Clearance is the worse of the two. */
function minAgl(x: number, z: number, y: number, heading: number): number {
  return Math.min(minAglScript(x, z, y, heading, true), minAglScript(x, z, y, heading, false));
}

function minAglScript(x: number, z: number, y: number, heading: number, dive: boolean): number {
  const m = new FlightModelImpl();
  m.reset({ x, y, z }, heading, 1);
  let min = 1e9;
  for (let i = 0; i < 120 * 25; i++) {
    input.pitch = dive ? (m.state.elapsedS < 2.5 ? -0.4 : 0.15) : 0;
    m.step(1 / 120, input, terrain);
    if (m.state.phase === 'crashed') return -1;
    if (m.state.elapsedS > 0.5) min = Math.min(min, m.state.aglM);
  }
  return min;
}

if (only === 'eval') {
  // npx tsx tools/exit-search.ts eval <x> <z> <heading>...: clearance at a given spot and headings
  const [x, z] = [Number(process.argv[3]), Number(process.argv[4])];
  const g = terrain.heightAt(x, z);
  for (const h of process.argv.slice(5).map(Number)) console.log(`h${h}: ground ${g.toFixed(1)} minAGL ${minAgl(x, z, g + 1.5, h).toFixed(1)}`);
  process.exit(0);
}
for (const e of exits.exits) {
  if (only && e.id !== only) continue;
  const headings = e.altHeadings.length ? e.altHeadings.map((a) => a.headingDeg) : [e.headingDeg];
  for (const h0 of headings) {
    const base = e.position;
    const baseGround = terrain.heightAt(base.x, base.z);
    let best: { x: number; z: number; h: number; y: number; min: number; score: number } | null = null;
    for (let ho = -maxOffset; ho <= maxOffset; ho += 5) {
      const h = h0 + ho;
      const hr = (h0 * Math.PI) / 180;
      const fx = Math.sin(hr);
      const fz = -Math.cos(hr);
      for (let along = -120; along <= 300; along += 6) {
        for (let lat = -250; lat <= 250; lat += 10) {
          const x = base.x + fx * along + -fz * lat;
          const z = base.z + fz * along + fx * lat;
          const g = terrain.heightAt(x, z);
          if (g < baseGround - 60) continue; // do not slide far down the slope
          const y = g + 1.5;
          const min = minAgl(x, z, y, h);
          if (min < 0) continue;
          // Prefer clearance (capped at 25 m), then staying near the original spot and height.
          const score = Math.min(min, 25) * 10 - Math.hypot(along, lat) * 0.05 - Math.abs(ho) * 0.3 + (g - baseGround) * 0.05;
          if (!best || score > best.score) best = { x, z, h, y, min, score };
        }
      }
    }
    if (!best) {
      console.log(`${e.id} h${h0}: no clearing position found`);
      continue;
    }
    const ll = worldToLatLon({ x: best.x, y: best.y, z: best.z });
    console.log(
      `${e.id} h${h0}: heading ${best.h} minAGL ${best.min.toFixed(1)} ground ${(best.y - 1.5).toFixed(1)} lat ${ll.lat.toFixed(5)} lon ${ll.lon.toFixed(5)} (moved ${Math.hypot(best.x - base.x, best.z - base.z).toFixed(0)} m, x ${best.x.toFixed(1)} z ${best.z.toFixed(1)})`,
    );
  }
}
