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
import { TouchButtons, TouchSteer } from './touchMapping';

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
  /** Smoothed touch-stick axes (same 120 ms low-pass as the keyboard). */
  private tPitch = 0;
  private tRoll = 0;
  private pad: PadSnapshot | null = null;
  private padIndex = -1;
  private readonly padPrev = new Map<number, boolean>();
  private padStick: NavEvent | null = null;
  private padStickHeldS = 0;
  private padStickRepeatS = 0;
  private readonly navHandlers = new Set<NavHandler>();
  private readonly keyHandlers = new Set<(e: KeyboardEvent) => void>();
  private readonly disposers: (() => void)[] = [];
  /** Finger steering and on-screen buttons (stage 7). The UI feeds `touchButtons`; pointer events feed `touchSteer`. */
  readonly touchSteer = new TouchSteer();
  readonly touchButtons = new TouchButtons();
  /** On-screen controls are in use: a phone, `?touch=1`, or a finger was seen on a hybrid device. */
  touchUi = false;
  /** Game sets this while a flight is live and unpaused; pointer drags steer only then. */
  touchSteerEnabled = false;
  private readonly touchUiListeners = new Set<(on: boolean) => void>();
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
      this.resetTouch();
    });
    on('pointerdown', (e) => this.onPointerDown(e));
    on('pointermove', (e) => this.touchSteer.move(e.pointerId, e.clientX, e.clientY));
    on('pointerup', (e) => this.touchSteer.end(e.pointerId));
    on('pointercancel', (e) => this.touchSteer.end(e.pointerId));
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
    this.resetTouch();
  }

  private resetTouch(): void {
    this.touchSteer.reset();
    this.touchButtons.releaseAll();
    this.tPitch = this.tRoll = 0;
  }

  /** Lets on-screen buttons raise the same events as keys (pause, camera). */
  injectNav(nav: NavEvent): void {
    this.emit(nav);
  }

  /** Called by the Game with the stage's decision; also flips on when a real finger touches a hybrid device. */
  setTouchUi(on: boolean): void {
    if (on === this.touchUi) return;
    this.touchUi = on;
    for (const l of this.touchUiListeners) l(on);
  }

  onTouchUi(listener: (on: boolean) => void): () => void {
    this.touchUiListeners.add(listener);
    return () => {
      this.touchUiListeners.delete(listener);
    };
  }

  setTouchSteerEnabled(on: boolean): void {
    if (this.touchSteerEnabled === on) return;
    this.touchSteerEnabled = on;
    if (!on) this.resetTouch();
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
    this.touchSteer.invertPitch = this.invertPitch;
    this.touchSteer.setScreen(window.innerWidth);
    this.touchSteer.update(dtS);
    this.tPitch = lowPass(this.tPitch, this.touchSteer.pitch, dtS, KEYBOARD_SMOOTHING_S);
    this.tRoll = lowPass(this.tRoll, this.touchSteer.roll, dtS, KEYBOARD_SMOOTHING_S);
    // TILT HOOK: an optional device-orientation source (settings choice, off by default) would be
    // merged here with `strongest`, as the touch stick is. Not built in Stage 7; see core/touchMapping.ts.
    const pad = this.pad ? mapGamepad(this.pad, this.invertPitch) : null;
    const analogPitch = strongest(strongest(this.mouse.pitch, pad?.pitch ?? 0), this.tPitch);
    const analogRoll = strongest(strongest(this.mouse.roll, pad?.roll ?? 0), this.tRoll);
    return {
      pitch: clamp(strongest(this.kbPitch, analogPitch), -1, 1),
      roll: clamp(strongest(this.kbRoll, analogRoll), -1, 1),
      yaw: clamp(strongest(this.kbYaw, pad?.yaw ?? 0), -1, 1),
      // consume(): a tap on PULL shorter than one simulation step still counts as a press.
      action: this.down.has('Space') || (pad?.action ?? false) || this.touchButtons.consume('action'),
      brake: this.down.has('ShiftLeft') || this.down.has('ShiftRight') || (pad?.brake ?? false) || this.touchButtons.isHeld('brake'),
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

  private onPointerDown(e: PointerEvent): void {
    // A finger on a hybrid laptop switches the on-screen controls on for the rest of the session.
    if (e.pointerType === 'touch') this.setTouchUi(true);
    if (!this.touchUi || !this.touchSteerEnabled) return;
    // On a touch-first device a mouse pointer is how emulators and Bluetooth mice arrive: treat it as a finger.
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen' && e.pointerType !== 'mouse') return;
    if (e.target instanceof Element && e.target.closest('button, .touch-btn')) return;
    this.touchSteer.setScreen(window.innerWidth);
    this.touchSteer.begin(e.pointerId, e.clientX, e.clientY);
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
