import { describe, expect, it } from 'vitest';
import { defaultCue } from './avatarPose';
import { CELLS } from './CanopyMesh';
import { PlayerAvatar } from './PlayerAvatar';

// Geometry budgets from the Stage 8 brief: pilot under about 3,000 triangles, canopy under 2,000.
describe('PlayerAvatar geometry', () => {
  const avatar = new PlayerAvatar();

  it('stays inside the triangle budgets', () => {
    const n = avatar.triangleCount();
    expect(n.pilot).toBeGreaterThan(300);
    expect(n.pilot).toBeLessThan(3000);
    expect(n.canopy).toBeGreaterThan(300);
    expect(n.canopy).toBeLessThan(2000);
  });

  it('draws seven cells with lines to both risers and brake lines to the hands', () => {
    expect(CELLS).toBe(7);
    const lines = avatar.canopy.lines.geometry.getAttribute('position').count / 2;
    // A and C lines on each of the eight ribs, plus four brake lines.
    expect(lines).toBe((CELLS + 1) * 2 + 4);
  });

  it('updates through a whole flight without the canopy appearing early', () => {
    const q = { x: 0, y: 0, z: 0, w: 1 };
    const p = { x: 0, y: 500, z: 0 };
    avatar.reset();
    avatar.update(1 / 60, p, q, 'wingsuit', {
      ...defaultCue(),
      airspeedMps: 50,
      pitchInput: -0.5,
      bankDeg: 30,
    });
    expect(avatar.canopy.pivot.visible).toBe(false);
    avatar.update(1 / 60, p, q, 'deploying', {
      ...defaultCue(),
      phase: 'deploying',
      openingProgress: 0.3,
    });
    expect(avatar.canopy.pivot.visible).toBe(true);
    for (let i = 0; i < 60; i++) {
      avatar.update(1 / 60, p, q, 'canopy', {
        ...defaultCue(),
        phase: 'canopy',
        airspeedMps: 12,
        flare: i > 30,
        brakeDeflection: i > 30 ? 1 : 0,
      });
    }
    const pos = avatar.canopy.lines.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      expect(
        Number.isFinite(pos.getX(i)) &&
          Number.isFinite(pos.getY(i)) &&
          Number.isFinite(pos.getZ(i)),
      ).toBe(true);
    }
    // Canopy sits above the risers once the lines are out.
    expect(avatar.canopy.canopy.position.y).toBeGreaterThan(3);
  });

  it('estimates its cues from motion when none are given (replays)', () => {
    const q = { x: 0, y: 0, z: 0, w: 1 };
    avatar.reset();
    for (let i = 0; i < 30; i++)
      avatar.update(1 / 30, { x: i * 1.4, y: 500 - i * 0.5, z: 0 }, q, 'wingsuit', undefined, 300);
    expect(avatar.group.position.x).toBeCloseTo(29 * 1.4, 5);
  });
});
