import {
  BufferGeometry,
  DepthFormat,
  DepthTexture,
  Float32BufferAttribute,
  FloatType,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  RGBAFormat,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import type { QualityPreset } from '../core/Settings';

/**
 * Which post passes run. `bloom` and `shafts` are the expensive ones; the rest are a few ALU
 * ops in the one composite shader. The report's per-effect numbers come from toggling these.
 */
export interface PostEffects {
  tonemap: boolean;
  grade: boolean;
  bloom: boolean;
  shafts: boolean;
  aberration: boolean;
  vignette: boolean;
  grain: boolean;
}

export interface PostPreset {
  /** MSAA samples on the HDR scene target. */
  msaa: number;
  /** Bloom mip levels (0 = off). */
  bloomLevels: number;
  /** Radial samples for sun shafts (0 = off). */
  shaftSamples: number;
  aberration: boolean;
  /** Passes this preset forces off regardless of the toggles (the mobile preset keeps tonemap, grade and vignette only). */
  off?: readonly (keyof PostEffects)[];
}

export const POST_PRESETS: Record<QualityPreset, PostPreset> = {
  low: { msaa: 2, bloomLevels: 0, shaftSamples: 0, aberration: false },
  medium: { msaa: 4, bloomLevels: 3, shaftSamples: 10, aberration: true },
  high: { msaa: 4, bloomLevels: 5, shaftSamples: 20, aberration: true },
  // Stage 7: no bloom mips, shafts, aberration or grain; 2x MSAA is cheap on tile-based GPUs.
  mobile: { msaa: 2, bloomLevels: 0, shaftSamples: 0, aberration: false, off: ['bloom', 'shafts', 'aberration', 'grain'] },
};

/** Per-frame inputs from the game. */
export interface PostParams {
  airspeedMps: number;
  /** World-space direction toward the sun (unit). */
  sunDir: Vector3;
  /** VHS replay look (scanlines, tracking noise, colour bleed). */
  vhs: boolean;
  timeS: number;
  /** prefers-reduced-motion: freezes the grain pattern. */
  reducedMotion: boolean;
}

// Look spec section 4.
export const GRAIN = 0.035;
export const VIGNETTE = 0.3;
/** Bloom only catches things brighter than this in scene-linear units: the sun disc (about 12) and sea glints, not sand or sky. */
export const BLOOM_THRESHOLD = 5;
export const BLOOM_STRENGTH = 0.55;
export const SHAFT_STRENGTH = 0.09;
/** Chromatic aberration starts at 55 m/s (look spec) and reaches full at 80 m/s. */
export const CA_START_MPS = 55;
export const CA_FULL_MPS = 80;
export const CA_MAX_UV = 0.0035;

const MAX_LEVELS = 5;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  float peak = max(c.r, max(c.g, c.b));
  float k = clamp((peak - uThreshold) / max(peak, 1e-4), 0.0, 1.0);
  gl_FragColor = vec4(c * k, 1.0);
}`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom0;
uniform sampler2D tBloom1;
uniform sampler2D tBloom2;
uniform sampler2D tBloom3;
uniform sampler2D tBloom4;
uniform float uBloomW[5];
uniform float uBloomStrength;
uniform vec2 uSunUv;
uniform float uShaft;
uniform float uCa;
uniform float uVig;
uniform float uGrain;
uniform float uTime;
uniform float uVhs;
uniform float uGrade;
uniform float uTonemap;
uniform vec2 uRes;
varying vec2 vUv;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 srgbEncode(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 uv = vUv;
  vec2 fromC = uv - 0.5;

  // VHS: horizontal wobble and a tracking band that drifts up the frame.
  if (uVhs > 0.0) {
    float band = fract(uTime * 0.07);
    float d = abs(uv.y - band);
    float tracking = 1.0 - smoothstep(0.0, 0.05, d);
    uv.x += uVhs * (0.0009 * sin(uv.y * 380.0 + uTime * 3.0) + 0.012 * tracking * (hash(vec2(floor(uv.y * 240.0), floor(uTime * 24.0))) - 0.5));
  }

  // Chromatic aberration: red and blue pushed apart radially, stronger at the edges.
  vec3 col;
  if (uCa > 0.0) {
    vec2 off = fromC * uCa * (0.4 + dot(fromC, fromC) * 3.0);
    col = vec3(texture2D(tScene, uv + off).r, texture2D(tScene, uv).g, texture2D(tScene, uv - off).b);
  } else {
    col = texture2D(tScene, uv).rgb;
  }

  // Bloom (already thresholded to the sun and glints) and sun shafts.
  vec3 glow = vec3(0.0);
  glow += texture2D(tBloom0, uv).rgb * uBloomW[0];
  glow += texture2D(tBloom1, uv).rgb * uBloomW[1];
  glow += texture2D(tBloom2, uv).rgb * uBloomW[2];
  glow += texture2D(tBloom3, uv).rgb * uBloomW[3];
  glow += texture2D(tBloom4, uv).rgb * uBloomW[4];
  col += glow * uBloomStrength;

  #ifdef SHAFTS
  if (uShaft > 0.0) {
    vec2 dir = (uSunUv - uv) / float(SHAFTS);
    vec2 p = uv;
    float decay = 1.0;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < SHAFTS; i++) {
      p += dir * 0.45;
      acc += texture2D(tBloom0, p).rgb * decay;
      decay *= 0.9;
    }
    col += acc / float(SHAFTS) * uShaft;
  }
  #endif

  // Tonemap with the same ACES as the world was tuned against, then the warm grade.
  if (uTonemap > 0.5) col = ACESFilmicToneMapping(col);
  else col = clamp(col * toneMappingExposure, 0.0, 1.0);

  if (uGrade > 0.0) {
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    // Lift the shadows a touch, warm the mids toward orange, keep highlights clean.
    col = col * 0.98 + 0.012;
    float mid = 1.0 - abs(l * 2.0 - 1.0);
    col *= mix(vec3(1.0), vec3(1.07, 1.0, 0.9), mid * uGrade);
    col = mix(col, col * vec3(0.96, 0.99, 1.06), (1.0 - smoothstep(0.0, 0.25, l)) * uGrade);
    col = mix(vec3(l), col, 1.0 + 0.06 * uGrade);
    col = clamp(col, 0.0, 1.0);
  }

  col = srgbEncode(col);

  if (uVhs > 0.0) {
    float scan = 0.5 + 0.5 * sin(vUv.y * uRes.y * 3.14159 * 0.5);
    col *= 1.0 - 0.14 * uVhs * scan;
    float l2 = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(l2) * vec3(1.02, 1.0, 0.94), 0.18 * uVhs);
    float tracking = 1.0 - smoothstep(0.0, 0.03, abs(vUv.y - fract(uTime * 0.07)));
    col += tracking * uVhs * 0.06 * hash(vUv * uRes + uTime);
  }

  if (uVig > 0.0) {
    float r = length(fromC * vec2(1.0, 0.85)) * 1.45;
    col *= 1.0 - uVig * smoothstep(0.45, 1.25, r) ;
  }

  if (uGrain > 0.0) {
    float n = hash(floor(vUv * uRes) + fract(uTime * 7.31) * 113.0) - 0.5;
    float l3 = dot(col, vec3(0.299, 0.587, 0.114));
    col += n * uGrain * (1.15 - l3);
  }

  gl_FragColor = vec4(col, 1.0);
}`;

function fullScreenTriangle(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return g;
}

/**
 * Own post pipeline instead of Three's EffectComposer or the `postprocessing` package:
 * the world renders with a reversed-Z float depth buffer, a custom ACES setup and terrain
 * materials that must not be re-tone-mapped, and we need exactly four passes (scene to HDR,
 * bright + mip chain, composite). A hand-rolled path keeps one fullscreen triangle, one big
 * composite shader we can toggle effect by effect, and no new dependency.
 *
 * Flow: scene -> RGBA16F target (MSAA) -> thresholded half-res bright pass -> down-sampled mips
 * -> composite (CA, bloom, sun shafts, ACES, warm grade, sRGB, VHS, vignette, grain) to screen.
 */
export class PostStack {
  readonly effects: PostEffects = {
    tonemap: true,
    grade: true,
    bloom: true,
    shafts: true,
    aberration: true,
    vignette: true,
    grain: true,
  };
  enabled = true;
  private preset: PostPreset = POST_PRESETS.medium;
  private presetName: QualityPreset = 'medium';
  private sceneRT: WebGLRenderTarget | null = null;
  private mips: WebGLRenderTarget[] = [];
  private w = 0;
  private h = 0;
  private readonly quad: Mesh;
  private readonly cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly bright: ShaderMaterial;
  private readonly down: ShaderMaterial;
  private composite: ShaderMaterial;
  private readonly sunV = new Vector3();
  private readonly size = new Vector2();

  constructor(private readonly renderer: WebGLRenderer) {
    this.quad = new Mesh(fullScreenTriangle());
    this.quad.frustumCulled = false;
    this.bright = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BRIGHT_FRAG,
      uniforms: { tScene: { value: null }, uThreshold: { value: BLOOM_THRESHOLD } },
      depthTest: false,
      depthWrite: false,
    });
    this.down = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: DOWN_FRAG,
      uniforms: { tSrc: { value: null }, uTexel: { value: new Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    this.composite = this.makeComposite();
  }

  get quality(): QualityPreset {
    return this.presetName;
  }

  setPreset(name: QualityPreset): void {
    if (name === this.presetName && this.sceneRT) return;
    this.presetName = name;
    this.preset = POST_PRESETS[name];
    this.composite.dispose();
    this.composite = this.makeComposite();
    this.disposeTargets();
  }

  private makeComposite(): ShaderMaterial {
    const p = this.preset;
    const u: Record<string, { value: unknown }> = {
      tScene: { value: null },
      uBloomW: { value: [1, 0, 0, 0, 0] },
      uBloomStrength: { value: BLOOM_STRENGTH },
      uSunUv: { value: new Vector2(0.5, 0.5) },
      uShaft: { value: 0 },
      uCa: { value: 0 },
      uVig: { value: VIGNETTE },
      uGrain: { value: GRAIN },
      uTime: { value: 0 },
      uVhs: { value: 0 },
      uGrade: { value: 1 },
      uTonemap: { value: 1 },
      uRes: { value: new Vector2(1, 1) },
    };
    for (let i = 0; i < MAX_LEVELS; i++) u[`tBloom${i}`] = { value: null };
    return new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: u,
      defines: p.shaftSamples > 0 ? { SHAFTS: p.shaftSamples } : {},
      depthTest: false,
      depthWrite: false,
    });
  }

  private allocate(w: number, h: number): void {
    this.disposeTargets();
    this.w = w;
    this.h = h;
    const depth = new DepthTexture(w, h);
    // Float depth keeps the reversed-Z precision the world relies on (1 m to 80 km).
    depth.type = FloatType;
    depth.format = DepthFormat;
    this.sceneRT = new WebGLRenderTarget(w, h, {
      type: HalfFloatType,
      format: RGBAFormat,
      samples: this.preset.msaa,
      depthBuffer: true,
      depthTexture: depth,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    });
    for (let i = 0; i < this.preset.bloomLevels; i++) {
      const s = 2 ** (i + 1);
      this.mips.push(
        new WebGLRenderTarget(Math.max(1, Math.floor(w / s)), Math.max(1, Math.floor(h / s)), {
          type: HalfFloatType,
          format: RGBAFormat,
          depthBuffer: false,
          minFilter: LinearFilter,
          magFilter: LinearFilter,
        }),
      );
    }
  }

  private disposeTargets(): void {
    this.sceneRT?.dispose();
    this.sceneRT?.depthTexture?.dispose();
    this.sceneRT = null;
    for (const m of this.mips) m.dispose();
    this.mips = [];
    this.w = 0;
  }

  private blit(mat: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quad, this.cam);
  }

  /** Renders `scene` through the stack to the screen. */
  render(scene: Scene, camera: Camera, p: PostParams): void {
    const r = this.renderer;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    r.getDrawingBufferSize(this.size);
    const w = this.size.x;
    const h = this.size.y;
    if (!this.sceneRT || w !== this.w || h !== this.h) this.allocate(w, h);
    const rt = this.sceneRT as WebGLRenderTarget;
    const fx = this.activeEffects();

    // Three skips tone mapping and colour-space encoding on render targets, so the target holds
    // scene-linear HDR and the composite does both.
    r.setRenderTarget(rt);
    r.clear();
    r.render(scene, camera);

    const levels = fx.bloom || fx.shafts ? this.mips.length : 0;
    if (levels > 0) {
      this.bright.uniforms.tScene.value = rt.texture;
      this.blit(this.bright, this.mips[0]);
      for (let i = 1; i < levels; i++) {
        const src = this.mips[i - 1];
        this.down.uniforms.tSrc.value = src.texture;
        (this.down.uniforms.uTexel.value as Vector2).set(1 / src.width, 1 / src.height);
        this.blit(this.down, this.mips[i]);
      }
    }

    const u = this.composite.uniforms;
    u.tScene.value = rt.texture;
    const weights = [0, 0, 0, 0, 0];
    if (fx.bloom && levels > 0)
      for (let i = 0; i < levels; i++) weights[i] = 1 / levels + (i === 0 ? 0 : 0.05 * i);
    u.uBloomW.value = weights;
    for (let i = 0; i < MAX_LEVELS; i++)
      u[`tBloom${i}`].value = (this.mips[Math.min(i, levels - 1)] ?? this.mips[0] ?? rt).texture;
    u.uBloomStrength.value = BLOOM_STRENGTH;
    // Sun shafts: project the sun direction to the screen; fade out when it is behind the view.
    this.sunV.copy(camera.position).addScaledVector(p.sunDir, 10_000).project(camera);
    const facing = p.sunDir.dot(camera.getWorldDirection(this.sunDirTmp));
    (u.uSunUv.value as Vector2).set(this.sunV.x * 0.5 + 0.5, this.sunV.y * 0.5 + 0.5);
    // Fade the shafts as the sun leaves the frame, so a distant glow never draws a beam from off-screen.
    const offScreen = Math.hypot(this.sunV.x, this.sunV.y);
    const onScreen = 1 - Math.max(0, Math.min(1, (offScreen - 0.9) / 0.8));
    u.uShaft.value =
      fx.shafts && this.preset.shaftSamples > 0 && levels > 0
        ? SHAFT_STRENGTH * onScreen * Math.max(0, Math.min(1, facing * 3))
        : 0;
    const caK = Math.max(
      0,
      Math.min(1, (p.airspeedMps - CA_START_MPS) / (CA_FULL_MPS - CA_START_MPS)),
    );
    u.uCa.value =
      fx.aberration && this.preset.aberration ? CA_MAX_UV * caK * caK * (3 - 2 * caK) : 0;
    u.uVig.value = fx.vignette ? VIGNETTE : 0;
    u.uGrain.value = fx.grain ? GRAIN : 0;
    u.uGrade.value = fx.grade ? 1 : 0;
    u.uTonemap.value = fx.tonemap ? 1 : 0;
    u.uVhs.value = p.vhs ? 1 : 0;
    u.uTime.value = p.reducedMotion ? 0.37 : p.timeS;
    (u.uRes.value as Vector2).set(w, h);
    this.blit(this.composite, null);
  }

  /** The toggles with the preset's forced-off passes applied. */
  private activeEffects(): PostEffects {
    const off = this.preset.off;
    if (!off) return this.effects;
    const fx = { ...this.effects };
    for (const k of off) fx[k] = false;
    return fx;
  }

  private readonly sunDirTmp = new Vector3();

  dispose(): void {
    this.disposeTargets();
    this.bright.dispose();
    this.down.dispose();
    this.composite.dispose();
    this.quad.geometry.dispose();
  }
}
