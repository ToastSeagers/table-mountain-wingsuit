import type { InputManager } from '../core/InputManager';
import { STEER_SATURATION_FRACTION } from '../core/touchMapping';
import type { FlightPhase } from '../types/flight';
import { el } from './dom';

/** Diameter of the ring drawn where a steering finger landed, CSS px (visual only). */
const RING_PX = 96;

/**
 * On-screen flight controls for touch (brief 07 sections 3 and 4): PULL (FLARE after deploy), BRAKE
 * under canopy, pause and camera buttons, a ring and knob showing the steering finger, and the
 * rotate-to-landscape prompt. Steering itself is read from window pointer events in InputManager;
 * this module only draws and forwards button presses, so it holds no flight logic.
 */
export class TouchControls {
  readonly root = el('div', 'touch-controls');
  readonly rotate = el('div', 'rotate-prompt');
  private readonly pull = this.button('touch-btn pull', 'PULL');
  private readonly brake = this.button('touch-btn brake', 'BRAKE');
  private readonly pause = this.button('touch-btn pause', '||');
  private readonly camera = this.button('touch-btn cam', 'CAM');
  private readonly ring = el('div', 'steer-ring');
  private readonly knob = el('div', 'steer-knob');
  private phase: FlightPhase = 'freefall';
  private visible = false;

  constructor(private readonly input: InputManager) {
    this.pause.setAttribute('aria-label', 'Pause');
    this.camera.setAttribute('aria-label', 'Change camera');
    this.hold(this.pull, 'action');
    this.hold(this.brake, 'brake');
    this.tap(this.pause, 'pause');
    this.tap(this.camera, 'camera');
    this.ring.appendChild(this.knob);
    this.root.append(this.ring, this.pull, this.brake, this.pause, this.camera);
    this.rotate.append(el('div', 'rot-icon', '↻'), el('p', '', 'ROTATE YOUR PHONE'), el('small', '', 'FLIGHT IS FLOWN IN LANDSCAPE'));
    this.setVisible(false);
  }

  /** Shown while a flight is live and not paused. */
  setVisible(on: boolean): void {
    this.visible = on;
    this.root.classList.toggle('show', on);
    if (!on) this.ring.classList.remove('on');
  }

  /** Per frame while visible: label by phase, brake only under canopy, and the steering ring. */
  update(phase: FlightPhase): void {
    if (!this.visible) return;
    if (phase !== this.phase) {
      this.phase = phase;
      const canopy = phase === 'deploying' || phase === 'canopy';
      this.pull.textContent = canopy ? 'FLARE' : 'PULL';
      this.pull.classList.toggle('flare', canopy);
      this.brake.classList.toggle('on', canopy);
      const over = phase === 'landed' || phase === 'crashed';
      this.pull.classList.toggle('gone', over);
    }
    const s = this.input.touchSteer.snapshot();
    this.ring.classList.toggle('on', s.active);
    this.ring.classList.toggle('holding', s.active && s.mode === 'hold');
    if (s.active) {
      this.ring.style.transform = `translate(${s.anchorX - RING_PX / 2}px, ${s.anchorY - RING_PX / 2}px)`;
      // The knob travels the ring's radius over the same distance the stick takes to saturate.
      const travel = RING_PX / 2 - 16;
      const sat = window.innerWidth * STEER_SATURATION_FRACTION;
      const dx = Math.max(-1, Math.min(1, (s.x - s.anchorX) / sat)) * travel;
      const dy = Math.max(-1, Math.min(1, (s.y - s.anchorY) / sat)) * travel;
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  }

  private button(cls: string, label: string): HTMLButtonElement {
    const b = el('button', cls, label);
    b.type = 'button';
    // Long-press must not open the context menu or select text on a phone.
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  /** A button that is "down" while a finger is on it. Pointer capture keeps a sliding thumb on the button. */
  private hold(b: HTMLButtonElement, name: string): void {
    const up = (e: PointerEvent): void => {
      this.input.touchButtons.release(name);
      b.classList.remove('down');
      if (b.hasPointerCapture?.(e.pointerId)) b.releasePointerCapture(e.pointerId);
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture?.(e.pointerId);
      this.input.touchButtons.press(name);
      b.classList.add('down');
    });
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', () => {
      this.input.touchButtons.release(name);
      b.classList.remove('down');
    });
  }

  private tap(b: HTMLButtonElement, nav: 'pause' | 'camera'): void {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.injectNav(nav);
    });
  }
}
