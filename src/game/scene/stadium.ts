import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import {
  BACKBOARD_HEIGHT,
  CIRCLE_RADIUS,
  DOTTED_CIRCLE_RADIUS,
  GOAL_DEPTH,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  LINE_23,
  PENALTY_SPOT,
  PITCH_LENGTH,
  PITCH_WIDTH,
  POST_RADIUS,
} from '../../core/pitch';
import { Rng } from '../../core/rng';
import { mat, shadowed } from '../actors/materials';
import { boardTexture, netTexture, turfColorTexture, turfNormalTexture, windowsTexture } from './textures';

export interface Stadium {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  net: GoalNet;
  crowd: Crowd;
  update(dt: number, time: number): void;
}

const LINE_W = 0.075;
const LINE_Y = 0.004;

export function buildStadium(scene: THREE.Scene, renderer: THREE.WebGLRenderer, quality: 'low' | 'medium' | 'high'): Stadium {
  const group = new THREE.Group();
  scene.add(group);

  // ---- Sky and image-based lighting ----------------------------------------------------------
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const u = sky.material.uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 2.4;
  u.mieCoefficient.value = 0.006;
  u.mieDirectionalG.value = 0.86;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(89), THREE.MathUtils.degToRad(100));
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  Object.assign(envSky.material.uniforms.sunPosition.value, sunDir);
  envSky.material.uniforms.turbidity.value = 6;
  envSky.material.uniforms.rayleigh.value = 2.4;
  envScene.add(envSky);
  // Floodlight glow in the environment so reflections pick them up.
  for (const p of floodlightPositions()) {
    const glow = new THREE.Mesh(new THREE.SphereGeometry(6, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 9, 8) }));
    glow.position.set(p.x, 30, p.z).multiplyScalar(4);
    envScene.add(glow);
  }
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.55;
  scene.fog = new THREE.Fog(0x2a2f4a, 120, 420);

  const hemi = new THREE.HemisphereLight(0x8fa8ff, 0x1d2a55, 0.55);
  scene.add(hemi);

  // Key light: the floodlights read as one strong cool-white source from the left stand.
  const sun = new THREE.DirectionalLight(0xfff4e6, 2.6);
  sun.position.set(-26, 42, -24);
  sun.target.position.set(0, 0, -6);
  sun.castShadow = quality !== 'low';
  sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  const sc = sun.shadow.camera;
  sc.left = -18;
  sc.right = 18;
  sc.top = 18;
  sc.bottom = -18;
  sc.near = 10;
  sc.far = 110;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xb9c8ff, 0.7);
  fill.position.set(30, 30, -40);
  scene.add(fill);

  // ---- Ground ---------------------------------------------------------------------------------
  const normal = turfNormalTexture();
  normal.repeat.set(60, 100);
  const runoff = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH_WIDTH + 30, PITCH_LENGTH + 40),
    new THREE.MeshStandardMaterial({ color: 0x1f6b4f, roughness: 0.88, normalMap: normal, normalScale: new THREE.Vector2(0.4, 0.4) }),
  );
  runoff.rotation.x = -Math.PI / 2;
  runoff.position.set(0, -0.002, -PITCH_LENGTH / 2 + 2);
  runoff.receiveShadow = true;
  group.add(runoff);

  const turfMap = turfColorTexture('#1d4fa8', '#1b4a9f', 16);
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH_WIDTH, PITCH_LENGTH),
    new THREE.MeshPhysicalMaterial({
      map: turfMap,
      roughness: 0.78,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.55, 0.55),
      sheen: 0.6,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0x6f9bff),
      clearcoat: 0.08,
      clearcoatRoughness: 0.6,
    }),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.set(0, 0, -PITCH_LENGTH / 2);
  pitch.receiveShadow = true;
  group.add(pitch);

  group.add(buildLines());

  // ---- Goal -----------------------------------------------------------------------------------
  const net = new GoalNet();
  const goal = buildGoal(net);
  group.add(goal);
  const farGoal = buildGoal(new GoalNet());
  farGoal.rotation.y = Math.PI;
  farGoal.position.z = -PITCH_LENGTH;
  group.add(farGoal);

  // ---- Surroundings ---------------------------------------------------------------------------
  group.add(buildBoards());
  group.add(buildFloodlights());
  const crowd = new Crowd(quality === 'low' ? 260 : 620);
  group.add(buildStand(crowd));
  group.add(buildClubhouse());
  group.add(buildTrees());

  return {
    group,
    sun,
    net,
    crowd,
    update(dt, time) {
      net.update(dt);
      crowd.update(dt, time);
    },
  };
}

function floodlightPositions(): THREE.Vector3[] {
  return [new THREE.Vector3(-36, 0, 6), new THREE.Vector3(36, 0, 6), new THREE.Vector3(-36, 0, -45), new THREE.Vector3(36, 0, -45)];
}

// ---- Lines -------------------------------------------------------------------------------------
function buildLines(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0xf4f6ff, roughness: 0.6, emissive: 0x202430 });
  const strip = (x1: number, z1: number, x2: number, z2: number, w = LINE_W) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, len), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -Math.atan2(x2 - x1, z2 - z1);
    mesh.position.set((x1 + x2) / 2, LINE_Y, (z1 + z2) / 2);
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  const hw = PITCH_WIDTH / 2;
  // Outer lines
  strip(-hw, 0, hw, 0);
  strip(-hw, -PITCH_LENGTH, hw, -PITCH_LENGTH);
  strip(-hw, 0, -hw, -PITCH_LENGTH);
  strip(hw, 0, hw, -PITCH_LENGTH);
  strip(-hw, -LINE_23, hw, -LINE_23);
  strip(-hw, -PITCH_LENGTH + LINE_23, hw, -PITCH_LENGTH + LINE_23);
  strip(-hw, -PITCH_LENGTH / 2, hw, -PITCH_LENGTH / 2);

  for (const [zSign, zBase] of [
    [-1, 0],
    [1, -PITCH_LENGTH],
  ] as const) {
    // The D: two quarter-circles from each post joined by a straight line.
    for (const side of [-1, 1]) {
      const arc = new THREE.Mesh(
        new THREE.RingGeometry(CIRCLE_RADIUS - LINE_W / 2, CIRCLE_RADIUS + LINE_W / 2, 64, 1, 0, Math.PI / 2),
        m,
      );
      arc.rotation.x = -Math.PI / 2;
      arc.position.set(side * GOAL_HALF_WIDTH, LINE_Y, zBase);
      // RingGeometry sweeps from +X toward +Y; after laying flat +Y points to -Z.
      arc.rotation.z = zSign < 0 ? (side > 0 ? 0 : Math.PI / 2) : side > 0 ? -Math.PI / 2 : Math.PI;
      g.add(arc);
      // Dashed 5 m circle
      for (let i = 0; i < 14; i++) {
        const a0 = (i / 14) * (Math.PI / 2);
        const dash = new THREE.Mesh(
          new THREE.RingGeometry(DOTTED_CIRCLE_RADIUS - LINE_W / 2, DOTTED_CIRCLE_RADIUS + LINE_W / 2, 4, 1, a0, (Math.PI / 2 / 14) * 0.45),
          m,
        );
        dash.rotation.copy(arc.rotation);
        dash.position.set(side * GOAL_HALF_WIDTH, LINE_Y, zBase);
        g.add(dash);
      }
    }
    strip(-GOAL_HALF_WIDTH, zBase + zSign * CIRCLE_RADIUS, GOAL_HALF_WIDTH, zBase + zSign * CIRCLE_RADIUS);
    const spot = new THREE.Mesh(new THREE.CircleGeometry(0.075, 16), m);
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(0, LINE_Y, zBase + zSign * PENALTY_SPOT);
    g.add(spot);
    // Backline marks for corners (5 m and 10 m from the posts)
    for (const s of [-1, 1]) {
      for (const d of [5, 10]) {
        const x = s * (GOAL_HALF_WIDTH + d);
        strip(x, zBase, x, zBase + zSign * 0.3);
      }
    }
  }
  return g;
}

// ---- Goal and net -------------------------------------------------------------------------------
export class GoalNet {
  readonly back: THREE.Mesh;
  private base: Float32Array;
  private ripples: { x: number; y: number; t: number; a: number }[] = [];

  constructor() {
    const tex = netTexture();
    tex.repeat.set(36, 17);
    const netMat = new THREE.MeshStandardMaterial({
      map: tex,
      alphaMap: tex,
      transparent: true,
      side: THREE.DoubleSide,
      roughness: 0.9,
      depthWrite: false,
      color: 0xf0f2ff,
    });
    const geo = new THREE.PlaneGeometry(GOAL_HALF_WIDTH * 2, GOAL_HEIGHT - BACKBOARD_HEIGHT, 28, 14);
    this.back = new THREE.Mesh(geo, netMat);
    this.back.position.set(0, BACKBOARD_HEIGHT + (GOAL_HEIGHT - BACKBOARD_HEIGHT) / 2, GOAL_DEPTH);
    this.back.rotation.y = Math.PI;
    this.base = new Float32Array(geo.attributes.position.array);
  }

  hit(x: number, y: number, strength: number): void {
    this.ripples.push({ x, y, t: 0, a: 0.12 + strength * 0.28 });
  }

  update(dt: number): void {
    if (!this.ripples.length) return;
    const pos = this.back.geometry.attributes.position as THREE.BufferAttribute;
    const cy = this.back.position.y;
    for (const r of this.ripples) r.t += dt;
    this.ripples = this.ripples.filter((r) => r.t < 1.6);
    for (let i = 0; i < pos.count; i++) {
      // Local x is mirrored by the 180° rotation.
      const lx = -this.base[i * 3];
      const ly = this.base[i * 3 + 1] + cy;
      let off = 0;
      for (const r of this.ripples) {
        const d = Math.hypot(lx - r.x, ly - r.y);
        off += r.a * Math.exp(-d * 2.2) * Math.exp(-r.t * 3.2) * Math.cos(r.t * 18 - d * 6);
      }
      pos.setZ(i, this.base[i * 3 + 2] - off);
    }
    pos.needsUpdate = true;
  }
}

function buildGoal(net: GoalNet): THREE.Group {
  const g = new THREE.Group();
  const white = mat('#f7f7f7', 0.35, 0.1);
  const board = mat('#14213d', 0.55);
  const boardEdge = mat('#e9edf5', 0.5);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(POST_RADIUS * 2, GOAL_HEIGHT, POST_RADIUS * 2), white);
    post.position.set(s * (GOAL_HALF_WIDTH + POST_RADIUS), GOAL_HEIGHT / 2, POST_RADIUS);
    g.add(post);
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.03, BACKBOARD_HEIGHT, GOAL_DEPTH), board);
    side.position.set(s * (GOAL_HALF_WIDTH + 0.015), BACKBOARD_HEIGHT / 2, GOAL_DEPTH / 2 + 0.05);
    g.add(side);
    const sideTop = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, GOAL_DEPTH), boardEdge);
    sideTop.position.set(s * (GOAL_HALF_WIDTH + 0.015), BACKBOARD_HEIGHT, GOAL_DEPTH / 2 + 0.05);
    g.add(sideTop);
    const backPost = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, GOAL_HEIGHT, 8), white);
    backPost.position.set(s * GOAL_HALF_WIDTH, GOAL_HEIGHT / 2, GOAL_DEPTH + 0.05);
    g.add(backPost);
    const roofBar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, GOAL_DEPTH, 8), white);
    roofBar.rotation.x = Math.PI / 2;
    roofBar.position.set(s * GOAL_HALF_WIDTH, GOAL_HEIGHT, GOAL_DEPTH / 2 + 0.05);
    g.add(roofBar);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(GOAL_HALF_WIDTH * 2 + POST_RADIUS * 4, POST_RADIUS * 2, POST_RADIUS * 2), white);
  bar.position.set(0, GOAL_HEIGHT - POST_RADIUS, POST_RADIUS);
  g.add(bar);
  const backboard = new THREE.Mesh(new THREE.BoxGeometry(GOAL_HALF_WIDTH * 2, BACKBOARD_HEIGHT, 0.04), board);
  backboard.position.set(0, BACKBOARD_HEIGHT / 2, GOAL_DEPTH + 0.05);
  g.add(backboard);
  const backTop = new THREE.Mesh(new THREE.BoxGeometry(GOAL_HALF_WIDTH * 2, 0.03, 0.05), boardEdge);
  backTop.position.set(0, BACKBOARD_HEIGHT, GOAL_DEPTH + 0.05);
  g.add(backTop);
  const backBar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, GOAL_HALF_WIDTH * 2, 8), white);
  backBar.rotation.z = Math.PI / 2;
  backBar.position.set(0, GOAL_HEIGHT, GOAL_DEPTH + 0.05);
  g.add(backBar);
  shadowed(g);

  net.back.position.z = GOAL_DEPTH + 0.02;
  g.add(net.back);
  const tex = (net.back.material as THREE.MeshStandardMaterial).clone();
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_HALF_WIDTH * 2, GOAL_DEPTH), tex);
  roof.rotation.x = Math.PI / 2;
  roof.position.set(0, GOAL_HEIGHT, GOAL_DEPTH / 2 + 0.05);
  g.add(roof);
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_DEPTH, GOAL_HEIGHT - BACKBOARD_HEIGHT), tex);
    side.rotation.y = Math.PI / 2;
    side.position.set(s * GOAL_HALF_WIDTH, BACKBOARD_HEIGHT + (GOAL_HEIGHT - BACKBOARD_HEIGHT) / 2, GOAL_DEPTH / 2 + 0.05);
    g.add(side);
  }
  return g;
}

// ---- Boards, floodlights, stand ------------------------------------------------------------------
function buildBoards(): THREE.Group {
  const g = new THREE.Group();
  const ads: [string, string, string, string?][] = [
    ['STICKWORK', '#0b1530', '#c8ff2e', 'THE HOCKEY CAREER GAME'],
    ['KESTREL', '#e8452c', '#ffffff', 'COMPOSITE STICKS'],
    ['TORA', '#111111', '#ffd400', 'TURF SHOES'],
    ['HALDEN GRIP', '#ffffff', '#0b1530'],
    ['NORTH LEAGUE', '#1d4fa8', '#ffffff', 'HOCKEY'],
    ['OKKO', '#c8ff2e', '#0b1530', 'SPORTS DRINK'],
  ];
  const w = 6;
  let i = 0;
  const place = (x: number, z: number, ry: number) => {
    const [t, bg, fg, sub] = ads[i++ % ads.length];
    const tex = boardTexture(t, bg, fg, sub);
    const bright = new THREE.Color(bg).getHSL({ h: 0, s: 0, l: 0 }).l;
    const m = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: bright > 0.7 ? 0.12 : 0.45, roughness: 0.4 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, 0.08), [mat('#111'), mat('#111'), mat('#111'), mat('#111'), m, mat('#111')]);
    b.position.set(x, 0.45, z);
    b.rotation.y = ry;
    g.add(b);
  };
  for (let x = -27; x <= 27; x += w + 0.2) place(x, 4.8, Math.PI);
  for (let z = -2; z >= -60; z -= w + 0.2) {
    place(-31, z, Math.PI / 2);
    place(31, z, -Math.PI / 2);
  }
  return g;
}

function buildFloodlights(): THREE.Group {
  const g = new THREE.Group();
  const steel = mat('#8a93a6', 0.4, 0.8);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 9 });
  for (const p of floodlightPositions()) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, 30, 10), steel);
    pole.position.set(p.x, 15, p.z);
    g.add(pole);
    const head = new THREE.Group();
    head.position.set(p.x, 30.5, p.z);
    head.lookAt(0, 0, -15);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 0.4), mat('#2a2f3a', 0.5, 0.6));
    head.add(frame);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 5; c++) {
        const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.42, 12), lampMat);
        lamp.position.set(-2.2 + c * 1.1, -1 + r * 1, 0.21);
        head.add(lamp);
      }
    }
    g.add(head);
  }
  return g;
}

export class Crowd {
  readonly mesh: THREE.InstancedMesh;
  readonly heads: THREE.InstancedMesh;
  readonly seats: { p: THREE.Vector3; phase: number; jump: number }[] = [];
  private excitement = 0;
  private dummy = new THREE.Object3D();

  constructor(count: number) {
    const body = new THREE.CapsuleGeometry(0.22, 0.4, 4, 8);
    this.mesh = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.85 }), count);
    this.heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.7 }), count);
    const rng = new Rng(21);
    const shirts = ['#e8452c', '#ffffff', '#1d4fa8', '#0b1530', '#c8ff2e', '#ffd400', '#3a3f4b', '#8c2b3f', '#2d6a4f'];
    const skins = ['#f1c7a5', '#d9a07c', '#a8714f', '#6e4630', '#f5d6bd'];
    for (let i = 0; i < count; i++) {
      this.mesh.setColorAt(i, new THREE.Color(rng.pick(shirts)));
      this.heads.setColorAt(i, new THREE.Color(rng.pick(skins)));
      this.seats.push({ p: new THREE.Vector3(), phase: rng.range(0, 10), jump: rng.range(0.6, 1.2) });
    }
  }

  setExcitement(v: number): void {
    this.excitement = Math.max(this.excitement, v);
  }

  update(dt: number, time: number): void {
    this.excitement = Math.max(0, this.excitement - dt * 0.35);
    const e = this.excitement;
    this.seats.forEach((s, i) => {
      const bob = Math.max(0, Math.sin(time * (2 + s.jump * 6 * e) + s.phase)) * (0.03 + e * 0.45 * s.jump);
      const stand = e > 0.5 ? 0.25 : 0;
      this.dummy.position.set(s.p.x, s.p.y + bob + stand, s.p.z);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.dummy.position.y += 0.43;
      this.dummy.updateMatrix();
      this.heads.setMatrixAt(i, this.dummy.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }
}

function buildStand(crowd: Crowd): THREE.Group {
  const g = new THREE.Group();
  const concrete = mat('#5b6272', 0.9);
  const seat = mat('#14213d', 0.6);
  // Main stand along the left touchline, rising away from the pitch.
  const rows = 10;
  const len = 46;
  const zc = -16;
  for (let r = 0; r < rows; r++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, len), r % 2 ? concrete : seat);
    step.position.set(-(34 + r * 0.9), 0.25 + r * 0.5, zc);
    step.receiveShadow = true;
    g.add(step);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8, len), concrete);
  back.position.set(-(34 + rows * 0.9), 4, zc);
  g.add(back);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, len + 2), mat('#2b3140', 0.6, 0.3));
  roof.position.set(-(34 + rows * 0.45), 9.2, zc);
  roof.rotation.z = -0.08;
  g.add(roof);
  for (let z = zc - len / 2; z <= zc + len / 2; z += len / 4) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 9, 8), mat('#9aa3b5', 0.4, 0.7));
    col.position.set(-(34 + rows * 0.9) + 0.4, 4.5, z);
    g.add(col);
  }
  const roofLights = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, len), new THREE.MeshStandardMaterial({ emissive: 0xfff3dd, emissiveIntensity: 4, color: 0xffffff }));
  roofLights.position.set(-34.5, 9, zc);
  g.add(roofLights);
  const rng = new Rng(9);
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 64; c++) {
      if (!rng.chance(0.78)) continue;
      if (idx >= crowd.seats.length) break;
      crowd.seats[idx].p.set(-(34 + r * 0.9), r * 0.5 + 0.5 + 0.5, zc - len / 2 + 0.5 + c * 0.7);
      idx++;
    }
  }
  crowd.mesh.count = idx;
  crowd.heads.count = idx;
  crowd.mesh.castShadow = false;
  g.add(crowd.mesh, crowd.heads);

  // Ball-stop netting behind the goal, a fixture of every hockey pitch.
  const netTex = netTexture();
  netTex.repeat.set(120, 14);
  const netMat = new THREE.MeshStandardMaterial({ color: 0x0f2a1c, map: netTex, alphaMap: netTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 1 });
  const stop = new THREE.Mesh(new THREE.PlaneGeometry(64, 7), netMat);
  stop.position.set(0, 3.5, 7.5);
  g.add(stop);
  for (let x = -32; x <= 32; x += 8) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.2, 6), mat('#2a3140', 0.5, 0.6));
    pole.position.set(x, 3.6, 7.5);
    g.add(pole);
  }
  // Spectators standing along the rail behind the boards.
  const railRng = new Rng(31);
  for (let x = -24; x <= 24 && idx < crowd.seats.length; x += railRng.range(0.6, 2.6)) {
    crowd.seats[idx].p.set(x, 0.8, railRng.range(5.6, 6.6));
    idx++;
  }
  crowd.mesh.count = idx;
  crowd.heads.count = idx;
  return g;
}

function buildClubhouse(): THREE.Group {
  const g = new THREE.Group();
  const brick = mat('#6b3a2e', 0.9);
  const house = new THREE.Mesh(new THREE.BoxGeometry(26, 7, 8), brick);
  house.position.set(46, 3.5, -12);
  house.rotation.y = Math.PI / 2;
  g.add(house);
  const win = windowsTexture();
  const wm = new THREE.MeshStandardMaterial({ map: win, emissiveMap: win, emissive: 0xffffff, emissiveIntensity: 1.6, transparent: true, alphaMap: win });
  const windows = new THREE.Mesh(new THREE.PlaneGeometry(24, 6), wm);
  windows.position.set(41.9, 3.5, -12);
  windows.rotation.y = -Math.PI / 2;
  g.add(windows);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(15, 3, 4), mat('#2a2a2e', 0.8));
  roof.position.set(46, 8.5, -12);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, 0.45);
  g.add(roof);
  return g;
}

function buildTrees(): THREE.Group {
  const g = new THREE.Group();
  const rng = new Rng(77);
  const leaf = [mat('#173d2d', 0.95), mat('#1f4a33', 0.95), mat('#12301f', 0.95)];
  const trunk = mat('#3b2a20', 0.95);
  const placeTree = (x: number, z: number) => {
    const h = rng.range(7, 12);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, h * 0.4, 6), trunk);
    t.position.set(x, h * 0.2, z);
    g.add(t);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(h * 0.32, 1), rng.pick(leaf));
    crown.position.set(x, h * 0.62, z);
    crown.scale.set(1, rng.range(1.1, 1.5), 1);
    g.add(crown);
  };
  for (let x = -110; x <= 110; x += rng.range(5, 9)) placeTree(x, rng.range(48, 64));
  for (let z = 20; z >= -110; z -= rng.range(6, 10)) {
    placeTree(-rng.range(58, 70), z);
    placeTree(rng.range(52, 66), z);
  }
  return g;
}
