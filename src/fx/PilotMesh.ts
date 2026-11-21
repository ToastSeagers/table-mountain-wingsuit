import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  Mesh,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { AvatarMaterial, type AvatarLighting } from './AvatarMaterial';
import type { PilotPose } from './avatarPose';

// Chrome palette (look spec section 2): a two-tone suit that reads against rock, fynbos and sand.
export const SUIT_MAIN = 0xffb347; // sun
export const SUIT_DARK = 0x1b1230; // ink
export const WING = 0xff5e5b; // coral
export const HELMET = 0xf4e9d2; // paper

/** Body frame while prone: head toward -Z, back toward +Y, right hand toward +X. Metres before the avatar scale. */
const SHOULDER = { x: 0.21, y: 0.03, z: -0.3 };
const HIP = { x: 0.1, y: 0, z: 0.4 };
const UPPER_ARM_M = 0.3;
const FOREARM_M = 0.27;
const THIGH_M = 0.42;
const SHIN_M = 0.4;
const ARM_NU = 8;
const ARM_NV = 3;
const LEG_NU = 6;
const LEG_NV = 4;

const Y_AXIS = new Vector3(0, 1, 0);

function v3(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y, z);
}

function gridGeometry(nu: number, nv: number): BufferGeometry {
  const g = new BufferGeometry();
  const count = (nu + 1) * (nv + 1);
  const pos = new Float32BufferAttribute(new Float32Array(count * 3), 3);
  pos.setUsage(DynamicDrawUsage);
  const uv = new Float32Array(count * 2);
  const idx: number[] = [];
  for (let j = 0; j <= nu; j++) {
    for (let k = 0; k <= nv; k++) {
      const i = j * (nv + 1) + k;
      uv[i * 2] = j / nu;
      uv[i * 2 + 1] = k / nv;
      if (j < nu && k < nv) {
        const a = i;
        const b = i + 1;
        const c = i + nv + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
  }
  g.setAttribute('position', pos);
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Point at fraction u along the polyline a -> b -> c, with b at fraction `mid`. */
function polyline(
  out: Vector3,
  a: Vector3,
  b: Vector3,
  c: Vector3,
  u: number,
  mid: number,
): Vector3 {
  if (u <= mid) return out.lerpVectors(a, b, u / mid);
  return out.lerpVectors(b, c, (u - mid) / (1 - mid));
}

/**
 * The pilot: helmet, torso, pelvis, two-segment arms and legs as scaled unit cylinders, and
 * three wing membranes (two arm wings, one leg wing) as small grids rebuilt from the joint
 * positions every frame, so the wings follow the arms wherever the pose puts them. About
 * 1,100 triangles. Pose comes from avatarPose.ts; this file only places meshes.
 */
export class PilotMesh {
  readonly group = new Group();
  readonly head = new Group();
  private readonly limbs: Mesh[] = [];
  private readonly torso: Mesh;
  private readonly pelvis: Mesh;
  private readonly armWingL: Mesh;
  private readonly armWingR: Mesh;
  private readonly legWing: Mesh;
  private readonly handL: Mesh;
  private readonly handR: Mesh;
  private readonly footL: Mesh;
  private readonly footR: Mesh;
  /** Joint positions in the body frame, refreshed by apply(). */
  readonly joints = {
    shoulderL: v3(-SHOULDER.x, SHOULDER.y, SHOULDER.z),
    shoulderR: v3(SHOULDER.x, SHOULDER.y, SHOULDER.z),
    elbowL: v3(0, 0, 0),
    elbowR: v3(0, 0, 0),
    handL: v3(0, 0, 0),
    handR: v3(0, 0, 0),
    hipL: v3(-HIP.x, HIP.y, HIP.z),
    hipR: v3(HIP.x, HIP.y, HIP.z),
    kneeL: v3(0, 0, 0),
    kneeR: v3(0, 0, 0),
    footL: v3(0, 0, 0),
    footR: v3(0, 0, 0),
  };
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly tmpC = new Vector3();
  private readonly tmpD = new Vector3();
  private readonly tmpE = new Vector3();
  private readonly q = new Quaternion();

  constructor(lighting: AvatarLighting) {
    const main = new AvatarMaterial(lighting, SUIT_MAIN);
    const dark = new AvatarMaterial(lighting, SUIT_DARK);
    const wing = new AvatarMaterial(lighting, WING, { translucency: 0.55 });
    const legWingMat = new AvatarMaterial(lighting, SUIT_MAIN, { translucency: 0.55 });
    const helmet = new AvatarMaterial(lighting, HELMET);

    this.torso = new Mesh(new SphereGeometry(1, 12, 8), main);
    this.torso.scale.set(0.2, 0.13, 0.36);
    this.torso.position.set(0, 0.0, 0.02);
    this.pelvis = new Mesh(new SphereGeometry(1, 10, 7), dark);
    this.pelvis.scale.set(0.17, 0.12, 0.17);
    this.pelvis.position.set(0, -0.005, 0.36);

    const skull = new Mesh(new SphereGeometry(0.135, 12, 9), helmet);
    const visor = new Mesh(new SphereGeometry(0.1, 10, 6), dark);
    visor.scale.set(1.0, 0.55, 0.8);
    visor.position.set(0, -0.03, -0.09);
    this.head.add(skull, visor);
    this.head.position.set(0, 0.08, -0.5);

    const limb = (radius: number, mat: AvatarMaterial): Mesh => {
      const m = new Mesh(new CylinderGeometry(radius, radius * 0.85, 1, 6, 1, false), mat);
      this.limbs.push(m);
      return m;
    };
    // Upper arms and thighs in the suit's main colour, forearms and shins dark: two-tone.
    const upperL = limb(0.055, main);
    const upperR = limb(0.055, main);
    const foreL = limb(0.045, dark);
    const foreR = limb(0.045, dark);
    const thighL = limb(0.07, main);
    const thighR = limb(0.07, main);
    const shinL = limb(0.055, dark);
    const shinR = limb(0.055, dark);
    this.handL = new Mesh(new BoxGeometry(0.07, 0.03, 0.11), dark);
    this.handR = new Mesh(new BoxGeometry(0.07, 0.03, 0.11), dark);
    this.footL = new Mesh(new BoxGeometry(0.07, 0.05, 0.14), dark);
    this.footR = new Mesh(new BoxGeometry(0.07, 0.05, 0.14), dark);

    this.armWingL = new Mesh(gridGeometry(ARM_NU, ARM_NV), wing);
    this.armWingR = new Mesh(gridGeometry(ARM_NU, ARM_NV), wing);
    this.legWing = new Mesh(gridGeometry(LEG_NU, LEG_NV), legWingMat);
    for (const m of [this.armWingL, this.armWingR, this.legWing]) m.frustumCulled = false;

    this.group.add(
      this.torso,
      this.pelvis,
      this.head,
      upperL,
      upperR,
      foreL,
      foreR,
      thighL,
      thighR,
      shinL,
      shinR,
      this.handL,
      this.handR,
      this.footL,
      this.footR,
      this.armWingL,
      this.armWingR,
      this.legWing,
    );
  }

  /** Triangles across every mesh, for the budget check. */
  triangleCount(): number {
    let n = 0;
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const g = m.geometry;
      n += g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
    });
    return n;
  }

  apply(pose: PilotPose): void {
    const j = this.joints;
    const hang = pose.hang;
    const dirL = this.tmpA;
    const dirR = this.tmpB;

    // Arms: prone they reach out and back with the wing dihedral; hanging they go up to the
    // toggles (armRaise 1) or down to the hips (0).
    for (const side of [-1, 1] as const) {
      const sweep = pose.armSweep;
      const dihedral = side < 0 ? pose.dihedralL : pose.dihedralR;
      const prone = this.tmpC.set(
        side * Math.cos(sweep) * Math.cos(dihedral),
        Math.sin(dihedral),
        Math.sin(sweep) * Math.cos(dihedral),
      );
      const up = this.tmpD.set(side * 0.22, 0.12, -0.96).normalize();
      const hung = this.tmpE
        .set(side * 0.3, -0.25, 0.9)
        .normalize()
        .lerp(up, pose.armRaise);
      const dir = (side < 0 ? dirL : dirR).copy(prone).lerp(hung, hang).normalize();
      const shoulder = side < 0 ? j.shoulderL : j.shoulderR;
      const elbow = side < 0 ? j.elbowL : j.elbowR;
      const hand = side < 0 ? j.handL : j.handR;
      elbow.copy(shoulder).addScaledVector(dir, UPPER_ARM_M);
      // The forearm continues with a little more sweep and a dip toward the belly (prone), or
      // bends inward toward the toggles (hanging).
      const fore = this.tmpC.copy(dir);
      fore.z += 0.18 * (1 - hang);
      fore.y -= 0.12 * (1 - hang);
      fore.x -= side * 0.35 * hang * pose.armRaise;
      fore.normalize();
      hand.copy(elbow).addScaledVector(fore, FOREARM_M);
    }
    // Legs: spread prone, hanging slightly forward with bent knees.
    for (const side of [-1, 1] as const) {
      const spread = pose.legSpread;
      const hip = side < 0 ? j.hipL : j.hipR;
      const knee = side < 0 ? j.kneeL : j.kneeR;
      const foot = side < 0 ? j.footL : j.footR;
      const thighDir = this.tmpC
        .set(side * Math.sin(spread), -0.12 * hang, Math.cos(spread))
        .normalize();
      knee.copy(hip).addScaledVector(thighDir, THIGH_M);
      const shinDir = this.tmpD
        .set(
          side * Math.sin(spread) * 0.6,
          -Math.sin(pose.kneeBend) * hang,
          Math.cos(spread) * Math.cos(pose.kneeBend * hang),
        )
        .normalize();
      foot.copy(knee).addScaledVector(shinDir, SHIN_M);
    }

    const l = this.limbs;
    this.placeLimb(l[0], j.shoulderL, j.elbowL);
    this.placeLimb(l[1], j.shoulderR, j.elbowR);
    this.placeLimb(l[2], j.elbowL, j.handL);
    this.placeLimb(l[3], j.elbowR, j.handR);
    this.placeLimb(l[4], j.hipL, j.kneeL);
    this.placeLimb(l[5], j.hipR, j.kneeR);
    this.placeLimb(l[6], j.kneeL, j.footL);
    this.placeLimb(l[7], j.kneeR, j.footR);
    this.handL.position.copy(j.handL);
    this.handR.position.copy(j.handR);
    this.footL.position.copy(j.footL);
    this.footR.position.copy(j.footR);
    this.handL.quaternion.copy(l[2].quaternion);
    this.handR.quaternion.copy(l[3].quaternion);
    this.footL.quaternion.copy(l[6].quaternion);
    this.footR.quaternion.copy(l[7].quaternion);

    // Head: raised to look forward while prone, nearly straight when hanging.
    this.head.rotation.x = pose.headPitch * (1 - hang) + 0.05 * hang;
    this.head.position.set(0, 0.08 + 0.03 * (1 - hang), -0.5);
    this.torso.rotation.z = pose.bodyRoll;
    this.pelvis.rotation.z = pose.bodyRoll * 0.5;

    const fold = 1 - hang;
    this.armWing(this.armWingL, j.shoulderL, j.elbowL, j.handL, j.hipL, pose, fold, 0);
    this.armWing(this.armWingR, j.shoulderR, j.elbowR, j.handR, j.hipR, pose, fold, Math.PI);
    this.legWingUpdate(pose, fold);
  }

  private placeLimb(m: Mesh, a: Vector3, b: Vector3): void {
    m.position.lerpVectors(a, b, 0.5);
    const d = this.tmpC.subVectors(b, a);
    const len = d.length();
    m.scale.set(1, Math.max(0.01, len), 1);
    this.q.setFromUnitVectors(Y_AXIS, d.multiplyScalar(1 / len));
    m.quaternion.copy(this.q);
  }

  /** Arm wing: leading edge along the arm, trailing edge from the hand back to the hip. */
  private armWing(
    mesh: Mesh,
    shoulder: Vector3,
    elbow: Vector3,
    hand: Vector3,
    hip: Vector3,
    pose: PilotPose,
    fold: number,
    phaseOffset: number,
  ): void {
    const pos = mesh.geometry.getAttribute('position') as Float32BufferAttribute;
    const le = this.tmpC;
    const te = this.tmpD;
    const mid = UPPER_ARM_M / (UPPER_ARM_M + FOREARM_M);
    for (let j = 0; j <= ARM_NU; j++) {
      const u = j / ARM_NU;
      polyline(le, shoulder, elbow, hand, u, mid);
      te.lerpVectors(hip, hand, u);
      for (let k = 0; k <= ARM_NV; k++) {
        const v = (k / ARM_NV) * fold;
        const x = le.x + (te.x - le.x) * v;
        let y = le.y + (te.y - le.y) * v - 0.035 * v * (1 - v) * fold;
        const z = le.z + (te.z - le.z) * v;
        if (k === ARM_NV) {
          y +=
            pose.flutterAmp *
            Math.sin(pose.flutterPhase + phaseOffset + u * 7) *
            (0.25 + 0.75 * u) *
            fold;
        }
        pos.setXYZ(j * (ARM_NV + 1) + k, x, y, z);
      }
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  /** Leg wing between the legs, from the crotch to the feet. */
  private legWingUpdate(pose: PilotPose, fold: number): void {
    const j = this.joints;
    const pos = this.legWing.geometry.getAttribute('position') as Float32BufferAttribute;
    const l = this.tmpC;
    const r = this.tmpD;
    const mid = THIGH_M / (THIGH_M + SHIN_M);
    for (let a = 0; a <= LEG_NU; a++) {
      const u = a / LEG_NU;
      polyline(l, j.hipL, j.kneeL, j.footL, u, mid);
      polyline(r, j.hipR, j.kneeR, j.footR, u, mid);
      for (let b = 0; b <= LEG_NV; b++) {
        const v = b / LEG_NV;
        const x = l.x + (r.x - l.x) * v;
        let y = l.y + (r.y - l.y) * v - 0.025 * v * (1 - v) * fold;
        const z = l.z + (r.z - l.z) * v;
        if (a >= LEG_NU - 1) {
          y +=
            pose.flutterAmp *
            0.9 *
            Math.sin(pose.flutterPhase * 1.3 + v * 5 + 1) *
            (a === LEG_NU ? 1 : 0.4) *
            fold;
        }
        pos.setXYZ(a * (LEG_NV + 1) + b, x, y, z);
      }
    }
    pos.needsUpdate = true;
    this.legWing.geometry.computeVertexNormals();
  }
}
