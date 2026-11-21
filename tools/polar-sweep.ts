// Stage 8 dev tool: prints the polar's steady-state table and what the model actually settles
// at for held pitch inputs, held banks and a full pull-back. Usage: npx tsx tools/polar-sweep.ts
import {
  attitudeCommandDeg,
  bestGlideAlphaDeg,
  steadyAirspeed,
  steadyAlphaForAttitude,
  steadyGlide,
  trimAttitudeDeg,
} from '../src/flight/aero';
import * as m from '../src/flight/metrics';
import { runScenario, stubScenario } from '../src/flight/scripting';

const fmt = (x: number, d = 2): string => x.toFixed(d);
const best = bestGlideAlphaDeg();
console.log(
  `trim attitude ${fmt(trimAttitudeDeg())} deg; best glide alpha ${fmt(best)} deg, L/D ${fmt(steadyGlide(best))} at ${fmt(steadyAirspeed(best), 1)} m/s`,
);
console.log('alpha  L/D   V(m/s)');
for (const a of [-1, 0, 2, 3.71, 5, 7, 9, 12, 15, 18, 20]) {
  console.log(
    `${String(a).padEnd(6)} ${fmt(steadyGlide(a)).padEnd(5)} ${fmt(steadyAirspeed(a), 1)}`,
  );
}
console.log(
  '\nheld pitch -> attitude, table alpha | settled 35-40 s: glide, airspeed, sink, alpha, mush',
);
for (const p of [-1, -0.75, -0.5, -0.25, 0, 0.15, 0.3, 0.5, 0.7, 1]) {
  const th = attitudeCommandDeg(p);
  const sc = stubScenario('held', 40, (t, _s, i) => {
    if (t >= 10) i.pitch = p;
  });
  sc.exit = { x: 0, y: 4000, z: 0 };
  const f = runScenario(sc);
  console.log(
    `${String(p).padEnd(6)} theta ${fmt(th, 1).padStart(6)}  alpha_ss ${fmt(steadyAlphaForAttitude(th)).padStart(6)} | glide ${fmt(m.mean(f, 'glide', 35, 40))}  V ${fmt(m.mean(f, 'airspeed', 35, 40), 1)}  sink ${fmt(m.mean(f, 'sink', 35, 40), 1)}  alpha ${fmt(m.mean(f, 'alpha', 35, 40), 1)}  mush ${fmt(m.mean(f, 'mush', 35, 40))}`,
  );
}
console.log('\nheld roll -> settled 25-30 s: bank, glide, airspeed, sink, g');
for (const r of [0.15, 0.3, 0.5]) {
  const sc = stubScenario('bank', 40, (t, _s, i) => {
    if (t >= 14 && t < 14.6) i.roll = 1;
    if (t >= 14.6) i.roll = r;
  });
  sc.exit = { x: 0, y: 4000, z: 0 };
  const f = runScenario(sc);
  console.log(
    `${String(r).padEnd(5)} bank ${fmt(m.mean(f, 'bank', 25, 30), 0)}  glide ${fmt(m.mean(f, 'glide', 25, 30))}  V ${fmt(m.mean(f, 'airspeed', 25, 30), 1)}  sink ${fmt(m.mean(f, 'sink', 25, 30), 1)}  g ${fmt(m.mean(f, 'gLoad', 25, 30))}`,
  );
}
console.log('\nfull pull-back from trim at 14 s');
const sc = stubScenario('float', 30, (t, _s, i) => {
  if (t >= 14) i.pitch = 1;
});
sc.exit = { x: 0, y: 4000, z: 0 };
const f = runScenario(sc);
for (const t of [14, 14.5, 15, 16, 17, 18, 20, 22, 25, 28]) {
  const fr = m.frameAt(f, t);
  console.log(
    `t ${String(t).padEnd(4)} V ${fmt(fr.airspeed, 1)}  vy ${fmt(fr.vy, 1)}  glide ${fmt(fr.glide)}  alpha ${fmt(fr.alpha, 1)}  g ${fmt(fr.gLoad)}  mush ${fmt(fr.mush)}  sink ${fmt(fr.sink, 1)}`,
  );
}
