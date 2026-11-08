import type { EventBus } from '../core/EventBus';
import type { CameraRig, CameraSubject } from '../game/CameraRig';

/** True when the OS asks for reduced motion (shake and grain pattern are frozen). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Stage 5 camera polish layered on CameraRig through its public parameters (`shakeScale`,
 * `fovOffsetDeg`, `kickM`); the rig itself is unchanged. The rig already shakes above 60 m/s and
 * during the opening shock; this adds the shock's pitch kick and FOV punch (spring driven) and a
 * little extra FOV stretch in a full dive, and switches shake off under reduced motion.
 */
export class CameraEffects {
  /** Reduced motion kills shake and the kick; the Camera Shake setting is handled by the rig. */
  reducedMotion = prefersReducedMotion();
  private kick = 0;
  private kickV = 0;
  private punch = 0;
  private punchV = 0;
  private stretch = 0;

  constructor(
    private readonly rig: CameraRig,
    bus: EventBus,
  ) {
    bus.on('phase', ({ to }) => {
      if (to === 'deploying') this.openingShock();
    });
  }

  /** The canopy snap: the view dips (the pilot is yanked upright), the lens squeezes then recovers. */
  openingShock(): void {
    if (this.reducedMotion || !this.rig.shakeEnabled) return;
    this.kickV = -22;
    this.punchV = -90;
  }

  update(dtS: number, subject: CameraSubject): void {
    const dt = Math.min(dtS, 0.05);
    // Critically-damped-ish springs, semi-implicit Euler.
    this.kickV += (-140 * this.kick - 13 * this.kickV) * dt;
    this.kick += this.kickV * dt;
    this.punchV += (-110 * this.punch - 11 * this.punchV) * dt;
    this.punch += this.punchV * dt;
    const dive = Math.max(0, Math.min(1, (subject.airspeedMps - 70) / 25));
    this.stretch += (dive * 4 - this.stretch) * Math.min(1, dt * 2);
    this.rig.shakeScale = this.reducedMotion ? 0 : 1;
    this.rig.kickM = this.reducedMotion ? 0 : this.kick;
    this.rig.fovOffsetDeg = this.reducedMotion
      ? 0
      : this.punch + (this.rig.shakeEnabled ? this.stretch : 0);
  }
}

/** Intro flyover easing: ease in and out of the path, mostly smooth with some linear so it never stalls. */
export function introEase(u: number): number {
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  const s = x * x * (3 - 2 * x);
  return 0.75 * s + 0.25 * x;
}
