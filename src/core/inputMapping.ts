import type { FlightInput } from '../types/flight';

/** Keyboard axes are low-passed with this time constant (flight spec section 5: 120 ms). */
export const KEYBOARD_SMOOTHING_S = 0.12;
export const STICK_DEADZONE = 0.12;
/** Mouse stick: axis counts per pixel at sensitivity 1, and how fast it recentres. */
export const MOUSE_AXIS_PER_PX = 0.0035;
export const MOUSE_RECENTRE_TAU_S = 0.7;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** First-order low pass: moves `current` toward `target` with time constant `tauS`. */
export function lowPass(current: number, target: number, dtS: number, tauS: number): number {
  if (tauS <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dtS / tauS));
}

/** Single-axis deadzone: 0 inside, rescaled so the edge of travel still reaches 1. */
export function deadzone(v: number, zone: number = STICK_DEADZONE): number {
  const a = Math.abs(v);
  if (a <= zone) return 0;
  return Math.sign(v) * Math.min(1, (a - zone) / (1 - zone));
}

export interface KeyboardAxes {
  pitch: number;
  roll: number;
  yaw: number;
}

/**
 * Default keyboard (flight spec section 5): W/S pitch, A/D roll, Q/E yaw. W pushes the nose down
 * (dive) and S pulls up, like pushing and pulling a stick; arrows mirror it; the invert-pitch
 * setting flips it. Shift = brake and Space = deploy / flare are read separately.
 */
export function keyboardAxes(down: ReadonlySet<string>, invertPitch: boolean): KeyboardAxes {
  const d = (...codes: string[]): number => (codes.some((c) => down.has(c)) ? 1 : 0);
  let pitch = d('KeyS', 'ArrowDown') - d('KeyW', 'ArrowUp');
  if (invertPitch) pitch = -pitch;
  return {
    pitch,
    roll: d('KeyD', 'ArrowRight') - d('KeyA', 'ArrowLeft'),
    yaw: d('KeyE') - d('KeyQ'),
  };
}

/** The bits of a Gamepad the mapping needs (a plain object so it tests without the DOM). */
export interface PadSnapshot {
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

export interface PadFlight {
  pitch: number;
  roll: number;
  yaw: number;
  action: boolean;
  brake: boolean;
}

/**
 * Standard-mapping gamepad: left stick pitch (forward dives) and roll, triggers yaw
 * (RT right, LT left), A deploy and flare, LB brake. Analog axes are not smoothed.
 */
export function mapGamepad(pad: PadSnapshot, invertPitch: boolean): PadFlight {
  const btn = (i: number): number => pad.buttons[i]?.value ?? 0;
  const pressed = (i: number): boolean => pad.buttons[i]?.pressed ?? false;
  let pitch = deadzone(pad.axes[1] ?? 0);
  if (invertPitch) pitch = -pitch;
  return {
    pitch,
    roll: deadzone(pad.axes[0] ?? 0),
    yaw: clamp(deadzone(btn(7)) - deadzone(btn(6)), -1, 1),
    action: pressed(0),
    brake: pressed(4),
  };
}

/** Navigation intents shared by keyboard and gamepad; screens and the state machine consume them. */
export type NavEvent = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause' | 'restart' | 'camera' | 'skip';

/** Gamepad buttons that mean something outside flight (standard mapping indices). */
export const PAD_NAV_BUTTONS: readonly (readonly [number, NavEvent])[] = [
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
  [0, 'confirm'],
  [1, 'back'],
  [9, 'pause'],
  [2, 'restart'],
  [3, 'camera'],
];

/** Stick direction as a nav event, or null inside the threshold. */
export function stickNav(x: number, y: number, threshold = 0.6): NavEvent | null {
  if (Math.abs(x) < threshold && Math.abs(y) < threshold) return null;
  if (Math.abs(y) >= Math.abs(x)) return y < 0 ? 'up' : 'down';
  return x < 0 ? 'left' : 'right';
}

/**
 * Mouse virtual stick: pointer-lock movement pushes the stick, which springs back to centre when
 * the mouse rests. Move down to pull up, like the stick.
 */
export class MouseStick {
  pitch = 0;
  roll = 0;

  move(dxPx: number, dyPx: number, sensitivity: number, invertPitch: boolean): void {
    const k = MOUSE_AXIS_PER_PX * sensitivity;
    this.roll = clamp(this.roll + dxPx * k, -1, 1);
    this.pitch = clamp(this.pitch + dyPx * k * (invertPitch ? -1 : 1), -1, 1);
  }

  update(dtS: number): void {
    const f = Math.exp(-dtS / MOUSE_RECENTRE_TAU_S);
    this.roll *= f;
    this.pitch *= f;
  }

  reset(): void {
    this.pitch = 0;
    this.roll = 0;
  }
}

/** Larger-magnitude of two axes: whichever device is deflected more wins. */
export function strongest(a: number, b: number): number {
  return Math.abs(a) >= Math.abs(b) ? a : b;
}

export function neutralInput(): FlightInput {
  return { pitch: 0, roll: 0, yaw: 0, deploy: false, flare: false, brake: false };
}
