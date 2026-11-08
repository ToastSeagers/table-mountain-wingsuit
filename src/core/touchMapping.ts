import { clamp, deadzone } from './inputMapping';

/** Fraction of the screen width, from the left edge, that steers. The right third holds the buttons. */
export const STEER_AREA_FRACTION = 2 / 3;
/** A drag this far from the anchor (as a fraction of the screen width) saturates both axes. */
export const STEER_SATURATION_FRACTION = 0.25;
/** Dead zone as a fraction of full travel; same value the pad stick uses. */
export const STEER_DEADZONE = 0.12;
/** A still hold this long on the left or right third banks the suit. */
export const HOLD_TO_BANK_S = 0.12;
/** Roll set by a hold (a drag reaches 1; a hold is the coarse setting). */
export const HOLD_BANK = 0.6;
/** Finger travel in CSS px that turns a touch into a drag. Smaller than the dead zone at phone widths. */
export const DRAG_SLOP_PX = 10;

/**
 * TILT HOOK (not implemented in Stage 7): a later stage can add device-orientation steering as an
 * optional settings choice by feeding a roll/pitch target into the same low-pass in InputManager
 * (`readRaw`, the line marked TILT HOOK). Keep touch and tilt mutually exclusive per setting.
 */
export type TouchMode = 'pending' | 'hold' | 'drag';

export interface TouchSteerSnapshot {
  active: boolean;
  mode: TouchMode;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
}

/**
 * Virtual stick for one finger on the left two thirds of the screen. The anchor is where the
 * finger lands. Moving more than the slop makes it a drag: horizontal offset maps to roll, vertical
 * to pitch (down dives), full at 25 percent of the screen width, with a dead zone. A finger that
 * stays put for 120 ms on the left or right third of the steering area banks that way at 0.6
 * instead. A short tap does nothing. The outputs are raw targets; the caller low-passes them.
 *
 * Pure and DOM-free so it tests headless; time only advances through `update`.
 */
export class TouchSteer {
  /** Target roll, -1 (left) to 1 (right), before smoothing. */
  roll = 0;
  /** Target pitch, -1 (dive) to 1 (pull up), before smoothing and invert. Drag down = dive. */
  pitch = 0;
  invertPitch = false;
  private widthPx = 800;
  private id: number | null = null;
  private mode: TouchMode = 'pending';
  private heldS = 0;
  private ax = 0;
  private ay = 0;
  private x = 0;
  private y = 0;

  setScreen(widthPx: number): void {
    this.widthPx = Math.max(1, widthPx);
  }

  get active(): boolean {
    return this.id !== null;
  }

  get currentMode(): TouchMode {
    return this.mode;
  }

  snapshot(): TouchSteerSnapshot {
    return { active: this.active, mode: this.mode, anchorX: this.ax, anchorY: this.ay, x: this.x, y: this.y };
  }

  /** Starts steering with this pointer if it landed in the steering area and none is active. */
  begin(id: number, x: number, y: number): boolean {
    if (this.id !== null) return false;
    if (x > this.widthPx * STEER_AREA_FRACTION) return false;
    this.id = id;
    this.mode = 'pending';
    this.heldS = 0;
    this.ax = this.x = x;
    this.ay = this.y = y;
    this.roll = 0;
    this.pitch = 0;
    return true;
  }

  move(id: number, x: number, y: number): void {
    if (id !== this.id) return;
    this.x = x;
    this.y = y;
    if (this.mode !== 'drag' && Math.hypot(x - this.ax, y - this.ay) > DRAG_SLOP_PX) this.mode = 'drag';
    if (this.mode === 'drag') this.applyDrag();
  }

  end(id: number): void {
    if (id !== this.id) return;
    this.reset();
  }

  /** Release to zero; also the clean start of every run. */
  reset(): void {
    this.id = null;
    this.mode = 'pending';
    this.heldS = 0;
    this.roll = 0;
    this.pitch = 0;
  }

  /** Advances the hold timer. Call once per simulation step. */
  update(dtS: number): void {
    if (this.id === null || this.mode !== 'pending') return;
    this.heldS += dtS;
    if (this.heldS < HOLD_TO_BANK_S) return;
    this.mode = 'hold';
    // Thirds of the steering area, measured where the finger landed.
    const third = (this.widthPx * STEER_AREA_FRACTION) / 3;
    this.roll = this.ax < third ? -HOLD_BANK : this.ax > third * 2 ? HOLD_BANK : 0;
  }

  private applyDrag(): void {
    const sat = this.widthPx * STEER_SATURATION_FRACTION;
    this.roll = deadzone(clamp((this.x - this.ax) / sat, -1, 1), STEER_DEADZONE);
    // Screen y grows downward; drag down dives, which is a negative pitch input.
    const p = deadzone(clamp(-(this.y - this.ay) / sat, -1, 1), STEER_DEADZONE);
    this.pitch = this.invertPitch ? -p : p;
  }
}

/** Held / tapped state for the on-screen buttons. A tap shorter than one sim step still counts. */
export class TouchButtons {
  private held = new Set<string>();
  private pulses = new Set<string>();

  press(name: string): void {
    this.held.add(name);
    this.pulses.add(name);
  }

  release(name: string): void {
    this.held.delete(name);
  }

  releaseAll(): void {
    this.held.clear();
    this.pulses.clear();
  }

  /** Held now, or pressed since the last `consume` of the same name. */
  consume(name: string): boolean {
    const was = this.held.has(name) || this.pulses.has(name);
    this.pulses.delete(name);
    return was;
  }

  isHeld(name: string): boolean {
    return this.held.has(name);
  }
}
