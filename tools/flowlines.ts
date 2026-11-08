// Steepest-descent lines from seeds along a rim, to find gullies (they are where lines converge).
import { fileURLToPath } from 'node:url';
import { TerrainSamplerImpl } from '../src/world/TerrainSamplerImpl';

(globalThis as unknown as { __dirname: string }).__dirname = fileURLToPath(new URL('../src/world/terrain', import.meta.url));
const { loadFullStore } = await import('../src/world/terrain/testFixtures');
const t = new TerrainSamplerImpl(await loadFullStore());
const [xa, xb, xs, z0, stopZ] = process.argv.slice(2).map(Number);
const marks = [900, 800, 700, 600, 500];
for (let x0 = xa; x0 <= xb; x0 += xs) {
  let x = x0;
  let z = z0;
  const out: string[] = [];
  let mi = 0;
  for (let i = 0; i < 4000 && z > stopZ; i++) {
    // sample 8 neighbours at 10 m, step to the lowest
    let best = { x, z, h: t.heightAt(x, z) };
    for (let a = 0; a < 16; a++) {
      const ax = x + Math.cos((a * Math.PI) / 8) * 10;
      const az = z + Math.sin((a * Math.PI) / 8) * 10;
      const h = t.heightAt(ax, az);
      if (h < best.h) best = { x: ax, z: az, h };
    }
    if (best.x === x && best.z === z) break;
    x = best.x;
    z = best.z;
    while (mi < marks.length && z <= marks[mi]) {
      out.push(`z${marks[mi]}:x${x.toFixed(0)}(h${best.h.toFixed(0)})`);
      mi++;
    }
  }
  console.log(`seed x${x0}: ${out.join(' ')}`);
}
