// Prints the ground profile along each exit's heading, to find the lip of the ledge.
// Usage: npx tsx tools/exit-profile.ts [exitId] [headingDeg] [backM] [aheadM] [stepM]
import { fileURLToPath } from 'node:url';
import { ExitRegistry } from '../src/game/ExitRegistry';
import { TerrainSamplerImpl } from '../src/world/TerrainSamplerImpl';

(globalThis as unknown as { __dirname: string }).__dirname = fileURLToPath(new URL('../src/world/terrain', import.meta.url));
const { loadFullStore } = await import('../src/world/terrain/testFixtures');
const terrain = new TerrainSamplerImpl(await loadFullStore());
const exits = ExitRegistry.fromData();
const [only, hArg, backArg, aheadArg, stepArg] = process.argv.slice(2);
for (const e of exits.exits) {
  if (only && e.id !== only) continue;
  const h = (hArg ? Number(hArg) : e.headingDeg) * (Math.PI / 180);
  const back = backArg ? Number(backArg) : 40;
  const ahead = aheadArg ? Number(aheadArg) : 80;
  const step = stepArg ? Number(stepArg) : 5;
  const dx = Math.sin(h);
  const dz = -Math.cos(h);
  const row: string[] = [];
  for (let d = -back; d <= ahead; d += step) {
    row.push(`${d >= 0 ? '+' : ''}${d}:${terrain.heightAt(e.position.x + dx * d, e.position.z + dz * d).toFixed(0)}`);
  }
  console.log(`${e.id} pos=(${e.position.x.toFixed(1)}, ${e.position.y}, ${e.position.z.toFixed(1)}) ground=${terrain.heightAt(e.position.x, e.position.z).toFixed(1)}\n  ${row.join(' ')}`);
}
