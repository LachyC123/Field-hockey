import * as THREE from 'three';
import { BALL_RADIUS } from '../../core/pitch';

export function buildBall(): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(BALL_RADIUS, 3);
  // Dimples: nudge vertices in a little for a hockey ball's textured look.
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 400) * Math.sin(v.y * 400) * Math.sin(v.z * 400);
    v.multiplyScalar(1 - Math.max(0, n) * 0.06);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const ball = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xfaf8f0, roughness: 0.45, emissive: 0x222222 }));
  ball.castShadow = true;
  return ball;
}

/** Camera-facing ribbon that follows the ball. */
export class Trail {
  readonly mesh: THREE.Mesh;
  private points: THREE.Vector3[] = [];
  private geo: THREE.BufferGeometry;
  private max = 14;
  private opacity = 0;

  constructor(color = 0xffffff) {
    this.geo = new THREE.BufferGeometry();
    const pos = new Float32Array(this.max * 2 * 3);
    const alpha = new Float32Array(this.max * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    const idx: number[] = [];
    for (let i = 0; i < this.max - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 1 } },
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 color; uniform float opacity; varying float vA; void main(){ gl_FragColor = vec4(color, vA * opacity * 0.55); }`,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }

  reset(): void {
    this.points = [];
    this.opacity = 0;
  }

  push(p: THREE.Vector3, speed: number): void {
    this.points.unshift(p.clone());
    if (this.points.length > this.max) this.points.pop();
    this.opacity = Math.min(1, speed / 12);
  }

  fade(dt: number): void {
    this.opacity *= Math.exp(-dt * 4);
  }

  update(camera: THREE.Camera): void {
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const alpha = this.geo.attributes.alpha as THREE.BufferAttribute;
    const camPos = camera.position;
    const n = this.points.length;
    for (let i = 0; i < this.max; i++) {
      const p = this.points[Math.min(i, n - 1)] ?? new THREE.Vector3(0, -10, 0);
      const q = this.points[Math.min(i + 1, n - 1)] ?? p;
      const dir = new THREE.Vector3().subVectors(p, q);
      if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
      const toCam = new THREE.Vector3().subVectors(camPos, p).normalize();
      const side = new THREE.Vector3().crossVectors(dir.normalize(), toCam).normalize();
      const w = 0.014 * (1 - i / this.max);
      pos.setXYZ(i * 2, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      pos.setXYZ(i * 2 + 1, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
      const a = i < n ? (1 - i / this.max) ** 1.5 * 0.85 : 0;
      alpha.setX(i * 2, a);
      alpha.setX(i * 2 + 1, a);
    }
    pos.needsUpdate = true;
    alpha.needsUpdate = true;
    (this.mesh.material as THREE.ShaderMaterial).uniforms.opacity.value = this.opacity;
  }
}

/** Small CPU particle system for turf spray, chalk dust and confetti-ish sparks. */
export class Particles {
  readonly points: THREE.Points;
  private vel: THREE.Vector3[] = [];
  private life: number[] = [];
  private max = 260;
  private cursor = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.max * 3).fill(-999), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.max * 3), 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }),
    );
    this.points.frustumCulled = false;
    for (let i = 0; i < this.max; i++) {
      this.vel.push(new THREE.Vector3());
      this.life.push(0);
    }
  }

  burst(at: THREE.Vector3, count: number, speed: number, color: THREE.ColorRepresentation, up = 1, spread = 1): void {
    const pos = this.points.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.points.geometry.attributes.color as THREE.BufferAttribute;
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.cursor++ % this.max;
      pos.setXYZ(i, at.x, at.y, at.z);
      const v = new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * up, (Math.random() - 0.5) * spread).normalize();
      this.vel[i].copy(v.multiplyScalar(speed * (0.4 + Math.random() * 0.8)));
      this.life[i] = 0.5 + Math.random() * 0.6;
      const tint = 0.75 + Math.random() * 0.25;
      col.setXYZ(i, c.r * tint, c.g * tint, c.b * tint);
    }
    col.needsUpdate = true;
  }

  update(dt: number): void {
    const pos = this.points.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i].y -= 9.8 * dt;
      let y = pos.getY(i) + this.vel[i].y * dt;
      if (y < 0.01) {
        y = 0.01;
        this.vel[i].multiplyScalar(0.3);
      }
      pos.setXYZ(i, pos.getX(i) + this.vel[i].x * dt, y, pos.getZ(i) + this.vel[i].z * dt);
      if (this.life[i] <= 0) pos.setXYZ(i, 0, -999, 0);
    }
    pos.needsUpdate = true;
  }
}

/** The aiming reticle that floats on the goal plane. */
export class AimMarker {
  readonly group = new THREE.Group();
  private ring: THREE.Mesh;
  private dot: THREE.Mesh;
  private zone: THREE.Mesh;

  constructor() {
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xc8ff2e, transparent: true, opacity: 0.95, depthTest: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 40), ringMat);
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(0.04, 16), ringMat);
    this.ring.renderOrder = this.dot.renderOrder = 10;
    this.group.add(this.ring, this.dot);
    // Shaded band showing the heights this stroke can reach.
    this.zone = new THREE.Mesh(
      new THREE.PlaneGeometry(3.66, 1),
      new THREE.MeshBasicMaterial({ color: 0xc8ff2e, transparent: true, opacity: 0.1, depthWrite: false }),
    );
    this.zone.position.z = -0.02;
    this.group.visible = false;
  }

  get zoneMesh(): THREE.Mesh {
    return this.zone;
  }

  setZone(minY: number, maxY: number): void {
    this.zone.scale.y = Math.max(0.05, maxY - minY);
    this.zone.position.set(0, (minY + maxY) / 2, -0.02);
  }

  set(x: number, y: number, size: number, quality: number): void {
    this.group.position.set(x, y, -0.03);
    this.group.rotation.y = Math.PI;
    this.ring.scale.setScalar(size);
    const c = (this.ring.material as THREE.MeshBasicMaterial).color;
    c.setHSL(0.22 - (1 - quality) * 0.2, 1, 0.55);
  }
}
