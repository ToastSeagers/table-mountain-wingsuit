import { describe, expect, it } from 'vitest';
import { EventBus } from './EventBus';
import { FixedStepLoop, MAX_FRAME_DT_S, SIM_STEP_S } from './FixedStepLoop';
import {
  deadzone,
  keyboardAxes,
  KEYBOARD_SMOOTHING_S,
  lowPass,
  mapGamepad,
  MouseStick,
  stickNav,
  type PadSnapshot,
} from './inputMapping';
import { MemoryStore, Persistence, storageKey } from './Persistence';
import { DEFAULT_SETTINGS, sanitiseSettings, SettingsStore } from './Settings';

describe('FixedStepLoop', () => {
  it('runs exactly the steps the elapsed time pays for and returns the remainder as alpha', () => {
    const loop = new FixedStepLoop();
    let steps = 0;
    const alpha = loop.advance(SIM_STEP_S * 2.5, () => steps++);
    expect(steps).toBe(2);
    expect(alpha).toBeCloseTo(0.5, 5);
  });

  it('carries the remainder between frames', () => {
    const loop = new FixedStepLoop();
    let steps = 0;
    for (let i = 0; i < 60; i++) loop.advance(1 / 60, () => steps++);
    expect(steps).toBe(120);
  });

  it('clamps a long stall to one frame budget and never spirals', () => {
    const loop = new FixedStepLoop();
    let steps = 0;
    loop.advance(5, () => steps++);
    expect(steps).toBeLessThanOrEqual(Math.ceil(MAX_FRAME_DT_S / SIM_STEP_S));
    steps = 0;
    const capped = new FixedStepLoop(SIM_STEP_S, 3);
    capped.advance(0.1, () => steps++);
    expect(steps).toBe(3);
  });

  it('ignores negative frame times', () => {
    const loop = new FixedStepLoop();
    let steps = 0;
    loop.advance(-1, () => steps++);
    expect(steps).toBe(0);
  });
});

describe('input mapping', () => {
  it('low-passes a keyboard tap: 63% after one time constant, never overshooting', () => {
    let v = 0;
    const n = Math.round(KEYBOARD_SMOOTHING_S / SIM_STEP_S);
    for (let i = 0; i < n; i++) v = lowPass(v, 1, SIM_STEP_S, KEYBOARD_SMOOTHING_S);
    expect(v).toBeGreaterThan(0.6);
    expect(v).toBeLessThan(0.66);
    for (let i = 0; i < 1000; i++) v = lowPass(v, 1, SIM_STEP_S, KEYBOARD_SMOOTHING_S);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('maps W to nose down and S to nose up, and invert flips it', () => {
    expect(keyboardAxes(new Set(['KeyW']), false).pitch).toBe(-1);
    expect(keyboardAxes(new Set(['KeyS']), false).pitch).toBe(1);
    expect(keyboardAxes(new Set(['KeyW']), true).pitch).toBe(1);
    expect(keyboardAxes(new Set(['KeyA']), false).roll).toBe(-1);
    expect(keyboardAxes(new Set(['KeyD', 'KeyA']), false).roll).toBe(0);
    expect(keyboardAxes(new Set(['KeyE']), false).yaw).toBe(1);
  });

  it('applies a deadzone that still reaches full travel', () => {
    expect(deadzone(0.1)).toBe(0);
    expect(deadzone(-0.05)).toBe(0);
    expect(deadzone(1)).toBe(1);
    expect(deadzone(-1)).toBe(-1);
    expect(deadzone(0.56)).toBeCloseTo(0.5, 2);
  });

  it('maps a standard gamepad: stick, triggers, A and LB', () => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    buttons[7] = { pressed: true, value: 1 };
    buttons[0] = { pressed: true, value: 1 };
    buttons[4] = { pressed: true, value: 1 };
    const pad: PadSnapshot = { axes: [0.8, -1, 0, 0], buttons };
    const m = mapGamepad(pad, false);
    expect(m.pitch).toBe(-1); // stick forward dives
    expect(m.roll).toBeGreaterThan(0.7);
    expect(m.yaw).toBe(1);
    expect(m.action).toBe(true);
    expect(m.brake).toBe(true);
    expect(mapGamepad(pad, true).pitch).toBe(1);
  });

  it('turns a stick push into a nav direction', () => {
    expect(stickNav(0, -0.9)).toBe('up');
    expect(stickNav(0.9, 0.2)).toBe('right');
    expect(stickNav(0.2, 0.2)).toBeNull();
  });

  it('mouse stick pushes, clamps and recentres', () => {
    const m = new MouseStick();
    m.move(10000, 10000, 1, false);
    expect(m.roll).toBe(1);
    expect(m.pitch).toBe(1);
    for (let i = 0; i < 600; i++) m.update(SIM_STEP_S);
    expect(Math.abs(m.roll)).toBeLessThan(0.01);
    m.move(0, 100, 1, true);
    expect(m.pitch).toBeLessThan(0);
  });
});

describe('Persistence and settings', () => {
  it('round-trips JSON under versioned keys', () => {
    const store = new MemoryStore();
    const p = new Persistence(store);
    expect(p.save('scores', 1, { a: 1 })).toBe(true);
    expect(store.getItem('tmw.scores.v1')).toBe('{"a":1}');
    expect(p.load('scores', 1, (r) => r as { a: number }, () => ({ a: 0 }))).toEqual({ a: 1 });
    // A newer version does not see old data.
    expect(p.load('scores', 2, (r) => r as { a: number }, () => ({ a: 0 }))).toEqual({ a: 0 });
    expect(storageKey('settings', 3)).toBe('tmw.settings.v3');
  });

  it('treats corrupt data as missing', () => {
    const store = new MemoryStore();
    store.setItem('tmw.x.v1', '{not json');
    expect(new Persistence(store).load('x', 1, (r) => r, () => 'fallback')).toBe('fallback');
    store.setItem('tmw.y.v1', '[1]');
    expect(new Persistence(store).load('y', 1, () => null, () => 'fallback')).toBe('fallback');
  });

  it('survives a store that throws', () => {
    const bad = {
      getItem: (): string | null => {
        throw new Error('denied');
      },
      setItem: (): void => {
        throw new Error('quota');
      },
      removeItem: (): void => undefined,
    };
    const p = new Persistence(bad);
    expect(p.save('a', 1, {})).toBe(false);
    expect(p.load('a', 1, (r) => r, () => 7)).toBe(7);
  });

  it('fills missing and bad settings from defaults and persists changes', () => {
    expect(sanitiseSettings({ masterVolume: 5, quality: 'ultra', invertPitch: true })).toMatchObject({
      masterVolume: 1,
      quality: DEFAULT_SETTINGS.quality,
      invertPitch: true,
      cameraShake: true,
    });
    const store = new MemoryStore();
    const s = new SettingsStore(new Persistence(store));
    let seen = 0;
    s.onChange(() => seen++);
    s.set('quality', 'high');
    expect(seen).toBe(1);
    expect(new SettingsStore(new Persistence(store)).value.quality).toBe('high');
  });
});

describe('EventBus', () => {
  it('delivers payloads and unsubscribes', () => {
    const bus = new EventBus();
    const got: number[] = [];
    const off = bus.on('countdown', (n) => got.push(n));
    bus.emit('countdown', 3);
    off();
    bus.emit('countdown', 2);
    expect(got).toEqual([3]);
  });
});
