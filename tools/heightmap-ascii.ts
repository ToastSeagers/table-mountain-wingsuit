// ASCII relief map: digits are height/100 m (A = 1000+), '.' is sea. Usage: x0 x1 z0 z1 step
import { fileURLToPath } from 'node:url';
import { TerrainSamplerImpl } from '../src/world/TerrainSamplerImpl';

(globalThis as unknown as { __dirname: string }).__dirname = fileURLToPath(new URL('../src/world/terrain', import.meta.url));
const { loadFullStore } = await import('../src/world/terrain/testFixtures');
const terrain = new TerrainSamplerImpl(await loadFullStore());
const [x0, x1, z0, z1, step] = process.argv.slice(2).map(Number);
let header = '      ';
for (let x = x0; x <= x1; x += step) header += x % (step * 5) === 0 ? String(Math.abs(x) / 100).padEnd(5).slice(0, 1) : ' ';
console.log(header);
for (let z = z0; z <= z1; z += step) {
  let row = String(z).padStart(5) + ' ';
  for (let x = x0; x <= x1; x += step) {
    const h = terrain.heightAt(x, z);
    row += h < 1 ? '.' : Math.floor(h / (Number(process.env.BAND ?? 100))).toString(36);
  }
  console.log(row);
}
