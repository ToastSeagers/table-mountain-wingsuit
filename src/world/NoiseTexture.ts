import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
} from 'three';

/**
 * Procedural, tileable noise textures generated at startup, so the detail blend, water ripples
 * and clouds need no external assets (nothing to license, nothing to download).
 */

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable fbm value noise in 0..1, size x size, starting at `baseFreq` lattice cells. */
export function tileableFbm(size: number, baseFreq: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  const rand = mulberry32(seed);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const f = baseFreq << o;
    const lattice = new Float32Array(f * f);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * f;
      const y0 = Math.floor(fy);
      const ty = smooth(fy - y0);
      const r0 = (y0 % f) * f;
      const r1 = ((y0 + 1) % f) * f;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * f;
        const x0 = Math.floor(fx);
        const tx = smooth(fx - x0);
        const c0 = x0 % f;
        const c1 = (x0 + 1) % f;
        const a = lattice[r0 + c0] + (lattice[r0 + c1] - lattice[r0 + c0]) * tx;
        const b = lattice[r1 + c0] + (lattice[r1 + c1] - lattice[r1 + c0]) * tx;
        out[y * size + x] += (a + (b - a) * ty) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/**
 * RGBA8 detail texture: R,G = slope of noise A (0.5 = flat) for detail normals and water ripples,
 * B = noise A, A = noise B (independent).
 */
export function detailTextureData(size = 256, seed = 1234): Uint8Array {
  const a = tileableFbm(size, 8, 5, seed);
  const b = tileableFbm(size, 4, 5, seed + 1);
  const out = new Uint8Array(size * size * 4);
  const gain = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = a[y * size + ((x + 1) % size)] - a[y * size + ((x - 1 + size) % size)];
      const dy = a[((y + 1) % size) * size + x] - a[((y - 1 + size) % size) * size + x];
      out[i * 4] = toByte(0.5 + dx * gain);
      out[i * 4 + 1] = toByte(0.5 + dy * gain);
      out[i * 4 + 2] = toByte(a[i]);
      out[i * 4 + 3] = toByte(b[i]);
    }
  }
  return out;
}

export function makeDataTexture(data: Uint8Array, size: number): DataTexture {
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Cloud density texture for the sky: R = broad fbm, G = fine fbm. */
export function cloudTextureData(size = 512, seed = 777): Uint8Array {
  const a = tileableFbm(size, 4, 6, seed);
  const b = tileableFbm(size, 16, 4, seed + 1);
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = toByte(a[i]);
    out[i * 4 + 1] = toByte(b[i]);
    out[i * 4 + 2] = 0;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function toByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}
