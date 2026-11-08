import {
  type IUniform,
  ShaderMaterial,
  type Texture,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector4,
} from 'three';
import { ATMOSPHERE_GLSL, WATER_GLSL } from '../atmosphereGlsl';
import type { WorldUniforms } from '../WorldUniforms';
import type { TerrainMeta } from './TerrainMeta';

const vertex = /* glsl */ `
varying vec3 vWorld;
#include <common>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorld = worldPosition.xyz;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <shadowmap_vertex>
}
`;

const fragment = /* glsl */ `
${ATMOSPHERE_GLSL}
${WATER_GLSL}
uniform sampler2D uHeight;
uniform vec2 uHeightSize;
uniform vec2 uBoundsMin;
uniform vec2 uBoundsSize;
uniform float uCell;
uniform sampler2D uOverview;
uniform sampler2D uTile0;
uniform sampler2D uTile1;
uniform sampler2D uTile2;
uniform sampler2D uTile3;
uniform vec4 uSlotBlend;
uniform vec2 uTileOrigin;
uniform vec2 uTileSpan;
uniform float uDetailK;
varying vec3 vWorld;

#include <common>
#include <packing>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
#include <logdepthbuf_pars_fragment>

float H(vec2 xz) {
  vec2 uv = ((xz - uBoundsMin) / uCell + 0.5) / uHeightSize;
  return texture(uHeight, uv).r;
}

vec3 tileSample(int slot, vec2 uv, vec2 dx, vec2 dy) {
  if (slot == 0) return textureGrad(uTile0, uv, dx, dy).rgb;
  if (slot == 1) return textureGrad(uTile1, uv, dx, dy).rgb;
  if (slot == 2) return textureGrad(uTile2, uv, dx, dy).rgb;
  return textureGrad(uTile3, uv, dx, dy).rgb;
}

void main() {
  #include <logdepthbuf_fragment>
  vec2 xz = vWorld.xz;

  // Per-pixel normal from the height grid (central differences, one cell either side).
  float e = uCell;
  float hc = H(xz);
  float hl = H(xz - vec2(e, 0.0));
  float hr = H(xz + vec2(e, 0.0));
  float hn = H(xz - vec2(0.0, e));
  float hs = H(xz + vec2(0.0, e));
  vec3 n = normalize(vec3(hl - hr, 2.0 * e, hn - hs));
  vec2 outside = max(max(uBoundsMin - xz, xz - (uBoundsMin + uBoundsSize)), 0.0);
  float outsideM = length(outside);
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), clamp(outsideM / 400.0, 0.0, 1.0)));
  float h = outsideM > 0.0 ? vWorld.y : hc;

  // Colour: overview everywhere, full-resolution tile where resident (cross-faded in).
  vec2 ovUv = clamp((xz - uBoundsMin) / uBoundsSize, 0.0, 1.0);
  vec3 albedo = texture(uOverview, ovUv).rgb;
  vec2 tuv = (xz - uTileOrigin) / uTileSpan;
  vec2 dx = dFdx(tuv);
  vec2 dy = dFdy(tuv);
  vec2 cellIdx = clamp(floor(tuv), 0.0, 1.0);
  int slot = int(cellIdx.x) + 2 * int(cellIdx.y);
  float blend = uSlotBlend[slot];
  if (blend > 0.0) {
    vec3 t = tileSample(slot, clamp(tuv - cellIdx, 0.0, 1.0), dx, dy);
    albedo = mix(albedo, t, blend);
  }

  // Detail blend (look spec section 4): rock on steep, fynbos on gentle high ground, sand by the sea.
  float slopeY = n.y;
  vec4 d1 = texture(uDetail, xz / 9.0);
  vec4 d2 = texture(uDetail, xz / 43.0);
  vec4 d3 = texture(uDetail, xz / 3.1);
  float rock = 1.0 - smoothstep(0.76, 0.88, slopeY);
  float fyn = smoothstep(0.90, 0.97, slopeY) * smoothstep(220.0, 330.0, h) * (1.0 - rock);
  float sand = smoothstep(0.08, 0.5, h) * (1.0 - smoothstep(4.0, 9.0, h)) * smoothstep(0.975, 0.995, slopeY);
  float water = (1.0 - smoothstep(0.03, 0.3, h)) * (1.0 - clamp(outsideM / 50.0, 0.0, 1.0));
  float k = uDetailK;
  // Tints are always on; they are grading, not detail.
  albedo = mix(albedo, albedo * vec3(0.84, 0.88, 0.97), rock * 0.55);
  albedo = mix(albedo, vec3(0.80, 0.69, 0.50) * (0.9 + 0.2 * d3.b), sand * 0.35);
  // Noise detail scales with camera height: strong on the deck, gone at the exit.
  float rn = (d1.b * 0.6 + d2.b * 0.4) - 0.5;
  albedo *= 1.0 + k * (rock * rn * 0.8 + sand * (d3.a - 0.5) * 0.25);
  albedo = mix(albedo, albedo * mix(vec3(0.82, 0.92, 0.66), vec3(1.0, 0.98, 0.92), d2.a) * (0.85 + 0.3 * d3.b), fyn * k * 0.6);
  vec2 g = (d1.rg - 0.5) * 2.0 + (d3.rg - 0.5);
  vec3 nd = normalize(n + vec3(g.x, 0.0, g.y) * (rock * 0.7 + fyn * 0.25) * k);

  // Light: sky hemisphere plus a softly wrapped sun (the midday aerial already carries shading).
  float shadow = 1.0;
  #ifdef USE_SHADOWMAP
  shadow = getShadowMask();
  #endif
  float ndl = dot(nd, uSunDir);
  float sunTerm = clamp((ndl + 0.2) / 1.2, 0.0, 1.0) * shadow;
  vec3 amb = mix(uGroundAmbient, uSkyAmbient, 0.5 + 0.5 * nd.y);
  vec3 col = albedo * (amb * 1.6 + uSunColor * sunTerm * 0.75);
  if (water > 0.0) col = mix(col, waterShade(albedo * 1.3, vWorld), water);

  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface TerrainSharedUniforms extends WorldUniforms {
  uHeight: IUniform<Texture | null>;
  uHeightSize: IUniform<Vector2>;
  uBoundsMin: IUniform<Vector2>;
  uBoundsSize: IUniform<Vector2>;
  uCell: IUniform<number>;
  uOverview: IUniform<Texture | null>;
  uTileSpan: IUniform<Vector2>;
  uDetailK: IUniform<number>;
}

export function createTerrainSharedUniforms(world: WorldUniforms, meta: TerrainMeta): TerrainSharedUniforms {
  return {
    // Light uniforms are needed for the optional shadow map; shared by reference.
    ...UniformsUtils.clone(UniformsLib.lights),
    ...world,
    uHeight: { value: null },
    uHeightSize: { value: new Vector2(meta.samplesX, meta.samplesZ) },
    uBoundsMin: { value: new Vector2(meta.bounds.minX, meta.bounds.minZ) },
    uBoundsSize: { value: new Vector2(meta.widthM, meta.depthM) },
    uCell: { value: meta.cellSizeM },
    uOverview: { value: null },
    uTileSpan: { value: new Vector2(meta.texSpanXM, meta.texSpanZM) },
    uDetailK: { value: 0 },
  } as TerrainSharedUniforms;
}

/** Per-chunk material: shared uniforms by reference plus its own four texture slots. */
export class TerrainMaterial extends ShaderMaterial {
  readonly slotBlend: Vector4;
  readonly tileOrigin: Vector2;

  constructor(shared: TerrainSharedUniforms, placeholder: Texture) {
    const slotBlend = new Vector4();
    const tileOrigin = new Vector2();
    super({
      vertexShader: vertex,
      fragmentShader: fragment,
      lights: true,
      uniforms: {
        ...shared,
        uTile0: { value: placeholder },
        uTile1: { value: placeholder },
        uTile2: { value: placeholder },
        uTile3: { value: placeholder },
        uSlotBlend: { value: slotBlend },
        uTileOrigin: { value: tileOrigin },
      },
    });
    this.slotBlend = slotBlend;
    this.tileOrigin = tileOrigin;
  }

  setSlot(slot: number, texture: Texture, blend: number): void {
    (this.uniforms[`uTile${slot}`] as IUniform<Texture>).value = texture;
    this.slotBlend.setComponent(slot, blend);
  }
}
