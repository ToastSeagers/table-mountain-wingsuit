import { Color, DoubleSide, ShaderMaterial, Vector3, type IUniform } from 'three';

/** The world's lighting uniforms the avatar shares (src/world/WorldUniforms.ts). */
export interface AvatarLighting {
  uSunDir: IUniform<Vector3>;
  uSunColor: IUniform<Color>;
  uSkyAmbient: IUniform<Color>;
  uGroundAmbient: IUniform<Color>;
}

export interface AvatarMaterialOptions {
  /** Light passing through the fabric from the far side, 0 opaque .. 1 fully translucent. */
  translucency?: number;
  opacity?: number;
  /** Per-vertex colours (the canopy's cells and stripes) multiply the base colour. */
  vertexColors?: boolean;
  /** Rib darkening from the canopy's cell coordinate in uv.x (0 at a rib, 1 mid-cell). */
  ribs?: boolean;
}

const VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vCol;
varying vec2 vUv;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  #ifdef USE_COLOR
  vCol = color;
  #else
  vCol = vec3(1.0);
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The same light as the terrain (hemisphere ambient plus a wrapped sun, same scale) so the
// pilot sits in the scene, with a translucent term so a canopy lit from behind glows instead
// of reading as a dark slab (playtest note 5). Back faces take the flipped normal.
const FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmbient;
uniform vec3 uGroundAmbient;
uniform vec3 uColor;
uniform float uTranslucency;
uniform float uOpacity;
uniform float uRibs;
varying vec3 vN;
varying vec3 vCol;
varying vec2 vUv;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float ndl = dot(n, uSunDir);
  float sunTerm = clamp((ndl + 0.25) / 1.25, 0.0, 1.0);
  float through = clamp(-ndl, 0.0, 1.0) * uTranslucency;
  vec3 amb = mix(uGroundAmbient, uSkyAmbient, 0.5 + 0.5 * n.y);
  vec3 albedo = uColor * vCol;
  vec3 col = albedo * (amb * 1.5 + uSunColor * (sunTerm * 0.95 + through * 0.75));
  // Ribs: a soft dark seam at each cell boundary and a lighter crown mid-cell.
  float cell = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float seam = 1.0 - smoothstep(0.0, 0.22, cell);
  col *= 1.0 - uRibs * (0.35 * seam - 0.06 * cell);
  gl_FragColor = vec4(col, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Lit, optionally translucent material for the pilot and canopy, sharing the world's sun. */
export class AvatarMaterial extends ShaderMaterial {
  constructor(lighting: AvatarLighting, colour: number, opts: AvatarMaterialOptions = {}) {
    const opacity = opts.opacity ?? 1;
    super({
      uniforms: {
        uSunDir: lighting.uSunDir,
        uSunColor: lighting.uSunColor,
        uSkyAmbient: lighting.uSkyAmbient,
        uGroundAmbient: lighting.uGroundAmbient,
        uColor: { value: new Color(colour) },
        uTranslucency: { value: opts.translucency ?? 0 },
        uOpacity: { value: opacity },
        uRibs: { value: opts.ribs ? 1 : 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: DoubleSide,
      vertexColors: opts.vertexColors ?? false,
      transparent: opacity < 1,
      depthWrite: true,
    });
  }

  setOpacity(opacity: number): void {
    this.uniforms.uOpacity.value = opacity;
    this.transparent = opacity < 0.999;
  }
}

/** Placeholder lighting for tests or before the world exists: sun overhead, neutral ambient. */
export function fallbackLighting(): AvatarLighting {
  return {
    uSunDir: { value: new Vector3(0.35, 0.75, -0.55).normalize() },
    uSunColor: { value: new Color(2.4, 1.9, 1.3) },
    uSkyAmbient: { value: new Color(0.3, 0.38, 0.5) },
    uGroundAmbient: { value: new Color(0.22, 0.17, 0.12) },
  };
}
