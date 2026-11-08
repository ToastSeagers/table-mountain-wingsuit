import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  SphereGeometry,
  CapsuleGeometry,
} from 'three';
import type { FlightPhase } from '../types/flight';
import type { Quat, Vec3 } from '../types/math';

// Chrome palette (look spec section 2) reused for the pilot so the avatar reads against terrain.
const SUN = 0xffb347;
const INK = 0x1b1230;
const CORAL = 0xff5e5b;
const PAPER = 0xf4e9d2;
/** Drawn larger than life so the pilot reads from the chase distance. */
const SCALE = 1.5;
const OPEN_S = 2.5;

function wing(points: number[][]): BufferGeometry {
  const g = new BufferGeometry();
  const v: number[] = [];
  for (const p of points) v.push(p[0], p[1], p[2]);
  g.setAttribute('position', new Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * The pilot as a small low-poly figure: lying flat in a wingsuit (head toward -Z, the flight
 * direction), hanging upright under a ram-air canopy after deploy. Built from primitives, no
 * assets. Forward is -Z, up +Y, right +X, matching the flight model's orientation.
 */
export class PlayerAvatar {
  readonly group = new Group();
  private readonly body = new Group();
  private readonly suit = new Group();
  private readonly canopy = new Group();
  private readonly lines: LineSegments;
  private phase: FlightPhase = 'freefall';
  private phaseTimeS = 0;

  constructor() {
    const suitMat = new MeshLambertMaterial({ color: SUN, emissive: 0x331a00, side: DoubleSide });
    const darkMat = new MeshLambertMaterial({ color: INK, emissive: 0x0a0618 });
    const trimMat = new MeshLambertMaterial({ color: CORAL, emissive: 0x330c0b, side: DoubleSide });
    const torso = new Mesh(new CapsuleGeometry(0.17, 0.75, 3, 8), suitMat);
    torso.rotation.x = Math.PI / 2;
    torso.position.z = 0.1;
    const head = new Mesh(new SphereGeometry(0.15, 10, 8), darkMat);
    head.position.set(0, 0.04, -0.62);
    // Wing membranes: arm wings from shoulder to hand to hip, and the leg wing between the knees.
    const left = new Mesh(wing([[-0.15, 0, -0.35], [-1.0, 0, -0.1], [-0.15, 0, 0.5]]), trimMat);
    const right = new Mesh(wing([[0.15, 0, -0.35], [1.0, 0, -0.1], [0.15, 0, 0.5]]), trimMat);
    const tail = new Mesh(wing([[-0.3, 0, 0.5], [0.3, 0, 0.5], [0, 0, 1.05]]), suitMat);
    this.suit.add(left, right, tail);
    this.body.add(torso, head, this.suit);

    // Canopy: a strongly curved ram-air wing, with four lines down to the pilot.
    const cg = new BoxGeometry(6, 0.3, 2.2, 14, 1, 1);
    const pos = cg.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) - 0.9 * (pos.getX(i) / 3) ** 2);
    cg.computeVertexNormals();
    const canopyMesh = new Mesh(cg, new MeshLambertMaterial({ color: PAPER, emissive: 0xb4a484, side: DoubleSide }));
    const stripe = new Mesh(
      new BoxGeometry(0.5, 0.06, 2.25),
      new MeshLambertMaterial({ color: CORAL, emissive: 0x330c0b }),
    );
    stripe.position.y = 0.17;
    this.canopy.add(canopyMesh, stripe);
    this.canopy.position.y = 4.6;
    const lineGeo = new BufferGeometry();
    const lv: number[] = [];
    for (const [x, z] of [[-2.8, -0.9], [-2.8, 0.9], [2.8, -0.9], [2.8, 0.9]]) lv.push(0, 0.3, 0, x, 4.6 - 0.9 * (x / 3) ** 2, z);
    lineGeo.setAttribute('position', new Float32BufferAttribute(lv, 3));
    this.lines = new LineSegments(lineGeo, new LineBasicMaterial({ color: PAPER }));
    this.group.add(this.body, this.canopy, this.lines);
    this.group.scale.setScalar(SCALE);
    this.group.visible = false;
    this.setCanopyVisible(false);
  }

  /** Shows or hides the avatar (it is hidden in head cam and menus). */
  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  /** Places the avatar and animates the phase changes. `pose` is the interpolated flight pose. */
  update(dtS: number, position: Vec3, orientation: Quat, phase: FlightPhase): void {
    if (phase !== this.phase) {
      this.phase = phase;
      this.phaseTimeS = 0;
    }
    this.phaseTimeS += dtS;
    this.group.position.set(position.x, position.y, position.z);
    this.group.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);

    const t = Math.min(1, this.phaseTimeS / OPEN_S);
    const ease = t * t * (3 - 2 * t);
    switch (phase) {
      case 'freefall':
      case 'wingsuit':
        this.body.rotation.x = 0;
        this.setCanopyVisible(false);
        this.suit.visible = true;
        break;
      case 'deploying':
        // The pilot swings up to hang under the canopy while it inflates.
        this.body.rotation.x = (Math.PI / 2) * ease;
        this.setCanopyVisible(true, 0.15 + 0.85 * ease);
        this.suit.visible = ease < 0.5;
        break;
      default:
        this.body.rotation.x = Math.PI / 2;
        this.setCanopyVisible(true, 1);
        this.suit.visible = false;
    }
    // Canopy settles to the ground after touchdown.
    if (phase === 'landed') this.canopy.scale.y = Math.max(0.15, 1 - this.phaseTimeS * 0.6);
  }

  private setCanopyVisible(v: boolean, scale = 1): void {
    this.canopy.visible = v;
    this.lines.visible = v;
    this.canopy.scale.set(scale, scale, scale);
    this.canopy.position.y = 4.6 * scale;
  }
}
