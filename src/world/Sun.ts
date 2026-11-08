import { Color, DirectionalLight, Object3D, Vector3 } from 'three';
import type { SunParams } from './WorldSettings';
import type { WorldUniforms } from './WorldUniforms';

const DEG = Math.PI / 180;

/**
 * Direction, colour and a Three.js DirectionalLight for the sun. Azimuth follows the project's
 * heading convention (clockwise from north, north is -Z): dir = (cos e sin h, sin e, -cos e cos h).
 * Colour and the sky/ground ambient terms derive from elevation, so `set({ elevationDeg })` is a
 * usable time-of-day control for Stage 5.
 */
export class Sun {
  /** Unit vector toward the sun. */
  readonly direction = new Vector3();
  readonly colour = new Color();
  /** Kept in sync for future lit objects and for the optional shadow map. */
  readonly light: DirectionalLight;
  private current: SunParams;

  constructor(
    private readonly uniforms: WorldUniforms,
    params: SunParams,
  ) {
    this.current = { ...params };
    this.light = new DirectionalLight(0xffffff, 1);
    this.light.target = new Object3D();
    this.apply();
  }

  get params(): Readonly<SunParams> {
    return this.current;
  }

  set(patch: Partial<SunParams>): void {
    this.current = { ...this.current, ...patch };
    this.apply();
  }

  private apply(): void {
    const { azimuthDeg, elevationDeg, intensity } = this.current;
    const h = azimuthDeg * DEG;
    const e = elevationDeg * DEG;
    this.direction.set(Math.cos(e) * Math.sin(h), Math.sin(e), -Math.cos(e) * Math.cos(h)).normalize();
    sunColourForElevation(elevationDeg, this.colour).multiplyScalar(intensity);
    const u = this.uniforms;
    u.uSunDir.value.copy(this.direction);
    u.uSunColor.value.copy(this.colour);
    // Ambient: blue sky from above, warm bounce from below; both dim as the sun sets.
    const day = smoothstep(-4, 25, elevationDeg);
    u.uSkyAmbient.value.setRGB(0.26, 0.33, 0.46).multiplyScalar(0.55 + 0.45 * day);
    u.uGroundAmbient.value.setRGB(0.2, 0.15, 0.1).multiplyScalar(0.5 + 0.5 * day);
    this.light.color.copy(this.colour);
    this.light.intensity = 1;
  }
}

/**
 * Linear-light sun colour: near white high up, golden at 15 degrees, deep orange at the horizon.
 * The 15 degree value is the look-spec golden hour; the ramp is hand-tuned, not physical.
 */
export function sunColourForElevation(elevationDeg: number, out = new Color()): Color {
  const t = smoothstep(2, 40, elevationDeg);
  const r = 1.0;
  const g = 0.45 + 0.5 * t;
  const b = 0.2 + 0.7 * t;
  const strength = 2.6 * smoothstep(-2, 8, elevationDeg);
  return out.setRGB(r * strength, g * strength, b * strength);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}
