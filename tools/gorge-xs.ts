// Prints cross-sections of the ground across Platteklip Gorge at several z, to see how narrow it is.
// Usage: npx tsx tools/gorge-xs.ts [zFrom] [zTo] [zStep] [xFrom] [xTo] [xStep]
import { fileURLToPath } from 'node:url';
import { TerrainSamplerImpl } from '../src/world/TerrainSamplerImpl';

(globalThis as unknown as { __dirname: string }).__dirname = fileURLToPath(new URL('../src/world/terrain', import.meta.url));
const { loadFullStore } = await import('../src/world/terrain/testFixtures');
const t = new TerrainSamplerImpl(await loadFullStore());
const [z0 = '1000', z1 = '600', zs = '-50', x0 = '-200', x1 = '100', xs = '10'] = process.argv.slice(2);
console.log(`x: ${Array.from({ length: Math.floor((Number(x1) - Number(x0)) / Number(xs)) + 1 }, (_, i) => Number(x0) + i * Number(xs)).join(' ')}`);
for (let z = Number(z0); Number(zs) < 0 ? z >= Number(z1) : z <= Number(z1); z += Number(zs)) {
  const row: string[] = [];
  let low = { x: 0, h: 1e9 };
  for (let x = Number(x0); x <= Number(x1); x += Number(xs)) {
    const h = t.heightAt(x, z);
    if (h < low.h) low = { x, h };
    row.push(h.toFixed(0));
  }
  console.log(`z${z} floor x${low.x} h${low.h.toFixed(0)} | ${row.join(' ')}`);
}
