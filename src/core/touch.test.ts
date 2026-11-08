import { describe, expect, it } from 'vitest';
import { MemoryStore, Persistence } from './Persistence';
import { autoQuality, isMobileDevice, wantsTouchUi, type DeviceEnv } from './device';
import { DEFAULT_SETTINGS, sanitiseSettings, SettingsStore } from './Settings';
import { DRAG_SLOP_PX, HOLD_BANK, HOLD_TO_BANK_S, STEER_SATURATION_FRACTION, TouchButtons, TouchSteer } from './touchMapping';

const W = 800;
const SAT = W * STEER_SATURATION_FRACTION; // 200 px

function steer(invert = false): TouchSteer {
  const t = new TouchSteer();
  t.setScreen(W);
  t.invertPitch = invert;
  return t;
}

describe('TouchSteer drag', () => {
  it('anchors where the finger lands, wherever that is', () => {
    const t = steer();
    expect(t.begin(1, 300, 200)).toBe(true);
    t.move(1, 300 + SAT / 2, 200);
    expect(t.roll).toBeGreaterThan(0.3);
    expect(t.roll).toBeLessThan(0.6);
    t.reset();
    t.begin(1, 50, 90);
    t.move(1, 50 + SAT / 2, 90);
    expect(t.roll).toBeGreaterThan(0.3);
  });

  it('ignores the right third of the screen (the buttons live there)', () => {
    const t = steer();
    expect(t.begin(1, W * 0.7, 200)).toBe(false);
    expect(t.active).toBe(false);
    expect(t.begin(1, W * 0.66, 200)).toBe(true);
  });

  it('has a dead zone and then reaches full travel', () => {
    const t = steer();
    t.begin(1, 200, 200);
    t.move(1, 200 + DRAG_SLOP_PX + 1, 200); // a drag, but inside the dead zone (12 percent of 200 px = 24 px)
    expect(t.roll).toBe(0);
    t.move(1, 200 + SAT * 0.12 + 1, 200);
    expect(t.roll).toBeGreaterThan(0);
    expect(t.roll).toBeLessThan(0.05);
    t.move(1, 200 + SAT, 200);
    expect(t.roll).toBeCloseTo(1, 5);
  });

  it('saturates at 25 percent of the screen width and does not exceed 1', () => {
    const t = steer();
    t.begin(1, 100, 200);
    t.move(1, 100 + SAT * 3, 200);
    expect(t.roll).toBe(1);
    t.move(1, 100 - SAT * 3, 200);
    expect(t.roll).toBe(-1);
  });

  it('maps drag down to dive (negative pitch) and up to pull up, and invert flips it', () => {
    const t = steer();
    t.begin(1, 200, 200);
    t.move(1, 200, 200 + SAT);
    expect(t.pitch).toBeCloseTo(-1, 5);
    t.move(1, 200, 200 - SAT);
    expect(t.pitch).toBeCloseTo(1, 5);
    const inv = steer(true);
    inv.begin(1, 200, 200);
    inv.move(1, 200, 200 + SAT);
    expect(inv.pitch).toBeCloseTo(1, 5);
  });

  it('returns both axes to zero on release', () => {
    const t = steer();
    t.begin(1, 200, 200);
    t.move(1, 200 + SAT, 200 - SAT);
    expect(t.roll).toBe(1);
    expect(t.pitch).toBe(1);
    t.end(1);
    expect(t.roll).toBe(0);
    expect(t.pitch).toBe(0);
    expect(t.active).toBe(false);
  });

  it('follows one finger only: a second finger and unrelated ids are ignored', () => {
    const t = steer();
    t.begin(1, 200, 200);
    expect(t.begin(2, 100, 100)).toBe(false);
    t.move(2, 500, 500);
    expect(t.roll).toBe(0);
    t.end(2);
    expect(t.active).toBe(true);
  });
});

describe('TouchSteer hold-to-bank', () => {
  const third = (W * (2 / 3)) / 3;

  it('banks left at 0.6 after a 120 ms still hold on the left third', () => {
    const t = steer();
    t.begin(1, third * 0.5, 200);
    t.update(HOLD_TO_BANK_S - 0.01);
    expect(t.roll).toBe(0);
    t.update(0.02);
    expect(t.roll).toBe(-HOLD_BANK);
    expect(t.currentMode).toBe('hold');
  });

  it('banks right on the right third of the steering area', () => {
    const t = steer();
    t.begin(1, third * 2.5, 200);
    t.update(0.2);
    expect(t.roll).toBe(HOLD_BANK);
  });

  it('does nothing on the middle third', () => {
    const t = steer();
    t.begin(1, third * 1.5, 200);
    t.update(0.5);
    expect(t.roll).toBe(0);
  });

  it('a short tap does nothing', () => {
    const t = steer();
    t.begin(1, 40, 200);
    t.update(0.08);
    t.end(1);
    t.update(0.2);
    expect(t.roll).toBe(0);
  });

  it('a touch that moves becomes a drag and never banks by hold', () => {
    const t = steer();
    t.begin(1, 40, 200);
    t.update(0.05);
    t.move(1, 40 + DRAG_SLOP_PX + 5, 200);
    expect(t.currentMode).toBe('drag');
    t.update(0.5);
    expect(t.roll).toBe(0); // still inside the dead zone, and not the 0.6 hold
  });

  it('releasing a hold returns to zero', () => {
    const t = steer();
    t.begin(1, 40, 200);
    t.update(0.2);
    expect(t.roll).toBe(-HOLD_BANK);
    t.end(1);
    expect(t.roll).toBe(0);
  });
});

describe('TouchButtons', () => {
  it('counts a tap shorter than a simulation step once, then releases', () => {
    const b = new TouchButtons();
    b.press('action');
    b.release('action');
    expect(b.consume('action')).toBe(true);
    expect(b.consume('action')).toBe(false);
  });

  it('keeps reporting a held button until released', () => {
    const b = new TouchButtons();
    b.press('brake');
    expect(b.isHeld('brake')).toBe(true);
    expect(b.consume('brake')).toBe(true);
    expect(b.consume('brake')).toBe(true);
    b.release('brake');
    expect(b.consume('brake')).toBe(false);
  });
});

const phone: DeviceEnv = { maxTouchPoints: 5, screenWidthPx: 812, screenHeightPx: 375, coarsePointer: true };
const desktop: DeviceEnv = { maxTouchPoints: 0, screenWidthPx: 1920, screenHeightPx: 1080, coarsePointer: false };

describe('device detection and preset auto-selection', () => {
  it('selects mobile for a touch device whose shorter side is under 900 px, in either orientation', () => {
    expect(autoQuality(phone)).toBe('mobile');
    expect(autoQuality({ ...phone, screenWidthPx: 375, screenHeightPx: 812 })).toBe('mobile');
  });

  it('keeps medium on desktops, touch laptops and tablets with a short side of 900 or more', () => {
    expect(autoQuality(desktop)).toBe('medium');
    expect(autoQuality({ ...desktop, maxTouchPoints: 10 })).toBe('medium');
    expect(isMobileDevice({ ...phone, screenWidthPx: 1180, screenHeightPx: 820 })).toBe(true);
    expect(isMobileDevice({ ...phone, screenWidthPx: 1366, screenHeightPx: 1024 })).toBe(false);
  });

  it('does not treat a small desktop window as a phone when there is no touch', () => {
    expect(isMobileDevice({ ...desktop, screenWidthPx: 800, screenHeightPx: 600 })).toBe(false);
  });

  it('shows touch controls on phones and when forced, not on a mouse desktop', () => {
    expect(wantsTouchUi(phone, false)).toBe(true);
    expect(wantsTouchUi(desktop, false)).toBe(false);
    expect(wantsTouchUi(desktop, true)).toBe(true);
    expect(wantsTouchUi({ ...desktop, maxTouchPoints: 10 }, false)).toBe(false);
  });
});

describe('quality setting auto-selection', () => {
  const fresh = (): Persistence => new Persistence(new MemoryStore());

  it('resolves an unchosen quality to the device preset', () => {
    const s = new SettingsStore(fresh(), 'mobile');
    expect(s.value.quality).toBe('mobile');
    expect(s.value.qualityAuto).toBe(true);
  });

  it('an override sticks and survives a reload; going back to auto follows the device again', () => {
    const backing = new MemoryStore();
    const mk = (auto: 'medium' | 'mobile'): SettingsStore => new SettingsStore(new Persistence(backing), auto);
    const a = mk('mobile');
    a.set('quality', 'high');
    expect(a.value.qualityAuto).toBe(false);
    expect(mk('mobile').value.quality).toBe('high');
    a.setQualityAuto();
    expect(mk('mobile').value.quality).toBe('mobile');
    expect(mk('medium').value.quality).toBe('medium');
  });

  it('keeps a v0.1 save that chose a non-default preset, and treats a default one as unchosen', () => {
    expect(sanitiseSettings({ quality: 'high' })?.qualityAuto).toBe(false);
    expect(sanitiseSettings({ quality: DEFAULT_SETTINGS.quality })?.qualityAuto).toBe(true);
  });
});
