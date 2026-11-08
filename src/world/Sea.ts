import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2, type Vector3 } from 'three';
import type { TerrainBounds } from '../types/terrain';
import { ATMOSPHERE_GLSL, WATER_GLSL } from './atmosphereGlsl';
import type { WorldUniforms } from './WorldUniforms';

/** Half-size of the sea plane; inside the sky dome. */
export const SEA_HALF_SIZE_M = 35_000;
/**
 * Open-sea colour: Stage 1 fills open water with the aerial mosaic's median sea colour
 * (48, 102, 101), graded 25 % toward (41, 97, 148); this is that result so the plane meets the
 * terrain's sea without a visible edge.
 */
export const OPEN_SEA_SRGB = 0x2e6474;

const vertex = /* glsl */ `
varying vec3 vWorld;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorld = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
${ATMOSPHERE_GLSL}
${WATER_GLSL}
uniform vec2 uBoundsMin;
uniform vec2 uBoundsMax;
uniform vec3 uSeaColor;
varying vec3 vWorld;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  // Inside the data the terrain draws its own sea; no overlap means no z-fighting.
  if (all(greaterThan(vWorld.xz, uBoundsMin)) && all(lessThan(vWorld.xz, uBoundsMax))) discard;
  vec3 c = waterShade(uSeaColor, vWorld);
  gl_FragColor = vec4(applyFog(c, vWorld), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** The Atlantic (and False Bay haze) beyond the terrain data, out to the fogged horizon. */
export class Sea {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor(uniforms: WorldUniforms, bounds: TerrainBounds) {
    this.material = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        ...uniforms,
        uBoundsMin: { value: new Vector2(bounds.minX, bounds.minZ) },
        uBoundsMax: { value: new Vector2(bounds.maxX, bounds.maxZ) },
        uSeaColor: { value: new Color().setHex(OPEN_SEA_SRGB) },
      },
    });
    const geom = new PlaneGeometry(SEA_HALF_SIZE_M * 2, SEA_HALF_SIZE_M * 2, 8, 8);
    geom.rotateX(-Math.PI / 2);
    this.mesh = new Mesh(geom, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'sea';
  }

  /** Follows the camera in 1 km steps so the ripple pattern does not swim. */
  update(cameraPosition: Vector3): void {
    this.mesh.position.set(Math.round(cameraPosition.x / 1000) * 1000, 0, Math.round(cameraPosition.z / 1000) * 1000);
  }

  dispose(): void {
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
