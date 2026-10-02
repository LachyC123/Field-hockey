import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export type Quality = 'low' | 'medium' | 'high';

/** Vignette + subtle colour grade, applied after tone mapping. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    vignette: { value: 0.32 },
    flash: { value: 0 },
    aberration: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignette;
    uniform float flash;
    uniform float aberration;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - 0.5;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + dir * aberration).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - dir * aberration).b;
      // Gentle teal/orange split: lift shadows cool, keep highlights warm.
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * vec3(0.94, 1.0, 1.08), (1.0 - l) * 0.35);
      col = mix(col, col * vec3(1.05, 1.0, 0.95), l * 0.25);
      col = (col - 0.5) * 1.06 + 0.5;
      float v = smoothstep(0.85, 0.2, length(dir * vec2(1.0, 0.85)));
      col *= mix(1.0 - vignette, 1.0, v);
      col = mix(col, vec3(1.0), flash);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly quality: Quality;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private listeners: ((dt: number, time: number, realDt: number) => void)[] = [];
  private last = performance.now();
  private hitstop = 0;
  private shake = 0;
  private flash = 0;
  private aberration = 0;
  timeScale = 1;
  time = 0;
  /** Base FOV the camera returns to after kicks. */
  baseFov = 52;
  private fovKick = 0;
  private running = false;
  fps = 60;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.quality = detectQuality();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    const pr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = this.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.1, 5000);
    const size = new THREE.Vector2(canvas.clientWidth || 390, canvas.clientHeight || 844);
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: this.quality === 'low' ? 0 : 4,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(size, 0.55, 0.6, 0.92);
    if (this.quality !== 'low') this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  onFrame(fn: (dt: number, time: number, realDt: number) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      this.frame();
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
  }

  /** Freeze the simulation briefly for impact weight. */
  hitStop(seconds: number): void {
    this.hitstop = Math.max(this.hitstop, seconds);
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  kickFov(deg: number): void {
    this.fovKick = deg;
  }

  flashScreen(amount: number, aberration = 0): void {
    this.flash = Math.max(this.flash, amount);
    this.aberration = Math.max(this.aberration, aberration);
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    // Portrait screens need a wider vertical FOV to keep the goal in view.
    this.baseFov = w / h < 0.8 ? 62 : 48;
    this.camera.updateProjectionMatrix();
  }

  private frame(): void {
    const now = performance.now();
    const realDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.fps = this.fps * 0.95 + (1 / Math.max(realDt, 1e-3)) * 0.05;
    let dt = realDt * this.timeScale;
    if (this.hitstop > 0) {
      this.hitstop -= realDt;
      dt = 0;
    }
    this.time += dt;
    for (const l of this.listeners) l(dt, this.time, realDt);

    // Camera shake and FOV kick are applied on top of whatever the controllers set this frame.
    this.fovKick *= Math.exp(-realDt * 7);
    this.camera.fov = this.baseFov + this.fovKick;
    this.camera.updateProjectionMatrix();
    const savedPos = this.camera.position.clone();
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.12;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-realDt * 6);
    }
    this.flash *= Math.exp(-realDt * 9);
    this.aberration *= Math.exp(-realDt * 6);
    this.grade.uniforms.flash.value = this.flash;
    this.grade.uniforms.aberration.value = this.aberration * 0.012;
    this.composer.render(realDt);
    this.camera.position.copy(savedPos);
  }
}

function detectQuality(): Quality {
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'low' || q === 'medium' || q === 'high') return q;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency || 4;
  if (!mobile && cores >= 8) return 'high';
  if (mobile && cores <= 4) return 'low';
  return 'medium';
}
