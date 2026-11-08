import { BackSide, type DataTexture, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { ATMOSPHERE_GLSL } from './atmosphereGlsl';
import { cloudTextureData, makeDataTexture } from './NoiseTexture';
import type { SkyParams } from './WorldSettings';
import type { WorldUniforms } from './WorldUniforms';

/** Dome radius: inside the camera far plane (80 km), outside the sea plane (35 km). */
export const SKY_RADIUS_M = 60_000;

const vertex = /* glsl */ `
varying vec3 vDir;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vDir = position;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
${ATMOSPHERE_GLSL}
uniform sampler2D uClouds;
uniform float uCloudCover;
uniform float uSunDiscCos;
varying vec3 vDir;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec3 rd = normalize(vDir);
  vec3 c = skyColor(rd);
  float mu = dot(rd, uSunDir);
  // Sun glow and disc (HDR; tone mapping rolls it off).
  c += uFogSunColor * (pow(max(mu, 0.0), 12.0) * 0.25 + pow(max(mu, 0.0), 300.0) * 0.8);
  float disc = smoothstep(uSunDiscCos - 0.00002, uSunDiscCos + 0.00002, mu);
  c += uSunColor * disc * 12.0 * smoothstep(-0.01, 0.01, rd.y);
  // A few stationary high clouds, projected on a plane far above.
  if (rd.y > 0.0) {
    vec2 p = rd.xz / (rd.y + 0.06) * 0.18 + vec2(0.31, 0.17);
    vec4 n = texture(uClouds, p);
    float d = n.r * 0.8 + n.g * 0.2;
    float cover = smoothstep(1.0 - uCloudCover * 0.75, 1.05 - uCloudCover * 0.35, d);
    cover *= smoothstep(0.02, 0.18, rd.y) * smoothstep(0.85, 0.5, rd.y);
    vec3 lit = mix(uSkyHorizon * 0.9, uSunColor * 0.55 + uFogSunColor * 0.3, 0.55 + 0.45 * pow(max(mu, 0.0), 4.0));
    c = mix(c, lit, cover * 0.75);
  }
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Gradient sky with a warm band toward the sun, a sun disc and a few stationary high clouds
 * (look spec section 4). Below the horizon it shows the fog colour, so the sea plane's fogged far
 * edge meets it without a seam. Follows the camera.
 */
export class Sky {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly clouds: DataTexture;
  private current: SkyParams;

  constructor(
    private readonly uniforms: WorldUniforms,
    params: SkyParams,
  ) {
    this.current = { ...params };
    this.clouds = makeDataTexture(cloudTextureData(), 512);
    this.material = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        ...uniforms,
        uClouds: { value: this.clouds },
        uCloudCover: { value: 0 },
        uSunDiscCos: { value: 1 },
      },
      side: BackSide,
      depthWrite: false,
    });
    this.mesh = new Mesh(new SphereGeometry(SKY_RADIUS_M, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    // Drawn after the opaque terrain so it only shades uncovered pixels.
    this.mesh.renderOrder = 10;
    this.mesh.name = 'sky';
    this.apply();
  }

  get params(): Readonly<SkyParams> {
    return this.current;
  }

  set(patch: Partial<SkyParams>): void {
    this.current = { ...this.current, ...patch };
    this.apply();
  }

  update(cameraPosition: Vector3): void {
    this.mesh.position.copy(cameraPosition);
  }

  dispose(): void {
    this.material.dispose();
    this.mesh.geometry.dispose();
    this.clouds.dispose();
  }

  private apply(): void {
    const u = this.uniforms;
    u.uSkyZenith.value.setHex(this.current.zenithColour);
    u.uSkyHorizon.value.setHex(this.current.horizonColour);
    this.material.uniforms.uCloudCover.value = this.current.cloudCover;
    this.material.uniforms.uSunDiscCos.value = Math.cos((this.current.sunDiscDeg * Math.PI) / 180);
  }
}

