import { describe, expect, it } from 'vitest';
import { MemoryStore, Persistence } from '../core/Persistence';
import { StubTerrain, STUB_EXIT, STUB_EXIT_HEADING_DEG } from '../flight/stub-terrain';
import type { FlightInput } from '../types/flight';
import type { ExitDef } from './ExitRegistry';
import { GameStateMachine, type GameEvent, type GameState } from './GameStateMachine';
import { LandingZoneRegistry } from './LandingZoneRegistry';
import { cleanInitials, MAX_SCORES_PER_EXIT, Profile } from './Profile';
import { packReplay, ReplayPlayer, ReplayRecorder, unpackReplay } from './Replay';
import { OUT_OF_BOUNDS_MARGIN_M, RunController } from './RunController';
import { TriggerRegistry } from './TriggerRegistry';

describe('GameStateMachine', () => {
  const walk = (m: GameStateMachine, ...events: GameEvent[]): GameState[] => events.map((e) => (m.dispatch(e), m.state));

  it('plays the whole loop: title to results to initials to title', () => {
    const m = new GameStateMachine();
    expect(
      walk(m, 'JUMP', 'SELECT_EXIT', 'SKIP_INTRO', 'COUNTDOWN_DONE', 'RUN_ENDED', 'ENTER_INITIALS', 'SCORE_SAVED', 'TO_TITLE'),
    ).toEqual(['exitSelect', 'intro', 'countdown', 'flying', 'results', 'highScoreEntry', 'highScores', 'title']);
  });

  it('refuses events that do not apply and leaves the state alone', () => {
    const m = new GameStateMachine();
    expect(m.dispatch('RUN_ENDED')).toBe(false);
    expect(m.dispatch('COUNTDOWN_DONE')).toBe(false);
    expect(m.state).toBe('title');
    expect(m.dispatch('PAUSE')).toBe(false);
  });

  it('pauses only while flying, and quits to the title from the pause menu', () => {
    const m = new GameStateMachine();
    walk(m, 'JUMP', 'SELECT_EXIT', 'SKIP_INTRO', 'COUNTDOWN_DONE');
    expect(m.dispatch('PAUSE')).toBe(true);
    expect(m.paused).toBe(true);
    expect(m.dispatch('RUN_ENDED')).toBe(false); // frozen while paused
    expect(m.dispatch('RESUME')).toBe(true);
    m.dispatch('PAUSE');
    expect(m.dispatch('TO_TITLE')).toBe(true);
    expect(m.state).toBe('title');
    expect(m.paused).toBe(false);
  });

  it('restarts from the pause menu straight into the countdown', () => {
    const m = new GameStateMachine();
    walk(m, 'JUMP', 'SELECT_EXIT', 'SKIP_INTRO', 'COUNTDOWN_DONE', 'PAUSE');
    expect(m.dispatch('JUMP_AGAIN')).toBe(true);
    expect(m.state).toBe('countdown');
    expect(m.paused).toBe(false);
  });

  it('opens settings over the title and over pause, not elsewhere', () => {
    const m = new GameStateMachine();
    expect(m.dispatch('OPEN_SETTINGS')).toBe(true);
    expect(m.settingsOpen).toBe(true);
    expect(m.dispatch('JUMP')).toBe(false); // modal
    m.dispatch('CLOSE_SETTINGS');
    walk(m, 'JUMP');
    expect(m.dispatch('OPEN_SETTINGS')).toBe(false);
    walk(m, 'SELECT_EXIT', 'SKIP_INTRO', 'COUNTDOWN_DONE', 'PAUSE');
    expect(m.dispatch('OPEN_SETTINGS')).toBe(true);
    expect(m.dispatch('RESUME')).toBe(false); // settings first
    m.dispatch('CLOSE_SETTINGS');
    expect(m.dispatch('RESUME')).toBe(true);
  });

  it('goes back one screen from exit select and the intro, and again from results', () => {
    const m = new GameStateMachine();
    walk(m, 'JUMP', 'SELECT_EXIT');
    expect(walk(m, 'BACK', 'SELECT_EXIT', 'SKIP_INTRO', 'COUNTDOWN_DONE', 'RUN_ENDED', 'JUMP_AGAIN')).toEqual([
      'exitSelect', 'intro', 'countdown', 'flying', 'results', 'countdown',
    ]);
    walk(m, 'COUNTDOWN_DONE', 'RUN_ENDED');
    expect(walk(m, 'CHANGE_EXIT')).toEqual(['exitSelect']);
  });

  it('notifies listeners of each change', () => {
    const m = new GameStateMachine();
    const seen: string[] = [];
    m.onChange((to, from) => seen.push(`${from}>${to}`));
    walk(m, 'JUMP', 'BACK');
    expect(seen).toEqual(['title>exitSelect', 'exitSelect>title']);
  });
});

describe('Profile', () => {
  const make = (): { profile: Profile; store: MemoryStore } => {
    const store = new MemoryStore();
    return { profile: new Profile(new Persistence(store)), store };
  };

  it('keeps the top ten per exit, sorted, and persists across a reload', () => {
    const { profile, store } = make();
    for (let i = 1; i <= 12; i++) profile.addScore('the-table', 'ABC', i * 100, `t${i}`);
    expect(profile.entries('the-table')).toHaveLength(MAX_SCORES_PER_EXIT);
    expect(profile.entries('the-table')[0].total).toBe(1200);
    expect(profile.entries('the-table')[9].total).toBe(300);
    const reloaded = new Profile(new Persistence(store));
    expect(reloaded.entries('the-table').map((e) => e.total)).toEqual(profile.entries('the-table').map((e) => e.total));
    expect(reloaded.bestScore('the-table')).toBe(1200);
    expect(reloaded.entries('platteklip')).toEqual([]);
  });

  it('qualifies only when the table has room or the score beats the tenth', () => {
    const { profile } = make();
    expect(profile.qualifies('a', 0)).toBe(false);
    expect(profile.qualifies('a', 1)).toBe(true);
    for (let i = 1; i <= 10; i++) profile.addScore('a', 'AAA', i * 100, '');
    expect(profile.qualifies('a', 100)).toBe(false);
    expect(profile.qualifies('a', 101)).toBe(true);
    expect(profile.addScore('a', 'ZZZ', 50, '')).toBe(-1);
    expect(profile.addScore('a', 'ZZZ', 5000, '')).toBe(0);
  });

  it('cleans initials to three capital letters', () => {
    expect(cleanInitials('ab')).toBe('ABA');
    expect(cleanInitials('x1y2z3q')).toBe('XYZ');
    expect(cleanInitials('')).toBe('AAA');
  });

  it('unlocks by the exit rules and persists completions', () => {
    const { profile, store } = make();
    expect(profile.isUnlocked({ unlock: { type: 'always' } })).toBe(true);
    const rule = { unlock: { type: 'completed', exitId: 'the-table' } } as const;
    expect(profile.isUnlocked(rule)).toBe(false);
    profile.markCompleted('the-table');
    expect(profile.isUnlocked(rule)).toBe(true);
    expect(new Profile(new Persistence(store)).isUnlocked(rule)).toBe(true);
    const score = { unlock: { type: 'score', exitId: 'the-table', min: 1000 } } as const;
    expect(profile.isUnlocked(score)).toBe(false);
    profile.addScore('the-table', 'AAA', 1500, '');
    expect(profile.isUnlocked(score)).toBe(true);
  });

  it('ignores corrupt saved scores', () => {
    const store = new MemoryStore();
    store.setItem('tmw.scores.v1', '{"a":[{"total":"lots"},{"total":500,"initials":"abcd"}],"b":7}');
    const p = new Profile(new Persistence(store));
    expect(p.entries('a')).toEqual([{ initials: 'ABC', total: 500, recordedAt: '' }]);
    expect(p.entries('b')).toEqual([]);
  });
});

const exitDef: ExitDef = {
  id: 'stub',
  name: 'Stub',
  subtitle: '',
  position: { ...STUB_EXIT },
  headingDeg: STUB_EXIT_HEADING_DEG,
  difficulty: 1,
  recommendedLandingZones: [],
  unlock: { type: 'always' },
  intro: { cameraPath: [], durationS: 6 },
  blurb: '',
  altHeadings: [],
};

function makeRun(): RunController {
  const run = new RunController({
    exit: exitDef,
    headingDeg: STUB_EXIT_HEADING_DEG,
    terrain: new StubTerrain(),
    zones: LandingZoneRegistry.fromData(),
    triggers: new TriggerRegistry([]),
    nowIso: () => '2026-11-08T00:00:00.000Z',
  });
  run.start();
  return run;
}

const idle: FlightInput = { pitch: 0, roll: 0, yaw: 0, deploy: false, flare: false, brake: false };

describe('RunController', () => {
  it('crashes in the wingsuit at the slope and still produces a scored RunResult', () => {
    const run = makeRun();
    for (let i = 0; i < 120 * 300 && !run.ended; i++) run.step(1 / 120, idle);
    const o = run.outcome!;
    expect(o.reason).toBe('crashed');
    expect(o.result.crashed).toBe(true);
    expect(o.result.landingScore).toBe(0);
    expect(o.result.total).toBeGreaterThan(0);
    expect(o.result.exitId).toBe('stub');
    expect(o.result.recordedAt).toBe('2026-11-08T00:00:00.000Z');
  });

  it('opens on deploy, lands, and reports a result', () => {
    const run = makeRun();
    const phases: string[] = [];
    run.onPhase((_, to) => phases.push(to));
    for (let i = 0; i < 120 * 400 && !run.ended; i++) {
      const st = run.state;
      run.stepRaw(1 / 120, {
        pitch: 0.15,
        roll: 0,
        yaw: 0,
        action: (st.phase === 'wingsuit' && st.aglM < 250) || (st.phase === 'canopy' && st.aglM < 3.5),
        brake: false,
      });
    }
    expect(phases).toEqual(expect.arrayContaining(['wingsuit', 'deploying', 'canopy']));
    expect(run.outcome).not.toBeNull();
    expect(run.outcome!.result.replay.length).toBeGreaterThan(100);
    // Deployed before the end, so air time is the wingsuit part only.
    expect(run.outcome!.result.airTimeS).toBeGreaterThan(10);
  });

  it('does not flare on the press that deployed; it needs a fresh press', () => {
    const run = makeRun();
    let heldSince = -1;
    for (let i = 0; i < 120 * 400 && !run.ended; i++) {
      const st = run.state;
      const action = st.phase === 'wingsuit' && st.aglM < 250 ? true : heldSince >= 0 && st.phase !== 'landed';
      if (action && heldSince < 0) heldSince = i;
      run.stepRaw(1 / 120, { pitch: 0.15, roll: 0, yaw: 0, action, brake: false });
      // Space stays down through the opening and the whole canopy descent.
      if (st.phase === 'canopy') expect(st.flareEnergy).toBe(1);
    }
    expect(run.outcome).not.toBeNull();
  });

  it('ends the run when the pilot leaves the area by 200 m', () => {
    const terrain = new StubTerrain();
    const run = new RunController({
      exit: { ...exitDef, position: { x: terrain.bounds.maxX + OUT_OF_BOUNDS_MARGIN_M - 10, y: 5000, z: 0 } },
      headingDeg: 90,
      terrain,
      zones: LandingZoneRegistry.fromData(),
      triggers: new TriggerRegistry([]),
    });
    run.start();
    for (let i = 0; i < 120 * 60 && !run.ended; i++) run.step(1 / 120, idle);
    expect(run.outcome?.reason).toBe('out-of-bounds');
    expect(run.outcome?.result.crashed).toBe(true);
  });

  it('scores a canopy landing in the sea as a water landing with no landing points', () => {
    const terrain = new StubTerrain();
    const run = new RunController({
      exit: { ...exitDef, position: { x: 2000, y: 400, z: 0 } },
      headingDeg: 90,
      terrain,
      zones: LandingZoneRegistry.fromData(),
      triggers: new TriggerRegistry([]),
    });
    run.start();
    for (let i = 0; i < 120 * 300 && !run.ended; i++) {
      const st = run.state;
      run.stepRaw(1 / 120, { pitch: 0, roll: 0, yaw: 0, action: st.phase === 'wingsuit' || (st.phase === 'canopy' && st.aglM < 3.5), brake: false });
    }
    const o = run.outcome!;
    expect(o.reason).toBe('water');
    expect(o.inWater).toBe(true);
    expect(o.result.landingScore).toBe(0);
    expect(o.result.landingZoneId).toBeNull();
    expect(o.result.crashed).toBe(false);
  });

  it('interpolates between the last two steps', () => {
    const run = makeRun();
    for (let i = 0; i < 240; i++) run.step(1 / 120, idle);
    const pose = { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
    run.interpolate(1, pose);
    expect(pose.position.x).toBeCloseTo(run.state.position.x, 9);
    run.interpolate(0, pose);
    const mid = { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
    run.interpolate(0.5, mid);
    expect(mid.position.y).toBeLessThan(pose.position.y);
    expect(mid.position.y).toBeGreaterThan(run.state.position.y);
  });
});

describe('Replay', () => {
  it('records at 30 Hz from a 120 Hz step', () => {
    const rec = new ReplayRecorder();
    const q = { x: 0, y: 0, z: 0, w: 1 };
    for (let i = 0; i <= 1200; i++) rec.sample(i / 120, { x: i, y: 0, z: 0 }, q, 'wingsuit');
    expect(rec.frames.length).toBe(301);
    expect(rec.frames[1].t).toBeCloseTo(1 / 30, 6);
  });

  it('round-trips through the packed storage form and back into a player', () => {
    const run = makeRun();
    for (let i = 0; i < 120 * 40 && !run.ended; i++) run.step(1 / 120, idle);
    run.abort();
    const frames = run.outcome!.result.replay;
    const json = JSON.stringify(packReplay(frames));
    const back = unpackReplay(JSON.parse(json) as unknown)!;
    expect(back).toHaveLength(frames.length);
    for (const i of [0, 7, frames.length - 1]) {
      expect(back[i].p.x).toBeCloseTo(frames[i].p.x, 1);
      expect(back[i].p.y).toBeCloseTo(frames[i].p.y, 1);
      expect(back[i].q.w).toBeCloseTo(frames[i].q.w, 3);
      expect(back[i].phase).toBe(frames[i].phase);
    }
    const player = new ReplayPlayer(back);
    const mid = (back[10].t + back[11].t) / 2;
    const pose = player.at(mid);
    expect(pose.p.y).toBeCloseTo((back[10].p.y + back[11].p.y) / 2, 4);
    expect(player.at(-5).p.x).toBeCloseTo(back[0].p.x, 6);
    expect(player.at(1e6).p.x).toBeCloseTo(back[back.length - 1].p.x, 6);
    expect(player.durationS).toBeCloseTo(back[back.length - 1].t, 6);
  });

  it('rejects malformed packed data', () => {
    expect(unpackReplay([[1, 2, 3]])).toBeNull();
    expect(unpackReplay('x')).toBeNull();
    expect(unpackReplay([[0, 0, 0, 0, 0, 0, 0, 1, 99]])).toBeNull();
  });

  it('stores the best run per exit with its replay and returns it after a reload', () => {
    const store = new MemoryStore();
    const run = makeRun();
    for (let i = 0; i < 120 * 20 && !run.ended; i++) run.step(1 / 120, idle);
    run.abort();
    const result = run.outcome!.result;
    const p = new Profile(new Persistence(store));
    expect(p.offerBestRun(result)).toBe(true);
    expect(p.offerBestRun({ ...result, total: result.total - 1 })).toBe(false);
    const again = new Profile(new Persistence(store));
    expect(again.bestRun('stub')?.total).toBe(result.total);
    expect(again.bestRun('stub')?.replay.length).toBe(result.replay.length);
    expect(again.bestRunOverall()?.exitId).toBe('stub');
  });
});
