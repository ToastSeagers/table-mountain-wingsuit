import type { PerspectiveCamera } from 'three';
import type { Viewpoint } from './viewpoints';

const DEG = Math.PI / 180;
export const DEV_SPEED_MIN_MPS = 2;
export const DEV_SPEED_MAX_MPS = 3000;

/**
 * Free-fly camera for `?dev=1`: WASD to move, Q/E down/up, Shift x4, mouse look while the
 * pointer is locked (click the canvas) or while the right button is held, scroll for speed,
 * 1 to 4 jump to the measurement viewpoints.
 */
export class DevCamera {
  speedMps = 120;
  headingDeg = 0;
  pitchDeg = 0;
  private readonly keys = new Set<string>();
  private dragging = false;
  private readonly disposers: (() => void)[] = [];

  constructor(
    private readonly camera: PerspectiveCamera,
    canvas: HTMLCanvasElement,
    private readonly viewpoints: Viewpoint[],
    private readonly onTeleport: (vp: Viewpoint) => void = () => undefined,
  ) {
    const on = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void, target: EventTarget = window): void => {
      target.addEventListener(t, f as EventListener);
      this.disposers.push(() => target.removeEventListener(t, f as EventListener));
    };
    on('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
      const n = Number(e.key);
      if (n >= 1 && n <= this.viewpoints.length) this.goto(this.viewpoints[n - 1]);
    });
    on('keyup', (e) => this.keys.delete(e.code));
    on('blur', () => this.keys.clear());
    on('mousedown', (e) => {
      if (e.button === 2) this.dragging = true;
      else if (e.button === 0 && document.pointerLockElement !== canvas) void canvas.requestPointerLock?.();
    }, canvas);
    on('mouseup', (e) => {
      if (e.button === 2) this.dragging = false;
    });
    on('contextmenu', (e) => e.preventDefault(), canvas);
    on('mousemove', (e) => {
      if (!this.dragging && document.pointerLockElement !== canvas) return;
      this.headingDeg = (this.headingDeg + e.movementX * 0.12 + 360) % 360;
      this.pitchDeg = Math.max(-89, Math.min(89, this.pitchDeg - e.movementY * 0.12));
    });
    on('wheel', (e) => {
      const f = e.deltaY < 0 ? 1.25 : 1 / 1.25;
      this.speedMps = Math.max(DEV_SPEED_MIN_MPS, Math.min(DEV_SPEED_MAX_MPS, this.speedMps * f));
    }, canvas);
  }

  /** Places the camera at a viewpoint. */
  goto(vp: Viewpoint): void {
    this.camera.position.set(vp.position.x, vp.position.y, vp.position.z);
    this.headingDeg = vp.headingDeg;
    this.pitchDeg = vp.pitchDeg;
    this.apply();
    this.onTeleport(vp);
  }

  update(dtS: number): void {
    const k = this.keys;
    const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const right = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const up = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    const v = this.speedMps * (k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1) * dtS;
    if (fwd || right || up) {
      const h = this.headingDeg * DEG;
      const p = this.pitchDeg * DEG;
      // Heading convention: dir = (sin h, 0, -cos h); forward follows the pitch too.
      const fx = Math.sin(h) * Math.cos(p);
      const fy = Math.sin(p);
      const fz = -Math.cos(h) * Math.cos(p);
      const rx = Math.cos(h);
      const rz = Math.sin(h);
      const pos = this.camera.position;
      pos.x += (fx * fwd + rx * right) * v;
      pos.y += (fy * fwd + up) * v;
      pos.z += (fz * fwd + rz * right) * v;
    }
    this.apply();
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }

  private apply(): void {
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitchDeg * DEG, -this.headingDeg * DEG, 0);
  }
}
