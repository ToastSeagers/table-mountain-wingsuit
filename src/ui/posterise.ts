/** The chrome palette plus darker shades of its colours, so a map keeps some depth. */
export const POSTER_PALETTE: readonly (readonly [number, number, number])[] = [
  [0x1b, 0x12, 0x30], // ink
  [0x2a, 0x3d, 0x66], // deep sea
  [0x3f, 0xb8, 0xc9], // sea
  [0x7f, 0xb0, 0x69], // fynbos
  [0x3f, 0x66, 0x4a], // dark fynbos
  [0xff, 0xb3, 0x47], // sun
  [0xb0, 0x6a, 0x4a], // rock
  [0xf4, 0xe9, 0xd2], // paper
  [0x8b, 0x7f, 0x8f], // grey rock
];

/** Nearest palette index for an RGB colour. */
export function nearestPalette(r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < POSTER_PALETTE.length; i++) {
    const [pr, pg, pb] = POSTER_PALETTE[i];
    // Weighted RGB distance (eyes are most sensitive to green).
    const d = 2 * (r - pr) ** 2 + 4 * (g - pg) ** 2 + 3 * (b - pb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Flattens a canvas to the palette in place. Hard pixels, no dithering: the 1987 map look. */
export function posterise(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b] = POSTER_PALETTE[nearestPalette(d[i], d[i + 1], d[i + 2])];
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
