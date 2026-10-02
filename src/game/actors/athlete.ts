import * as THREE from 'three';
import { mat, shadowed } from './materials';
import { buildStick, orientStick, type StickLook } from './stick';

export interface Kit {
  shirt: string;
  shirtAccent: string;
  shorts: string;
  socks: string;
  number: number;
  name?: string;
}

export interface Look {
  skin: string;
  hair: string;
  hairStyle: 'short' | 'buzz' | 'pony' | 'bun';
  headband?: string;
  kit: Kit;
  stick: StickLook;
  keeper?: { pads: string; helmet: string; smock: string };
}

/** A full-body pose. Positions are metres in the athlete's local space (facing +Z, right hand side is -X). */
export interface Pose {
  crouch: number; // 0 standing .. 1 deep crouch
  lean: number; // forward bend of the spine, radians
  twist: number; // chest yaw, radians
  headPitch: number;
  stance: number; // foot spread, radians
  stepL: number; // forward step of the left leg, radians
  stepR: number;
  roll: number; // whole body roll (keeper dives), radians
  shiftX: number; // body offset sideways (keeper dives)
  drop: number; // extra body drop toward the ground
  /** Top of the stick (left hand). */
  L: [number, number, number];
  /** Head of the stick (hook). */
  H: [number, number, number];
  /** Optional free left hand target when the left hand isn't on the stick (keepers). */
  freeHand?: [number, number, number];
}

export const POSE_DEFAULT: Pose = {
  crouch: 0.15,
  lean: 0.25,
  twist: 0,
  headPitch: 0.15,
  stance: 0.12,
  stepL: 0.05,
  stepR: -0.05,
  roll: 0,
  shiftX: 0,
  drop: 0,
  L: [0.02, 1.0, 0.28],
  H: [-0.28, 0.04, 0.62],
};

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const l = (x: number, y: number) => x + (y - x) * t;
  const v = (x: [number, number, number], y: [number, number, number]): [number, number, number] => [l(x[0], y[0]), l(x[1], y[1]), l(x[2], y[2])];
  return {
    crouch: l(a.crouch, b.crouch),
    lean: l(a.lean, b.lean),
    twist: l(a.twist, b.twist),
    headPitch: l(a.headPitch, b.headPitch),
    stance: l(a.stance, b.stance),
    stepL: l(a.stepL, b.stepL),
    stepR: l(a.stepR, b.stepR),
    roll: l(a.roll, b.roll),
    shiftX: l(a.shiftX, b.shiftX),
    drop: l(a.drop, b.drop),
    L: v(a.L, b.L),
    H: v(a.H, b.H),
    freeHand: a.freeHand && b.freeHand ? v(a.freeHand, b.freeHand) : (t < 0.5 ? a.freeHand : b.freeHand),
  };
}

const THIGH = 0.44;
const SHIN = 0.44;
const FOOT = 0.075;
const UPPER_ARM = 0.29;
const FOREARM = 0.28;

function limb(len: number, r: number, material: THREE.Material, rTop = r): THREE.Mesh {
  const geo = rTop === r ? new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 6, 12) : new THREE.CylinderGeometry(rTop, r, len, 12);
  const m = new THREE.Mesh(geo, material);
  m.position.y = -len / 2;
  return m;
}

function numberTexture(kit: Kit): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = kit.shirt;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = kit.shirtAccent;
  g.fillRect(0, 0, 256, 18);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.font = '900 150px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.fillText(String(kit.number), 128, 215);
  if (kit.name) {
    g.font = '800 34px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.fillText(kit.name.toUpperCase(), 128, 62);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Athlete {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly stick: THREE.Group;
  private pelvis = new THREE.Group();
  private chest = new THREE.Group();
  private neck = new THREE.Group();
  private hip = { L: new THREE.Group(), R: new THREE.Group() };
  private knee = { L: new THREE.Group(), R: new THREE.Group() };
  private shoulder = { L: new THREE.Group(), R: new THREE.Group() };
  private elbow = { L: new THREE.Group(), R: new THREE.Group() };
  private pose: Pose = { ...POSE_DEFAULT };
  private breath = Math.random() * 10;
  readonly isKeeper: boolean;

  constructor(readonly look: Look) {
    this.isKeeper = !!look.keeper;
    const k = look.kit;
    const skin = mat(look.skin, 0.62);
    const shirt = mat(k.shirt, 0.78);
    const accent = mat(k.shirtAccent, 0.7);
    const shorts = mat(k.shorts, 0.8);
    const socks = mat(k.socks, 0.85);
    const shoe = mat('#16181d', 0.5);
    const hairM = mat(look.hair, 0.9);
    const kp = look.keeper;

    this.root.add(this.body);
    this.body.add(this.pelvis);
    this.pelvis.position.y = 0.95;

    // Hips and shorts
    const shortsMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.08, 6, 14), kp ? mat(kp.smock, 0.8) : shorts);
    shortsMesh.scale.set(1.1, 1, 0.82);
    shortsMesh.position.y = -0.02;
    this.pelvis.add(shortsMesh);

    // Spine/chest
    this.pelvis.add(this.chest);
    this.chest.position.y = 0.1;
    const torsoGeo = new THREE.CapsuleGeometry(kp ? 0.2 : 0.165, 0.26, 8, 16);
    const torso = new THREE.Mesh(torsoGeo, kp ? mat(kp.smock, 0.8) : shirt);
    torso.scale.set(1.05, 1, kp ? 0.92 : 0.72);
    torso.position.y = 0.2;
    this.chest.add(torso);
    if (!kp) {
      const back = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshStandardMaterial({ map: numberTexture(k), roughness: 0.8, transparent: false }));
      back.position.set(0, 0.24, -0.123);
      back.rotation.y = Math.PI;
      this.chest.add(back);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.018, 6, 16), accent);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.43;
      this.chest.add(collar);
      // Side panels
      for (const s of [-1, 1]) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.12), accent);
        panel.position.set(s * 0.17, 0.2, 0);
        this.chest.add(panel);
      }
    }

    // Neck and head
    this.chest.add(this.neck);
    this.neck.position.y = 0.44;
    const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.1, 10), skin);
    neckMesh.position.y = 0.03;
    this.neck.add(neckMesh);
    const head = new THREE.Group();
    head.position.y = 0.15;
    this.neck.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 16), skin);
    skull.scale.set(0.92, 1.08, 1);
    head.add(skull);
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), skin);
    jaw.position.set(0, -0.05, 0.025);
    jaw.scale.set(1, 0.8, 1);
    head.add(jaw);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), skin);
    nose.position.set(0, -0.01, 0.105);
    nose.scale.set(0.9, 1.2, 1);
    head.add(nose);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), mat('#1b1b1f', 0.3));
      eye.position.set(s * 0.036, 0.018, 0.093);
      head.add(eye);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.008, 0.01), hairM);
      brow.position.set(s * 0.037, 0.045, 0.098);
      head.add(brow);
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), skin);
      ear.position.set(s * 0.098, 0, 0);
      ear.scale.set(0.5, 1, 0.8);
      head.add(ear);
    }
    if (kp) {
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.145, 20, 16), mat(kp.helmet, 0.35, 0.1));
      helmet.scale.set(0.95, 1.05, 1.08);
      head.add(helmet);
      const cage = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const bar = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.006, 4, 20, Math.PI * 0.9), mat('#d8d8d8', 0.3, 0.8));
        bar.rotation.set(0, 0, Math.PI * 0.05);
        bar.position.set(0, -0.06 + i * 0.03, 0.02);
        bar.rotation.x = Math.PI / 2;
        cage.add(bar);
      }
      head.add(cage);
    } else {
      const hairGeo = new THREE.SphereGeometry(0.112, 20, 12, 0, Math.PI * 2, 0, look.hairStyle === 'buzz' ? Math.PI * 0.42 : Math.PI * 0.55);
      const hair = new THREE.Mesh(hairGeo, hairM);
      hair.rotation.x = -0.25;
      hair.position.set(0, 0.012, -0.008);
      hair.scale.set(0.97, 1.08, 1.04);
      head.add(hair);
      if (look.hairStyle === 'pony' || look.hairStyle === 'bun') {
        const tail = new THREE.Mesh(
          look.hairStyle === 'bun' ? new THREE.SphereGeometry(0.045, 12, 10) : new THREE.CapsuleGeometry(0.03, 0.14, 4, 8),
          hairM,
        );
        tail.position.set(0, look.hairStyle === 'bun' ? 0.08 : -0.02, -0.12);
        tail.rotation.x = 0.4;
        head.add(tail);
      }
      if (look.headband) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.107, 0.012, 6, 24), mat(look.headband, 0.8));
        band.rotation.x = Math.PI / 2 - 0.2;
        band.position.y = 0.045;
        head.add(band);
      }
    }

    // Arms
    for (const side of ['L', 'R'] as const) {
      const s = side === 'L' ? 1 : -1;
      const sh = this.shoulder[side];
      sh.position.set(s * 0.2, 0.36, 0);
      this.chest.add(sh);
      sh.add(limb(UPPER_ARM, kp ? 0.06 : 0.048, kp ? mat(kp.smock, 0.8) : skin));
      if (!kp) {
        const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.058, 0.13, 12), shirt);
        sleeve.position.y = -0.05;
        sh.add(sleeve);
      }
      const el = this.elbow[side];
      el.position.y = -UPPER_ARM;
      sh.add(el);
      el.add(limb(FOREARM - 0.05, 0.04, skin));
      const handGeo = kp ? new THREE.BoxGeometry(0.13, 0.16, 0.14) : new THREE.SphereGeometry(0.048, 10, 8);
      const hand = new THREE.Mesh(handGeo, kp ? mat(kp.pads, 0.6) : side === 'L' ? mat('#f2f2f2', 0.7) : skin);
      hand.position.y = -FOREARM + 0.02;
      el.add(hand);
    }

    // Legs
    for (const side of ['L', 'R'] as const) {
      const s = side === 'L' ? 1 : -1;
      const hp = this.hip[side];
      hp.position.set(s * 0.095, -0.06, 0);
      this.pelvis.add(hp);
      hp.add(limb(THIGH, 0.068, skin, 0.08));
      const shortLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.08, 0.2, 12), kp ? mat(kp.smock, 0.8) : shorts);
      shortLeg.position.y = -0.08;
      hp.add(shortLeg);
      const kn = this.knee[side];
      kn.position.y = -THIGH;
      hp.add(kn);
      kn.add(limb(SHIN, 0.052, skin, 0.06));
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.055, SHIN - 0.08, 12), socks);
      sock.position.y = -SHIN / 2 - 0.02;
      kn.add(sock);
      const shoeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.25), shoe);
      shoeMesh.position.set(0, -SHIN - 0.035, 0.05);
      kn.add(shoeMesh);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.102, 0.02, 0.12), accent);
      stripe.position.set(0, -SHIN - 0.03, 0.06);
      kn.add(stripe);
      if (kp) {
        const pad = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.16), mat(kp.pads, 0.55));
        pad.position.set(0, -SHIN / 2 + 0.06, 0.06);
        kn.add(pad);
        const kicker = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.36), mat(kp.pads, 0.55));
        kicker.position.set(0, -SHIN - 0.03, 0.07);
        kn.add(kicker);
        const thighPad = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 0.12), mat(kp.pads, 0.55));
        thighPad.position.set(0, -0.25, 0.07);
        hp.add(thighPad);
      }
    }

    this.stick = buildStick(look.stick);
    if (kp) this.stick.scale.setScalar(0.92);
    this.body.add(this.stick);
    shadowed(this.root);
    this.apply();
  }

  setPose(p: Pose): void {
    this.pose = p;
  }

  getPose(): Pose {
    return this.pose;
  }

  /** Advance idle motion and re-solve the skeleton. */
  update(dt: number): void {
    this.breath += dt;
    this.apply();
  }

  private apply(): void {
    const p = this.pose;
    const breathe = Math.sin(this.breath * 2.4) * 0.012;

    this.body.position.set(p.shiftX, -p.drop, 0);
    this.body.rotation.set(0, 0, p.roll);

    // Legs: pelvis height comes from the crouch, thigh/shin bend solve to keep feet near the ground.
    const pelvisH = 0.95 - p.crouch * 0.34 + breathe * 0.3;
    this.pelvis.position.y = pelvisH;
    const reach = Math.min(0.999, (pelvisH + 0.06 - FOOT) / (THIGH + SHIN));
    const a = Math.acos(reach);
    for (const side of ['L', 'R'] as const) {
      const s = side === 'L' ? 1 : -1;
      const step = side === 'L' ? p.stepL : p.stepR;
      this.hip[side].rotation.set(-a - step + p.lean * 0.35, 0, s * p.stance);
      this.knee[side].rotation.set(2 * a - Math.max(0, -step) * 0.3, 0, 0);
    }
    this.pelvis.rotation.set(-p.lean * 0.35, p.twist * 0.3, 0);
    this.chest.rotation.set(p.lean * 0.65 + breathe, p.twist * 0.7, 0);
    this.neck.rotation.set(p.headPitch - p.lean * 0.6, -p.twist * 0.4, 0);

    // Stick and arms (two-bone IK to the grips)
    this.root.updateMatrixWorld(true);
    const top = new THREE.Vector3(...p.L);
    const head = new THREE.Vector3(...p.H);
    const fwd = new THREE.Vector3(0, 0, 1);
    orientStick(this.stick, top, head, fwd);
    this.stick.updateMatrixWorld(true);
    const gripL = new THREE.Vector3(0, -0.04, 0).applyMatrix4(this.stick.matrixWorld);
    const gripR = new THREE.Vector3(0, -0.3, 0).applyMatrix4(this.stick.matrixWorld);
    const free = p.freeHand ? this.body.localToWorld(new THREE.Vector3(...p.freeHand)) : null;
    this.solveArm('L', free ?? gripL, new THREE.Vector3(0.6, -0.5, -0.4));
    this.solveArm('R', gripR, new THREE.Vector3(-0.6, -0.6, -0.5));
  }

  private solveArm(side: 'L' | 'R', target: THREE.Vector3, poleLocal: THREE.Vector3): void {
    const sh = this.shoulder[side];
    const el = this.elbow[side];
    const S = sh.getWorldPosition(new THREE.Vector3());
    const toT = new THREE.Vector3().subVectors(target, S);
    let d = toT.length();
    const maxD = UPPER_ARM + FOREARM - 0.001;
    d = Math.min(maxD, Math.max(0.05, d));
    const dir = toT.normalize();
    const cosA = (UPPER_ARM * UPPER_ARM + d * d - FOREARM * FOREARM) / (2 * UPPER_ARM * d);
    const angA = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const pole = poleLocal.clone().transformDirection(this.chest.matrixWorld);
    const ortho = pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const E = S.clone()
      .addScaledVector(dir, Math.cos(angA) * UPPER_ARM)
      .addScaledVector(ortho, Math.sin(angA) * UPPER_ARM);
    const T = S.clone().addScaledVector(dir, d);

    const down = new THREE.Vector3(0, -1, 0);
    const parentQ = sh.parent!.getWorldQuaternion(new THREE.Quaternion());
    const upperWorld = new THREE.Quaternion().setFromUnitVectors(down, E.clone().sub(S).normalize());
    sh.quaternion.copy(parentQ.clone().invert().multiply(upperWorld));
    sh.updateMatrixWorld(true);
    const foreWorld = new THREE.Quaternion().setFromUnitVectors(down, T.clone().sub(E).normalize());
    el.quaternion.copy(upperWorld.clone().invert().multiply(foreWorld));
  }
}
