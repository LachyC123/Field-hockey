import * as THREE from 'three';
import { mat, shadowed } from './materials';

export const STICK_LENGTH = 0.93;

export interface StickLook {
  shaft: THREE.ColorRepresentation;
  accent: THREE.ColorRepresentation;
  grip: THREE.ColorRepresentation;
}

/**
 * A composite hockey stick. Local frame: the top of the handle is the origin, the shaft runs
 * down -Y and the hook at the bottom curls toward +Z (the flat face looks toward -X).
 */
export function buildStick(look: StickLook): THREE.Group {
  const g = new THREE.Group();
  g.name = 'stick';

  // Handle with grip wrap
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.016, 0.3, 10), mat(look.grip, 0.95));
  grip.position.y = -0.15;
  g.add(grip);

  // Slightly oval shaft
  const shaftGeo = new THREE.CylinderGeometry(0.015, 0.017, 0.55, 12);
  shaftGeo.scale(1, 1, 1.35);
  const shaft = new THREE.Mesh(shaftGeo, mat(look.shaft, 0.35, 0.25, { envMapIntensity: 1.2 }));
  shaft.position.y = -0.575;
  g.add(shaft);

  // Graphic band
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.0175, 0.12, 12), mat(look.accent, 0.4, 0.2));
  band.geometry.scale(1, 1, 1.35);
  band.position.y = -0.5;
  g.add(band);

  // Hook: a flattened tube following a J curve
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.84, 0),
    new THREE.Vector3(0, -0.89, 0.005),
    new THREE.Vector3(0, -0.925, 0.035),
    new THREE.Vector3(0, -0.93, 0.075),
    new THREE.Vector3(0, -0.912, 0.105),
    new THREE.Vector3(0, -0.88, 0.112),
  ]);
  const hookGeo = new THREE.TubeGeometry(curve, 24, 0.02, 10, false);
  hookGeo.scale(0.72, 1, 1);
  const hook = new THREE.Mesh(hookGeo, mat(look.shaft, 0.35, 0.25));
  g.add(hook);
  const toe = new THREE.Mesh(new THREE.SphereGeometry(0.0145, 10, 8), mat(look.accent, 0.4, 0.2));
  toe.scale.set(0.72, 1, 1);
  toe.position.set(0, -0.88, 0.112);
  g.add(toe);

  return shadowed(g, true, false);
}

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

/**
 * Point a stick so its handle top sits at `top` and the shaft runs toward `head`.
 * `forward` is where the hook should curl (usually the player's facing direction).
 */
export function orientStick(stick: THREE.Object3D, top: THREE.Vector3, head: THREE.Vector3, forward: THREE.Vector3): void {
  _y.subVectors(top, head).normalize(); // local +Y points up the shaft
  _z.copy(forward).addScaledVector(_y, -forward.dot(_y));
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize();
  _x.crossVectors(_y, _z).normalize();
  _m.makeBasis(_x, _y, _z);
  stick.quaternion.setFromRotationMatrix(_m);
  stick.position.copy(top);
}
