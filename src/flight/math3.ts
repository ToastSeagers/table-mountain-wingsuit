import type { Quat, Vec3 } from '../types/math';

// In-place vector and quaternion helpers for the 120 Hz hot path. Every function
// writes into `out` and returns it, so step() never allocates. Aliasing (out === a)
// is safe everywhere because inputs are read into locals first.

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

export function vset(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function vcopy(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

/** out = a + b * s */
export function vaddScaled(out: Vec3, a: Vec3, b: Vec3, s: number): Vec3 {
  out.x = a.x + b.x * s;
  out.y = a.y + b.y * s;
  out.z = a.z + b.z * s;
  return out;
}

export function vscale(out: Vec3, a: Vec3, s: number): Vec3 {
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return out;
}

export function vdot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vlen(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function vcross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

/** Normalises `a` into `out` and returns the original length (0 leaves out untouched). */
export function vnormalize(out: Vec3, a: Vec3): number {
  const len = vlen(a);
  if (len > 0) {
    const inv = 1 / len;
    out.x = a.x * inv;
    out.y = a.y * inv;
    out.z = a.z * inv;
  }
  return len;
}

export function qset(out: Quat, x: number, y: number, z: number, w: number): Quat {
  out.x = x;
  out.y = y;
  out.z = z;
  out.w = w;
  return out;
}

export function qcopy(out: Quat, a: Quat): Quat {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  out.w = a.w;
  return out;
}

export function qnormalize(out: Quat): Quat {
  const len = Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z + out.w * out.w);
  if (len > 0) {
    const inv = 1 / len;
    out.x *= inv;
    out.y *= inv;
    out.z *= inv;
    out.w *= inv;
  }
  return out;
}

export function qFromAxisAngle(
  out: Quat,
  ax: number,
  ay: number,
  az: number,
  angleRad: number,
): Quat {
  const h = angleRad * 0.5;
  const s = Math.sin(h);
  out.x = ax * s;
  out.y = ay * s;
  out.z = az * s;
  out.w = Math.cos(h);
  return out;
}

/** out = a * b (apply b first, then a). */
export function qmul(out: Quat, a: Quat, b: Quat): Quat {
  const ax = a.x;
  const ay = a.y;
  const az = a.z;
  const aw = a.w;
  const bx = b.x;
  const by = b.y;
  const bz = b.z;
  const bw = b.w;
  out.x = aw * bx + ax * bw + ay * bz - az * by;
  out.y = aw * by - ax * bz + ay * bw + az * bx;
  out.z = aw * bz + ax * by - ay * bx + az * bw;
  out.w = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** Rotates vector (vx, vy, vz) by q into out. */
export function qrotate(out: Vec3, q: Quat, vx: number, vy: number, vz: number): Vec3 {
  // v' = v + 2w (q x v) + 2 q x (q x v)
  const qx = q.x;
  const qy = q.y;
  const qz = q.z;
  const qw = q.w;
  const cx = qy * vz - qz * vy;
  const cy = qz * vx - qx * vz;
  const cz = qx * vy - qy * vx;
  const dx = qy * cz - qz * cy;
  const dy = qz * cx - qx * cz;
  const dz = qx * cy - qy * cx;
  out.x = vx + 2 * (qw * cx + dx);
  out.y = vy + 2 * (qw * cy + dy);
  out.z = vz + 2 * (qw * cz + dz);
  return out;
}

/**
 * Body basis in world space for the game's convention: forward = -Z, up = +Y, right = +X
 * at the identity orientation (level, heading 0 = north).
 */
export function qbasis(q: Quat, forward: Vec3, up: Vec3, right: Vec3): void {
  qrotate(forward, q, 0, 0, -1);
  qrotate(up, q, 0, 1, 0);
  qrotate(right, q, 1, 0, 0);
}

/**
 * Integrates a world-frame angular velocity (rad/s) over dt and renormalises:
 * q += 0.5 * (0, w) * q * dt.
 */
export function qintegrate(q: Quat, wx: number, wy: number, wz: number, dt: number): Quat {
  const hx = wx * 0.5 * dt;
  const hy = wy * 0.5 * dt;
  const hz = wz * 0.5 * dt;
  const qx = q.x;
  const qy = q.y;
  const qz = q.z;
  const qw = q.w;
  q.x += hx * qw + hy * qz - hz * qy;
  q.y += -hx * qz + hy * qw + hz * qx;
  q.z += hx * qy - hy * qx + hz * qw;
  q.w += -hx * qx - hy * qy - hz * qz;
  return qnormalize(q);
}

/**
 * Orientation from heading (deg clockwise from north), pitch (deg, nose up positive)
 * and bank (deg, right wing down positive). q = Ry(-heading) * Rx(pitch) * Rz(-bank).
 */
export function qFromHeadingPitchBank(
  out: Quat,
  tmp: Quat,
  headingDeg: number,
  pitchDeg: number,
  bankDeg: number,
): Quat {
  qFromAxisAngle(out, 0, 1, 0, -headingDeg * DEG_TO_RAD);
  qFromAxisAngle(tmp, 1, 0, 0, pitchDeg * DEG_TO_RAD);
  qmul(out, out, tmp);
  qFromAxisAngle(tmp, 0, 0, 1, -bankDeg * DEG_TO_RAD);
  qmul(out, out, tmp);
  return out;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite smoothstep of x between edge0 and edge1 (edges may be descending). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Heading in degrees clockwise from north of a horizontal direction (x east, z south). */
export function headingDegOf(x: number, z: number): number {
  const h = Math.atan2(x, -z) * RAD_TO_DEG;
  return h < 0 ? h + 360 : h;
}
