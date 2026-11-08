// Prints DEM height around lat/lon points. Usage: npx tsx tools/ground-at.ts lat,lon [lat,lon...]
import { fileURLToPath } from 'node:url';
import { TerrainSamplerImpl } from '../src/world/TerrainSamplerImpl';
import { latLonToWorld } from '../src/world/geo';

(globalThis as unknown as { __dirname: string }).__dirname = fileURLToPath(new URL('../src/world/terrain', import.meta.url));
const { loadFullStore } = await import('../src/world/terrain/testFixtures');
const terrain = new TerrainSamplerImpl(await loadFullStore());
for (const arg of process.argv.slice(2)) {
  const [lat, lon] = arg.split(',').map(Number);
  const p = latLonToWorld(lat, lon);
  const hs = [-60, -30, 0, 30, 60].map((d) => terrain.heightAt(p.x + d, p.z).toFixed(1));
  console.log(`${arg}: x ${p.x.toFixed(0)} z ${p.z.toFixed(0)} ground ${terrain.heightAt(p.x, p.z).toFixed(1)} (E-W ${hs.join(' ')}) dist from Lion's Head exit ${Math.hypot(p.x + 1938.8, p.z + 1620.4).toFixed(0)}`);
}
