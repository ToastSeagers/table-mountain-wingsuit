import type { FlightInput } from '../types/flight';
import {
  clamp,
  KEYBOARD_SMOOTHING_S,
  keyboardAxes,
  lowPass,
  mapGamepad,
  MouseStick,
  PAD_NAV_BUTTONS,
  stickNav,
  strongest,
  type NavEvent,
  type PadSnapshot,
} from './inputMapping';

/** The player's raw intent before the game decides what deploy and flare mean. */
export interface RawFlightInput {
  pitch: number;
  roll: number;
  yaw: number;
  /** Space or pad A held: deploy in the wingsuit, flare under canopy. */
  action: boolean;
  brake: boolean;
}

export type NavHandler = (e: NavEvent) => void;

const KEY_NAV: Record<string, NavEvent> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Enter: 'confirm',
  Space: 'confirm',
  Escape: 'back',
  KeyP: 'pause',
  KeyR: 'restart',
  KeyC: 'camera',
  Tab: 'skip',
};

/** Menu repeat for held directions on the pad stick / d-pad. */
const PAD_REPEAT_DELAY_S = 0.35;
const PAD_REPEAT_RATE_S = 0.12;

/**
 * Keyboard, pointer-lock mouse and Gamepad API in one place. Flight reads `readFlight(dt)`
 * every simulation step (the 120 ms keyboard low-pass runs at the fixed step, so replays of
 * input stay deterministic); menus read `onNav`. Mouse and pad are analog and unsmoothed.
 */
export class InputManager {
  invertPitch = false;
  mouseSensitivity = 1;
  private readonly down = new Set<string>();
  private readonly mouse = new MouseStick();
  private kbPitch = 0;
  private kbRoll = 0;
  private kbYaw = 0;
  private pad: PadSnapshot | null = null;
  private padIndex = -1;
  private readonly padPrev = new Map<number, boolean>();
  private padStick: NavEvent | null = null;
  private padStickHeldS = 0;
  private padStickRepeatS = 0;
  private readonly navHandlers = new Set<NavHandler>();
  private readonly keyHandlers = new Set<(e: KeyboardEvent) => void>();
  private readonly disposers: (() => void)[] = [];
  /** Set by UI that wants raw keys (initials entry) so menus do not also react to them. */
  captureKeys = false;

  constructor(private readonly canvas: HTMLElement) {
    const on = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void): void => {
      window.addEventListener(t, f as EventListener);
      this.disposers.push(() => window.removeEventListener(t, f as EventListener));
    };
    on('keydown', (e) => this.onKeyDown(e));
    on('keyup', (e) => this.down.delete(e.code));
    on('blur', () => {
      this.down.clear();
      this.mouse.reset();
    });
    on('mousemove', (e) => {
      if (this.pointerLocked) this.mouse.move(e.movementX, e.movementY, this.mouseSensitivity, this.invertPitch);
    });
    on('gamepadconnected', (e) => {
      this.padIndex = e.gamepad.index;
    });
    on('gamepaddisconnected', (e) => {
      if (this.padIndex === e.gamepad.index) {
        this.padIndex = -1;
        this.pad = null;
      }
    });
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  get gamepadConnected(): boolean {
    return this.pad !== null;
  }

  requestMouseCapture(): void {
    if (!this.pointerLocked) void this.canvas.requestPointerLock?.();
  }

  releaseMouse(): void {
    if (this.pointerLocked) document.exitPointerLock();
    this.mouse.reset();
  }

  onNav(handler: NavHandler): () => void {
    this.navHandlers.add(handler);
    return () => {
      this.navHandlers.delete(handler);
    };
  }

  /** Raw key events for text-like entry (high score initials). */
  onKey(handler: (e: KeyboardEvent) => void): () => void {
    this.keyHandlers.add(handler);
    return () => {
      this.keyHandlers.delete(handler);
    };
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** Clears held keys and smoothing, for a clean start of each run. */
  reset(): void {
    this.down.clear();
    this.mouse.reset();
    this.kbPitch = this.kbRoll = this.kbYaw = 0;
  }

  /** Polls the pad (call once per frame) and emits edge-detected menu events. */
  poll(dtS: number): void {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    let found: Gamepad | null = null;
    if (this.padIndex >= 0 && pads[this.padIndex]?.connected) found = pads[this.padIndex];
    else for (const p of pads) if (p?.connected) found = p;
    this.pad = found;
    if (!found) {
      this.padPrev.clear();
      return;
    }
    this.padIndex = found.index;
    for (const [index, nav] of PAD_NAV_BUTTONS) {
      const now = found.buttons[index]?.pressed ?? false;
      const was = this.padPrev.get(index) ?? false;
      if (now && !was) this.emit(nav);
      this.padPrev.set(index, now);
    }
    const dir = stickNav(found.axes[0] ?? 0, found.axes[1] ?? 0);
    if (dir !== this.padStick) {
      this.padStick = dir;
      this.padStickHeldS = 0;
      this.padStickRepeatS = 0;
      if (dir) this.emit(dir);
    } else if (dir) {
      this.padStickHeldS += dtS;
      if (this.padStickHeldS > PAD_REPEAT_DELAY_S) {
        this.padStickRepeatS += dtS;
        if (this.padStickRepeatS >= PAD_REPEAT_RATE_S) {
          this.padStickRepeatS = 0;
          this.emit(dir);
        }
      }
    }
  }

  /** Advances smoothing by one step and returns the raw intent. */
  readRaw(dtS: number): RawFlightInput {
    const kb = keyboardAxes(this.down, this.invertPitch);
    this.kbPitch = lowPass(this.kbPitch, kb.pitch, dtS, KEYBOARD_SMOOTHING_S);
    this.kbRoll = lowPass(this.kbRoll, kb.roll, dtS, KEYBOARD_SMOOTHING_S);
    this.kbYaw = lowPass(this.kbYaw, kb.yaw, dtS, KEYBOARD_SMOOTHING_S);
    this.mouse.update(dtS);
    const pad = this.pad ? mapGamepad(this.pad, this.invertPitch) : null;
    const analogPitch = strongest(this.mouse.pitch, pad?.pitch ?? 0);
    const analogRoll = strongest(this.mouse.roll, pad?.roll ?? 0);
    return {
      pitch: clamp(strongest(this.kbPitch, analogPitch), -1, 1),
      roll: clamp(strongest(this.kbRoll, analogRoll), -1, 1),
      yaw: clamp(strongest(this.kbYaw, pad?.yaw ?? 0), -1, 1),
      action: this.down.has('Space') || (pad?.action ?? false),
      brake: this.down.has('ShiftLeft') || this.down.has('ShiftRight') || (pad?.brake ?? false),
    };
  }

  /** Smoothed FlightInput for the simulation. deploy and flare both follow the action button. */
  readFlight(dtS: number): FlightInput {
    const r = this.readRaw(dtS);
    return { pitch: r.pitch, roll: r.roll, yaw: r.yaw, deploy: r.action, flare: r.action, brake: r.brake };
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.navHandlers.clear();
    this.keyHandlers.clear();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
    const fresh = !this.down.has(e.code);
    this.down.add(e.code);
    for (const h of this.keyHandlers) h(e);
    if (this.captureKeys) return;
    const nav = KEY_NAV[e.code];
    // Menus repeat on held arrows (browser key repeat); one-shot actions fire on the first press only.
    if (nav && (fresh || nav === 'up' || nav === 'down' || nav === 'left' || nav === 'right')) this.emit(nav);
  }

  private emit(nav: NavEvent): void {
    for (const h of this.navHandlers) h(nav);
  }
}
