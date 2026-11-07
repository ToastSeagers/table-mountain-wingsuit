// Headless tuning harness. Usage (see package.json "harness"):
//   npm run harness -- <scenario> [--wide] [--every N] > out.csv   CSV to stdout
//   npm run harness -- <scenario> --summary                        metrics to stderr, no CSV
//   npm run harness -- all                                         measured-vs-target table (markdown)
//   npm run harness -- --bench                                     steps per second
//   npm run harness -- --list

import { FlightModelImpl } from '../src/flight/FlightModelImpl';
import * as m from '../src/flight/metrics';
import { makeInput, runScenario, stubScenario, type ScriptFrame } from '../src/flight/scripting';
import { STUB_BEACH, StubTerrain } from '../src/flight/stub-terrain';
import { CANOPY, LANDING, WINGSUIT } from '../src/flight/tuning';
import { campsBay } from './scenarios/camps-bay';
import { BRAKE_END_S, BRAKE_START_S, DEPLOY_S, TURN_END_S, TURN_START_S } from './scenarios/canopy';
import { DIVE_END_S, PULL_END_S } from './scenarios/dive';
import { FLATTEN_START_S } from './scenarios/flatten';
import { scenarios } from './scenarios/index';
import { PITCH_START_S, ROLL_START_S, YAW_START_S } from './scenarios/roll';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const everyIdx = args.indexOf('--every');
const every = everyIdx >= 0 ? Math.max(1, Number(args[everyIdx + 1]) || 1) : 1;

const err = (s: string) => process.stderr.write(s + '\n');
const out = (s: string) => process.stdout.write(s + '\n');

function fmt(x: number, d = 3): string {
  return Number.isFinite(x) ? x.toFixed(d) : String(x);
}

function csv(frames: ScriptFrame[], wide: boolean): string {
  const base = 't,x,y,z,vx,vy,vz,airspeed,glide,agl,alpha,phase';
  const extra = ',gLoad,mush,sink,groundSpeed,heading,pitch,bank,areaFactor,flareEnergy,landing';
  const lines = [wide ? base + extra : base];
  for (let i = 0; i < frames.length; i++) {
    if (i % every !== 0 && i !== frames.length - 1) continue;
    const f = frames[i];
    let line =
      `${fmt(f.t, 4)},${fmt(f.x)},${fmt(f.y)},${fmt(f.z)},${fmt(f.vx)},${fmt(f.vy)},${fmt(f.vz)},` +
      `${fmt(f.airspeed)},${fmt(f.glide)},${fmt(f.agl)},${fmt(f.alpha)},${f.phase}`;
    if (wide) {
      line +=
        `,${fmt(f.gLoad)},${fmt(f.mush)},${fmt(f.sink)},${fmt(f.groundSpeed)},${fmt(f.heading)},` +
        `${fmt(f.pitch)},${fmt(f.bank)},${fmt(f.areaFactor)},${fmt(f.flareEnergy)},${f.landing ?? ''}`;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- measurements

interface Row {
  group: string;
  quantity: string;
  target: string;
  measured: string;
  ok: boolean | null;
  note?: string;
}

function within(x: number, lo: number, hi: number): boolean {
  return Number.isFinite(x) && x >= lo && x <= hi;
}

/** Steady glide at a held pitch input, measured over the last 5 s of a 30 s run from trim. */
function heldPitchSteady(
  p: number,
  fromS = 29,
  toS = 34,
): { glide: number; airspeed: number; sink: number; mush: number } {
  const sc = stubScenario(`held-${p}`, toS, (t, _st, input) => {
    if (t >= 10) input.pitch = p;
  });
  const frames = runScenario(sc);
  return {
    glide: m.mean(frames, 'glide', fromS, toS),
    airspeed: m.mean(frames, 'airspeed', fromS, toS),
    sink: m.mean(frames, 'sink', fromS, toS),
    mush: m.mean(frames, 'mush', fromS, toS),
  };
}

export function measureAll(): Row[] {
  const rows: Row[] = [];
  const push = (r: Row) => rows.push(r);
  const W = 'wingsuit';
  const C = 'canopy';

  // --- trim and start arc
  const trimFrames = runScenario(scenarios.trim);
  const arc = m.arcMetrics(trimFrames);
  const trim = m.trimMetrics(trimFrames, 14, 20);
  push({
    group: W,
    quantity: 'Start arc duration (glide > 2.5)',
    target: '3.5 s (3 to 4.5)',
    measured: `${fmt(arc.durationS, 2)} s`,
    ok: within(arc.durationS, 3, 4.5),
    note: `wingsuit phase at ${fmt(arc.wingsuitAtS, 2)} s`,
  });
  push({
    group: W,
    quantity: 'Start arc height lost',
    target: 'about 90 m (< 120)',
    measured: `${fmt(arc.heightLostM, 0)} m`,
    ok: arc.heightLostM < 120,
  });
  push({
    group: W,
    quantity: 'Start arc horizontal',
    target: 'about 60 m',
    measured: `${fmt(arc.horizontalM, 0)} m`,
    ok: null,
    note: `peak sink ${fmt(arc.peakSinkMps, 1)} m/s, peak g ${fmt(arc.peakGLoad, 2)}`,
  });
  push({
    group: W,
    quantity: 'Trim glide ratio',
    target: '3.0 (2.8 to 3.2)',
    measured: fmt(trim.glide, 2),
    ok: within(trim.glide, 2.8, 3.2),
  });
  push({
    group: W,
    quantity: 'Trim airspeed',
    target: '45 m/s (42 to 48)',
    measured: `${fmt(trim.airspeed, 1)} m/s`,
    ok: within(trim.airspeed, 42, 48),
  });
  push({
    group: W,
    quantity: 'Trim sink rate',
    target: '15 m/s (13 to 17)',
    measured: `${fmt(trim.sink, 1)} m/s`,
    ok: within(trim.sink, 13, 17),
    note: `g-load ${fmt(trim.gLoad, 2)}`,
  });

  // --- held-pitch sweep: max sustainable glide and min sink
  let best = { p: 0, glide: -Infinity, airspeed: NaN, sink: NaN, mush: 0 };
  let minSink = { p: 0, glide: NaN, airspeed: NaN, sink: Infinity, mush: 0 };
  for (let p = 0; p <= 1.0001; p += 0.1) {
    const s = heldPitchSteady(Number(p.toFixed(1)));
    if (s.glide > best.glide) best = { p: Number(p.toFixed(1)), ...s };
    if (s.sink < minSink.sink) minSink = { p: Number(p.toFixed(1)), ...s };
  }
  push({
    group: W,
    quantity: 'Max glide ratio (sustained, held pitch)',
    target: '3.4 (3.2 to 3.6) at about 38 m/s',
    measured: `${fmt(best.glide, 2)} at ${fmt(best.airspeed, 1)} m/s`,
    ok: within(best.glide, 3.2, 3.6),
    note: `pitch input +${best.p}`,
  });
  push({
    group: W,
    quantity: 'Min sink rate (sustained)',
    target: '12 m/s (11 to 14)',
    measured: `${fmt(minSink.sink, 1)} m/s at ${fmt(minSink.airspeed, 1)} m/s`,
    ok: within(minSink.sink, 11, 14),
    note: `pitch input +${minSink.p}`,
  });

  // --- dive and pull
  const diveFrames = runScenario(scenarios.dive);
  const diveEnd = m.frameAt(diveFrames, DIVE_END_S);
  const divePeak = m.peak(diveFrames, 'airspeed');
  const pullG = m.peak(diveFrames, 'gLoad', DIVE_END_S, PULL_END_S);
  const halfDive = heldPitchSteady(-0.5, 17, 20);
  push({
    group: W,
    quantity: 'Dive: airspeed after 6 s full nose down',
    target: '70 to 80 m/s',
    measured: `${fmt(diveEnd.airspeed, 1)} m/s`,
    ok: within(diveEnd.airspeed, 70, 80),
    note: `glide ${fmt(diveEnd.glide, 2)} at that point`,
  });
  push({
    group: W,
    quantity: 'Max dive airspeed (whole run)',
    target: '75 m/s (70 to 80), never > 80',
    measured: `${fmt(divePeak.value, 1)} m/s`,
    ok: within(divePeak.value, 70, 80),
  });
  push({
    group: W,
    quantity: 'Half nose-down steady glide',
    target: 'glide about 1.2 (spec dive note)',
    measured: `${fmt(halfDive.glide, 2)} at ${fmt(halfDive.airspeed, 1)} m/s`,
    ok: null,
  });
  push({
    group: W,
    quantity: 'Max g-load (full pull from the dive)',
    target: '3.5 g cap',
    measured: `${fmt(pullG.value, 2)} g`,
    ok: within(pullG.value, 3.0, 4.0),
  });

  // --- flatten and mush
  const flat = runScenario(scenarios.flatten);
  const mushOn = m.firstFrame(flat, (f) => f.mush > 0.05, FLATTEN_START_S);
  const cross35 = m.firstDownCrossing(flat, 'airspeed', 35, FLATTEN_START_S);
  const slowest = m.trough(flat, 'airspeed', FLATTEN_START_S);
  const sinkAtSlowest = m.frameAt(flat, slowest.t).sink;
  push({
    group: W,
    quantity: 'Mush onset airspeed',
    target: '32 m/s (30 to 35)',
    measured: mushOn ? `${fmt(mushOn.airspeed, 1)} m/s` : 'not reached',
    ok: mushOn ? within(mushOn.airspeed, 30, 35) : false,
    note: cross35
      ? `sink ${fmt(cross35.sink, 1)} at 35 m/s, ${fmt(sinkAtSlowest, 1)} at the slowest point (${fmt(slowest.value, 1)} m/s)`
      : 'never below 35 m/s',
  });

  // --- rates
  const rollF = runScenario(scenarios.roll);
  const rollRate = m.peakRate(rollF, 'bank', ROLL_START_S, ROLL_START_S + 0.5);
  const slowRoll = stubScenario('slow-roll', 30, (t, st, input) => {
    if (t >= 10) input.pitch = 1;
    if (t >= 10 && st.airspeedMps <= 30) input.roll = 1;
  });
  const slowF = runScenario(slowRoll);
  const slowStart = m.firstDownCrossing(slowF, 'airspeed', 30, 10);
  const slowRate = slowStart ? m.peakRate(slowF, 'bank', slowStart.t, slowStart.t + 0.5) : NaN;
  const pitchF = runScenario(scenarios.pitch);
  const pitchRate = m.peakRate(pitchF, 'pitch', PITCH_START_S, PITCH_START_S + 0.5);
  const yawF = runScenario(scenarios.yaw);
  const yawRate = m.meanRate(yawF, 'heading', YAW_START_S + 1, YAW_START_S + 3);
  push({
    group: W,
    quantity: 'Roll rate at trim (full input)',
    target: '120 deg/s (100 to 150)',
    measured: `${fmt(rollRate, 0)} deg/s`,
    ok: within(rollRate, 100, 150),
  });
  push({
    group: W,
    quantity: 'Roll rate at 30 m/s (full input)',
    target: 'under 75 deg/s',
    measured: `${fmt(slowRate, 0)} deg/s`,
    ok: slowRate < 75,
    note: slowStart ? `measured at ${fmt(slowStart.airspeed, 1)} m/s` : '',
  });
  push({
    group: W,
    quantity: 'Pitch rate at trim (full input)',
    target: '45 deg/s (35 to 60)',
    measured: `${fmt(pitchRate, 0)} deg/s`,
    ok: within(pitchRate, 35, 60),
  });
  push({
    group: W,
    quantity: 'Yaw authority (heading rate, full yaw)',
    target: 'low',
    measured: `${fmt(yawRate, 1)} deg/s`,
    ok: Math.abs(yawRate) < 30,
  });

  // --- canopy
  const can = runScenario(scenarios.canopy);
  const deployFrame = m.firstFrame(can, (f) => f.phase === 'deploying');
  const canopyFrame = m.firstFrame(can, (f) => f.phase === 'canopy');
  const at25 = canopyFrame;
  const openG =
    deployFrame && canopyFrame ? m.peak(can, 'gLoad', deployFrame.t, canopyFrame.t).value : NaN;
  const heightLost = deployFrame && at25 ? deployFrame.y - at25.y : NaN;
  push({
    group: C,
    quantity: 'Deploy to full canopy',
    target: '2.5 s',
    measured: deployFrame && canopyFrame ? `${fmt(canopyFrame.t - deployFrame.t, 2)} s` : 'n/a',
    ok: !!(deployFrame && canopyFrame && Math.abs(canopyFrame.t - deployFrame.t - 2.5) < 0.02),
  });
  push({
    group: C,
    quantity: 'Opening height lost (2.5 s)',
    target: 'about 70 m (test 55 to 90)',
    measured: `${fmt(heightLost, 0)} m`,
    ok: within(heightLost, 55, 90),
    note: `airspeed at 2.5 s ${at25 ? fmt(at25.airspeed, 1) : 'n/a'} m/s (test 9 to 13), peak ${fmt(openG, 2)} g (spec 2.5 g)`,
  });
  push({
    group: C,
    quantity: 'Minimum safe deploy AGL',
    target: '120 m (game rule)',
    measured: `${LANDING.minSafeDeployAglM} m flags lowPull`,
    ok: LANDING.minSafeDeployAglM === 120,
    note: 'rule, covered by canopy.test.ts',
  });
  const full = m.trimMetrics(can, DEPLOY_S + 8, BRAKE_START_S - 1);
  const brk = m.trimMetrics(can, BRAKE_END_S - 4, BRAKE_END_S);
  const turnRate = m.meanRate(can, 'heading', TURN_START_S + 2, TURN_END_S - 1);
  push({
    group: C,
    quantity: 'Canopy forward speed (full flight)',
    target: '11 m/s',
    measured: `${fmt(full.groundSpeed, 1)} m/s`,
    ok: within(full.groundSpeed, 10, 12),
  });
  push({
    group: C,
    quantity: 'Canopy sink rate (full flight)',
    target: '4 m/s (glide about 2.75)',
    measured: `${fmt(full.sink, 1)} m/s, glide ${fmt(full.glide, 2)}`,
    ok: within(full.sink, 3.5, 4.5),
  });
  push({
    group: C,
    quantity: 'Brakes held: forward / sink',
    target: '7 / 3 m/s',
    measured: `${fmt(brk.groundSpeed, 1)} / ${fmt(brk.sink, 1)} m/s`,
    ok: within(brk.groundSpeed, 6, 8) && within(brk.sink, 2.5, 3.5),
  });
  push({
    group: C,
    quantity: 'Turn rate at full input',
    target: '60 deg/s',
    measured: `${fmt(Math.abs(turnRate), 0)} deg/s`,
    ok: within(Math.abs(turnRate), 50, 70),
  });
  const fl = runScenario(scenarios.flare);
  const flEnd = m.lastFrame(fl);
  const flTd = m.firstFrame(fl, (f) => f.landing !== null);
  const flPrev = flTd ? fl[fl.indexOf(flTd) - 1] : undefined;
  const nf = runScenario(scenarios['no-flare']);
  const nfTd = m.firstFrame(nf, (f) => f.landing !== null);
  const nfPrev = nfTd ? nf[nf.indexOf(nfTd) - 1] : undefined;
  push({
    group: C,
    quantity: 'Flare at 3.5 m: touchdown vertical / forward',
    target: '< 1.5 / < 5 m/s = soft',
    measured: flPrev
      ? `${fmt(flPrev.sink, 2)} / ${fmt(flPrev.groundSpeed, 2)} m/s, ${flEnd.landing}`
      : 'no touchdown',
    ok: !!flPrev && flPrev.sink < 1.5 && flPrev.groundSpeed < 5 && flEnd.landing === 'soft',
  });
  push({
    group: C,
    quantity: 'No flare: touchdown vertical / forward',
    target: 'classification table',
    measured: nfPrev
      ? `${fmt(nfPrev.sink, 2)} / ${fmt(nfPrev.groundSpeed, 2)} m/s, ${m.lastFrame(nf).landing}`
      : 'no touchdown',
    ok: null,
  });

  // --- Camps Bay
  const cb = runScenario(campsBay);
  const cbEnd = m.lastFrame(cb);
  const cbDeploy = m.firstFrame(cb, (f) => f.phase === 'deploying');
  push({
    group: 'gate',
    quantity: 'Camps Bay scenario touchdown x',
    target: '2,900 to 3,100 (landed)',
    measured: `${fmt(cbEnd.x, 0)} m, ${cbEnd.phase} (${cbEnd.landing})`,
    ok: cbEnd.phase === 'landed' && within(cbEnd.x, STUB_BEACH.minX, STUB_BEACH.maxX),
    note: cbDeploy
      ? `deploy at x ${fmt(cbDeploy.x, 0)}, AGL ${fmt(cbDeploy.agl, 0)} m, t ${fmt(cbDeploy.t, 1)} s; flight ${fmt(cbEnd.t, 1)} s`
      : 'never deployed',
  });
  return rows;
}

function table(rows: Row[]): string {
  const lines = [
    '| Group | Quantity | Target | Measured | OK | Note |',
    '|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const ok = r.ok === null ? 'info' : r.ok ? 'yes' : '**NO**';
    lines.push(
      `| ${r.group} | ${r.quantity} | ${r.target} | ${r.measured} | ${ok} | ${r.note ?? ''} |`,
    );
  }
  const fails = rows.filter((r) => r.ok === false).length;
  lines.push('', `${rows.length} rows, ${fails} outside tolerance.`);
  return lines.join('\n');
}

function bench(): void {
  const model = new FlightModelImpl();
  const terrain = new StubTerrain();
  const input = makeInput();
  const steps = 2_000_000;
  model.reset({ x: 0, y: 20000, z: 0 }, 90);
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) {
    input.pitch = Math.sin(i * 0.001) * 0.5;
    model.step(1 / 120, input, terrain);
  }
  const dtMs = performance.now() - t0;
  err(`${steps} steps in ${dtMs.toFixed(0)} ms: ${((steps / dtMs) * 1000).toFixed(0)} steps/s`);
}

function summary(name: string, frames: ScriptFrame[]): void {
  const end = m.lastFrame(frames);
  err(
    `scenario ${name}: ${frames.length} frames, ${fmt(end.t, 2)} s, end phase ${end.phase}` +
      (end.landing ? ` (${end.landing})` : ''),
  );
  err(
    `  end x ${fmt(end.x, 1)} y ${fmt(end.y, 1)} airspeed ${fmt(end.airspeed, 1)} glide ${fmt(end.glide, 2)}`,
  );
  const arc = m.arcMetrics(frames);
  err(
    `  arc: ${fmt(arc.durationS, 2)} s, lost ${fmt(arc.heightLostM, 0)} m, horizontal ${fmt(arc.horizontalM, 0)} m, peak sink ${fmt(arc.peakSinkMps, 1)}, peak g ${fmt(arc.peakGLoad, 2)}`,
  );
  const tr = m.trimMetrics(frames, 12, 20);
  err(
    `  12-20 s: glide ${fmt(tr.glide, 2)} airspeed ${fmt(tr.airspeed, 1)} sink ${fmt(tr.sink, 1)} g ${fmt(tr.gLoad, 2)}`,
  );
  err(
    `  peaks: airspeed ${fmt(m.peak(frames, 'airspeed').value, 1)} g ${fmt(m.peak(frames, 'gLoad').value, 2)} mush ${fmt(m.peak(frames, 'mush').value, 2)}`,
  );
  err(`  tuning: trim alpha ${WINGSUIT.trimAlphaDeg}, canopy CL ${CANOPY.clFull}`);
}

function main(): void {
  if (flags.has('--bench')) return bench();
  if (flags.has('--list')) {
    for (const [k, s] of Object.entries(scenarios)) out(`${k.padEnd(12)} ${s.description}`);
    return;
  }
  const name = positional[0];
  if (!name) {
    err(
      'usage: npm run harness -- <scenario|all> [--summary] [--wide] [--every N] | --bench | --list',
    );
    process.exitCode = 2;
    return;
  }
  if (name === 'all') {
    out(table(measureAll()));
    return;
  }
  const pitchIdx = args.indexOf('--pitch');
  const scenario =
    name === 'held' && pitchIdx >= 0
      ? stubScenario('held', 34, (t, _st, input) => {
          if (t >= 10) input.pitch = Number(args[pitchIdx + 1]);
        })
      : scenarios[name];
  if (!scenario) {
    err(`unknown scenario "${name}"; try --list`);
    process.exitCode = 2;
    return;
  }
  const frames = runScenario(scenario);
  if (flags.has('--summary')) summary(name, frames);
  else out(csv(frames, flags.has('--wide')));
}

main();
