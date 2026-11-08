/**
 * GLSL shared by the terrain, sea and sky so all three agree on fog, sky colour and water. Every
 * uniform named here lives in one WorldUniforms object (see WorldUniforms.ts) that the materials
 * reference, so changing a Fog/Sun/Sky parameter updates everything at once.
 */

export const ATMOSPHERE_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmbient;
uniform vec3 uGroundAmbient;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform float uFogBase;
uniform float uHaze;
uniform float uFogSunExp;
uniform float uFogMax;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform float uTime;

// Fog colour seen along a direction: warm toward the sun, grey-blue elsewhere.
vec3 fogColorFor(vec3 rd) {
  float s = pow(max(dot(rd, uSunDir), 0.0), uFogSunExp);
  return mix(uFogColor, uFogSunColor, s);
}

// Exponential height fog integrated analytically along the ray, plus a uniform distance haze.
float fogAmount(vec3 ro, vec3 rd, float dist) {
  float b = uFogFalloff;
  float a = uFogDensity * exp(-b * (ro.y - uFogBase));
  float k = rd.y * b;
  float od = abs(k) > 1e-6 ? a * (1.0 - exp(-dist * k)) / k : a * dist;
  od += uHaze * dist;
  return min(1.0 - exp(-od), uFogMax);
}

vec3 applyFog(vec3 col, vec3 worldPos) {
  vec3 d = worldPos - cameraPosition;
  float dist = length(d);
  vec3 rd = d / max(dist, 1e-3);
  return mix(col, fogColorFor(rd), fogAmount(cameraPosition, rd, dist));
}

// Sky without the sun disc and clouds: used for water reflections and by the dome.
vec3 skyColor(vec3 rd) {
  float t = clamp(rd.y, 0.0, 1.0);
  vec3 horizon = mix(uSkyHorizon, fogColorFor(rd), 0.6);
  vec3 c = mix(horizon, uSkyZenith, pow(smoothstep(0.0, 0.6, t), 0.6));
  // Warm band low over the sun's side.
  float sunSide = pow(max(dot(normalize(vec3(rd.x, 0.0, rd.z) + 1e-5), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 3.0);
  c += uFogSunColor * sunSide * (1.0 - smoothstep(0.0, 0.25, t)) * 0.35;
  return rd.y < 0.0 ? fogColorFor(rd) : c;
}
`;

/** Water shading shared by the terrain's sea cells and the sea plane outside the data. */
export const WATER_GLSL = /* glsl */ `
uniform sampler2D uDetail;

vec3 waterShade(vec3 bodyColor, vec3 worldPos) {
  vec2 p = worldPos.xz;
  vec2 g1 = texture(uDetail, p / 61.0 + vec2(uTime * 0.0040, uTime * 0.0021)).rg - 0.5;
  vec2 g2 = texture(uDetail, p / 19.0 - vec2(uTime * 0.0063, -uTime * 0.0031)).rg - 0.5;
  vec2 g = g1 + g2 * 0.6;
  vec3 n = normalize(vec3(g.x * 0.22, 1.0, g.y * 0.22));
  vec3 v = normalize(cameraPosition - worldPos);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  r.y = abs(r.y);
  vec3 refl = skyColor(r);
  vec3 hv = normalize(v + uSunDir);
  float nh = max(dot(n, hv), 0.0);
  float spec = pow(nh, 900.0) * 40.0 + pow(nh, 80.0) * 0.25;
  vec3 body = bodyColor * (uSkyAmbient * 0.9 + uSunColor * max(uSunDir.y, 0.0) * 0.5);
  return mix(body, refl, fres * 0.85) + uSunColor * spec;
}
`;
