import { describe, expect, it } from 'vitest';
import { FlightModelImpl } from './FlightModelImpl';
import { firstFrame, lastFrame } from './metrics';
import { makeInput, runScenario, stubScenario } from './scripting';
import { StubTerrain } from './stub-terrain';
import { SIM } from './tuning';

describe('phase machine and terrain contact', () => {
  it('a wingsuit flown into the slope crashes', () => {
    const into = stubScenario('into-slope', 60, (t, _st, input) => {
      if (t >= 6) input.pitch = -1;
    });
    const frames = runScenario(into);
    const end = lastFrame(frames);
    expect(end.phase).toBe('crashed');
    expect(end.landing).toBe('crash');
    expect(end.agl).toBe(0);
    expect(end.t).toBeLessThan(60);
    expect(firstFrame(frames, (f) => f.phase === 'deploying')).toBeUndefined();
  });

  it('contact while still deploying is a hard landing at most, never a canopy landing', () => {
    const late = stubScenario('late-pull', 120, (_t, st, input) => {
      input.deploy = st.aglM <= 40;
    });
    const frames = runScenario(late);
    const end = lastFrame(frames);
    const d = firstFrame(frames, (f) => f.phase === 'deploying');
    expect(d).toBeDefined();
    expect(firstFrame(frames, (f) => f.phase === 'canopy')).toBeUndefined();
    expect(end.phase === 'landed' || end.phase === 'crashed').toBe(true);
    expect(end.landing === 'hard' || end.landing === 'crash').toBe(true);
  });

  it('landed and crashed are terminal and freeze the state', () => {
    const into = stubScenario('into-slope', 60, (t, _st, input) => {
      if (t >= 6) input.pitch = -1;
    });
    const model = new FlightModelImpl();
    const terrain = new StubTerrain();
    runScenario(into, { model, terrain });
    const t = model.state.elapsedS;
    const x = model.state.position.x;
    const input = makeInput();
    input.pitch = 1;
    for (let i = 0; i < 120; i++) model.step(SIM.dtS, input, terrain);
    expect(model.state.elapsedS).toBe(t);
    expect(model.state.position.x).toBe(x);
    expect(model.state.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('reset starts a fresh freefall at the exit, facing the heading', () => {
    const model = new FlightModelImpl();
    model.reset({ x: 10, y: 1050, z: -20 }, 265);
    const s = model.state;
    expect(s.phase).toBe('freefall');
    expect(s.position).toEqual({ x: 10, y: 1050, z: -20 });
    expect(s.headingDeg).toBeCloseTo(265, 6);
    expect(s.velocity.x).toBeLessThan(0);
    expect(s.velocity.y).toBe(0);
    expect(s.elapsedS).toBe(0);
    expect(s.landing).toBeNull();
    expect(s.deployAglM).toBeNull();
  });

  it('mutates one state object in place (no per-step allocation of state or vectors)', () => {
    const model = new FlightModelImpl();
    const terrain = new StubTerrain();
    model.reset({ x: 0, y: 1050, z: 0 }, 90);
    const state = model.state;
    const pos = state.position;
    const vel = state.velocity;
    const ori = state.orientation;
    const input = makeInput();
    for (let i = 0; i < 600; i++) {
      const out = model.step(SIM.dtS, input, terrain);
      expect(out).toBe(state);
    }
    expect(state.position).toBe(pos);
    expect(state.velocity).toBe(vel);
    expect(state.orientation).toBe(ori);
  });
});
