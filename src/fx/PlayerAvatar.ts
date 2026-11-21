import { Group, Vector3 } from 'three';
import type { FlightPhase } from '../types/flight';
import type { Quat, Vec3 } from '../types/math';
import { fallbackLighting, type AvatarLighting } from './AvatarMaterial';
import {
  CanopyStateFilter,
  MotionCueEstimator,
  PilotPoseFilter,
  type AvatarCue,
} from './avatarPose';
import { CanopyMesh } from './CanopyMesh';
import { PilotMesh } from './PilotMesh';

/** Drawn larger than life so the pilot reads from the chase distance. */
export const AVATAR_SCALE = 1.5;

/**
 * The player's pilot and canopy. The group takes the flight model's position and orientation
 * (forward -Z, up +Y, right +X); inside it the pilot lies prone in the suit and swings upright
 * under the canopy as the opening progresses. Pose and canopy state come from avatarPose.ts
 * (pure, tested); PilotMesh and CanopyMesh turn them into geometry. Built from primitives and
 * hand-built grids, no assets. Lighting shares the world's sun and sky uniforms.
 */
export class PlayerAvatar {
  readonly group = new Group();
  readonly pilot: PilotMesh;
  readonly canopy: CanopyMesh;
  private readonly body = new Group();
  private readonly poseFilter = new PilotPoseFilter();
  private readonly canopyFilter = new CanopyStateFilter();
  private readonly estimator = new MotionCueEstimator();
  private readonly riserL = new Vector3();
  private readonly riserR = new Vector3();
  private readonly handL = new Vector3();
  private readonly handR = new Vector3();
  private lastPhase: FlightPhase | null = null;

  constructor(lighting: AvatarLighting = fallbackLighting()) {
    this.pilot = new PilotMesh(lighting);
    this.canopy = new CanopyMesh(lighting);
    this.body.add(this.pilot.group);
    // The canopy pivots at the risers, roughly the shoulders of the hanging pilot.
    this.canopy.pivot.position.set(0, 0.3, 0);
    this.group.add(this.body, this.canopy.pivot, this.canopy.lines);
    this.group.scale.setScalar(AVATAR_SCALE);
    this.group.visible = false;
    this.canopy.setVisible(false);
  }

  /** Shows or hides the whole avatar (menus, some camera modes). */
  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  /** Hides the helmet for a camera inside it. */
  setHeadVisible(v: boolean): void {
    this.pilot.head.visible = v;
  }

  /** Triangle counts for the budget check (brief: pilot under 3,000, canopy under 2,000). */
  triangleCount(): { pilot: number; canopy: number } {
    return { pilot: this.pilot.triangleCount(), canopy: this.canopy.triangleCount() };
  }

  /** Forgets any previous run so a new run or replay starts from a clean pose. */
  reset(): void {
    this.estimator.reset();
    this.canopyFilter.reset();
    this.lastPhase = null;
  }

  /**
   * Places the avatar and animates it. `cue` is the live flight state and input; omit it in
   * replays and the motion estimator fills it in from the pose stream (`aglM` from the terrain
   * helps it see the flare).
   */
  update(
    dtS: number,
    position: Vec3,
    orientation: Quat,
    phase: FlightPhase,
    cue?: AvatarCue,
    aglM = 500,
  ): void {
    this.group.position.set(position.x, position.y, position.z);
    this.group.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
    const c = cue ?? this.estimator.update(dtS, position, orientation, phase, aglM);
    if (this.lastPhase === null) {
      this.poseFilter.reset(c);
      this.canopyFilter.reset();
    }
    this.lastPhase = phase;

    const pose = this.poseFilter.update(c, dtS);
    this.pilot.apply(pose);
    // Prone in the suit at hang 0; feet down, facing forward, at hang 1.
    this.body.rotation.x = (Math.PI / 2) * pose.hang;
    this.body.position.set(0, 0.12 * pose.hang, 0);

    const cs = this.canopyFilter.update(c, dtS);
    if (cs.visible) {
      this.body.updateMatrix();
      const j = this.pilot.joints;
      this.riserL.copy(j.shoulderL).applyMatrix4(this.body.matrix);
      this.riserR.copy(j.shoulderR).applyMatrix4(this.body.matrix);
      this.handL.copy(j.handL).applyMatrix4(this.body.matrix);
      this.handR.copy(j.handR).applyMatrix4(this.body.matrix);
    }
    this.canopy.update(cs, this.riserL, this.riserR, this.handL, this.handR);
  }
}
