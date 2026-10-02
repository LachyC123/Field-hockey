import * as THREE from 'three';
import { BALL_RADIUS, GOAL_HALF_WIDTH } from '../core/pitch';
import { Rng } from '../core/rng';
import { clampAim, simulateShot, strikeQuality, type ShotFrame, type ShotResult } from '../core/shot';
import { makePracticeShot, type PracticeShot } from '../core/situations';
import { STROKES, TUNING, type StrokeKey } from '../core/tuning';
import { getState, initialHud, onCommand, setHud, setState, type ShotLog } from '../app/store';
import { haptic, sfx } from '../audio/sfx';
import { Athlete, lerpPose, POSE_DEFAULT, type Look, type Pose } from './actors/athlete';
import type { Engine } from './engine';
import { AimMarker, buildBall, Particles, Trail } from './fx/fx';
import { BALL_LOCAL, KEEPER_SET, keeperPose, SHOOTER_POSES, strokePoses } from './poses';
import { buildStadium, type Stadium } from './scene/stadium';

type Phase = 'intro' | 'aim' | 'charging' | 'strike' | 'flight' | 'result' | 'replay' | 'done';

const HOME: Look = {
  skin: '#e9b892',
  hair: '#5a3b22',
  hairStyle: 'short',
  headband: '#c8ff2e',
  kit: { shirt: '#0e2a5c', shirtAccent: '#c8ff2e', shorts: '#0b1530', socks: '#0e2a5c', number: 9, name: 'You' },
  stick: { shaft: '#111318', accent: '#c8ff2e', grip: '#f4f4f4' },
};
const AWAY = (n: number, skin: string, hair: string): Look => ({
  skin,
  hair,
  hairStyle: n % 2 ? 'buzz' : 'short',
  kit: { shirt: '#c62a2a', shirtAccent: '#ffffff', shorts: '#ffffff', socks: '#c62a2a', number: n },
  stick: { shaft: '#e9e9e9', accent: '#c62a2a', grip: '#222' },
});
const KEEPER: Look = {
  skin: '#c98f68',
  hair: '#222',
  hairStyle: 'short',
  kit: { shirt: '#ffd400', shirtAccent: '#111', shorts: '#111', socks: '#ffd400', number: 1 },
  stick: { shaft: '#222', accent: '#ffd400', grip: '#111' },
  keeper: { pads: '#ffd400', helmet: '#f2f2f2', smock: '#ff7a00' },
};
const UMPIRE: Look = {
  skin: '#f0c8a8',
  hair: '#9a9a9a',
  hairStyle: 'buzz',
  kit: { shirt: '#ff4fa3', shirtAccent: '#111', shorts: '#111', socks: '#111', number: 0 },
  stick: { shaft: '#000', accent: '#000', grip: '#000' },
};

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

const TITLES: Record<string, [string, string]> = {
  'goal:backboard': ['GOAL!', 'Thud. Straight onto the backboard'],
  'goal:net': ['GOAL!', 'Into the roof of the net'],
  'goal:topBins': ['TOP BINS!', 'Flicked into the top corner'],
  'goal:postIn': ['GOAL!', 'In off the inside of the post'],
  'save:pads': ['SAVED', 'Kicked clear by the pads'],
  'save:glove': ['SAVED', 'Big glove save from the keeper'],
  'save:stick': ['SAVED', 'Stick save at full stretch'],
  'save:body': ['SAVED', 'Straight at the keeper'],
  'post:post': ['POST!', 'Rattled the post and away'],
  'wide:wide': ['WIDE', 'Dragged it past the post'],
  'over:over': ['OVER', 'Too much lift, over the bar'],
  'blocked:blocked': ['BLOCKED', 'Charged down by the defender'],
  tackled: ['TACKLED', 'Too slow. Clean jab tackle from the defender'],
};

export class PracticeMode {
  private stadium: Stadium;
  private shooter: Athlete;
  private keeper: Athlete;
  private defenders: Athlete[] = [];
  private defenderStart: THREE.Vector3[] = [];
  private umpire: Athlete;
  private ball = buildBall();
  private trail = new Trail();
  private particles = new Particles();
  private aim = new AimMarker();
  private rng = new Rng(Date.now() & 0xffffff);

  private mode: 'attract' | 'practice' = 'attract';
  private phase: Phase = 'intro';
  private phaseT = 0;
  private shot!: PracticeShot;
  private stroke: StrokeKey = 'push';
  private aimX = 0;
  private aimY = 0.1;
  private dragStart: { x: number; y: number; ax: number; ay: number } | null = null;
  private meterT = 0;
  private meter = 0;
  private pressure = 0;
  private wobblePhase = [0, 0, 0, 0];
  private release: { aimX: number; aimY: number; power: number; backswing: number } | null = null;
  private result: ShotResult | null = null;
  private playT = 0;
  private firedEvents = new Set<number>();
  private shotSeed = 0;
  private tackled = false;
  private attractTimer = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private lastChargeTick = 0;
  private snapCam = false;
  private celebrating = false;

  constructor(private engine: Engine) {
    const scene = engine.scene;
    this.stadium = buildStadium(scene, engine.renderer, engine.quality);
    this.shooter = new Athlete(HOME);
    this.keeper = new Athlete(KEEPER);
    this.umpire = new Athlete(UMPIRE);
    this.umpire.stick.visible = false;
    scene.add(this.shooter.root, this.keeper.root, this.umpire.root, this.ball, this.trail.mesh, this.particles.points, this.aim.group, this.aim.zoneMesh);
    (this.aim.zoneMesh.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
    this.aim.zoneMesh.visible = false;
    for (let i = 0; i < 2; i++) {
      const d = new Athlete(AWAY(4 + i * 3, i ? '#7a4a33' : '#f1c7a5', i ? '#111' : '#b0763d'));
      d.root.visible = false;
      this.defenders.push(d);
      scene.add(d.root);
    }
    this.umpire.root.position.set(16, 0, -9);
    this.umpire.root.rotation.y = -Math.PI / 2 - 0.3;
    this.umpire.setPose({ ...POSE_DEFAULT, crouch: 0.02, lean: 0.05, L: [0.25, 0.9, 0.1], H: [0.3, 0.3, 0.2] });

    engine.onFrame((dt, time, realDt) => this.update(dt, time, realDt));
    onCommand((c) => {
      if (c.type === 'stroke') this.setStroke(c.stroke);
      if (c.type === 'skipReplay' && (this.phase === 'replay' || this.phase === 'result')) this.next();
      if (c.type === 'startPractice') this.startPractice();
      if (c.type === 'quit') this.startAttract();
    });
    this.bindInput(engine.canvas);
    this.startAttract();
  }

  // ---- Modes -----------------------------------------------------------------------------------
  startAttract(): void {
    this.mode = 'attract';
    setState({ screen: 'title' });
    this.newShot();
  }

  startPractice(): void {
    this.mode = 'practice';
    sfx.unlock();
    setState({ screen: 'practice' });
    setHud({ ...initialHud(), total: 10 });
    this.newShot();
  }

  private newShot(): void {
    const difficulty = this.mode === 'practice' ? 0.35 + getState().hud.shot * 0.05 : 0.3;
    this.shot = makePracticeShot(this.rng, difficulty);
    const sit = this.shot.situation;
    this.stroke = this.shot.suggested;
    this.aimX = sit.ball.x > 0 ? -0.9 : 0.9;
    this.aimY = this.stroke === 'flick' ? 1.2 : 0.1;
    this.pressure = 0;
    this.meter = 0;
    this.release = null;
    this.result = null;
    this.tackled = false;
    this.playT = 0;
    this.firedEvents.clear();
    this.celebrating = false;
    this.trail.reset();
    this.wobblePhase = this.wobblePhase.map(() => this.rng.range(0, 100));

    // Place the cast
    this.ball.position.set(sit.ball.x, BALL_RADIUS, sit.ball.z);
    const yaw = Math.atan2(-sit.ball.x, -sit.ball.z);
    this.shooter.root.rotation.y = yaw;
    const off = new THREE.Vector3(...BALL_LOCAL).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.shooter.root.position.set(sit.ball.x - off.x, 0, sit.ball.z - off.z);
    this.shooter.setPose(SHOOTER_POSES.ready);

    this.keeper.root.position.set(sit.keeper.x, 0, sit.keeper.z);
    this.keeper.root.rotation.y = Math.atan2(sit.ball.x - sit.keeper.x, sit.ball.z - sit.keeper.z);
    this.keeper.setPose(KEEPER_SET);

    this.defenders.forEach((d, i) => {
      const spec = sit.defenders[i];
      d.root.visible = !!spec;
      if (!spec) return;
      d.root.position.set(spec.x, 0, spec.z);
      this.defenderStart[i] = d.root.position.clone();
      d.root.rotation.y = Math.atan2(sit.ball.x - spec.x, sit.ball.z - spec.z);
      d.setPose({ ...SHOOTER_POSES.ready, crouch: 0.4, H: [-0.2, 0.04, 0.8] });
    });

    this.setPhase('intro');
    const cam = this.behindCam();
    // Start wide from the touchline like a broadcast cut, then swoop in.
    this.camPos.set(cam.pos.x - 14 * Math.sign(sit.ball.x || 1), 9, cam.pos.z - 10);
    this.camLook.copy(this.ball.position);
    if (this.mode === 'practice') {
      setHud({
        phase: 'intro',
        shot: getState().hud.shot + 1,
        context: this.shot.context,
        stroke: this.stroke,
        suggested: this.shot.suggested,
        result: null,
        pressure: 0,
        meter: 0,
        sweet: STROKES[this.stroke].sweet,
        keeperRating: sit.keeper.rating,
      });
      sfx.crowd('rise');
    }
  }

  private setStroke(s: StrokeKey): void {
    if (this.phase !== 'aim' && this.phase !== 'intro') return;
    this.stroke = s;
    const sp = STROKES[s];
    this.aimY = Math.min(sp.maxAimHeight, Math.max(sp.minAimHeight, s === 'flick' ? 1.2 : 0.1));
    setHud({ stroke: s, sweet: sp.sweet });
    sfx.ui('select');
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseT = 0;
    if (p === 'replay') this.snapCam = true;
    if (this.mode === 'practice') {
      const map: Record<Phase, ReturnType<typeof getState>['hud']['phase']> = {
        intro: 'intro',
        aim: 'aim',
        charging: 'charging',
        strike: 'flight',
        flight: 'flight',
        result: 'result',
        replay: 'replay',
        done: 'idle',
      };
      setHud({ phase: map[p] });
    }
  }

  // ---- Input -----------------------------------------------------------------------------------
  private bindInput(el: HTMLElement): void {
    el.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'practice') return;
      sfx.unlock();
      if (this.phase === 'replay' || (this.phase === 'result' && this.phaseT > 0.6)) {
        this.next();
        return;
      }
      if (this.phase === 'intro' && this.phaseT > 0.5) this.setPhase('aim');
      if (this.phase !== 'aim') return;
      el.setPointerCapture(e.pointerId);
      if (getState().showHelp) setState({ showHelp: false });
      this.dragStart = { x: e.clientX, y: e.clientY, ax: this.aimX, ay: this.aimY };
      this.meterT = 0;
      this.lastChargeTick = 0;
      this.setPhase('charging');
      haptic(8);
    });
    el.addEventListener('pointermove', (e) => {
      if (this.phase !== 'charging' || !this.dragStart) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const dx = (e.clientX - this.dragStart.x) / w;
      const dy = (e.clientY - this.dragStart.y) / h;
      // The camera looks toward +Z from behind, so screen-right is world -X.
      const [ax, ay] = clampAim(this.stroke, this.dragStart.ax - dx * 5, this.dragStart.ay - dy * 5);
      this.aimX = ax;
      this.aimY = ay;
    });
    const up = () => {
      if (this.phase !== 'charging') return;
      this.dragStart = null;
      this.strike();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  private wobble(t: number): [number, number] {
    const sit = this.shot.situation;
    const skill = this.stroke === 'flick' ? sit.shooter.flicking : sit.shooter.shooting;
    const amp = TUNING.shooter.wobble * (1 - skill / 120) * (1 - sit.confidence / 200) * (0.45 + this.pressure * 0.9) * (0.6 + this.meter * 0.5);
    const p = this.wobblePhase;
    return [
      amp * (Math.sin(t * 1.7 + p[0]) * 0.6 + Math.sin(t * 3.1 + p[1]) * 0.4),
      amp * 0.6 * (Math.sin(t * 2.3 + p[2]) * 0.6 + Math.sin(t * 4.1 + p[3]) * 0.4),
    ];
  }

  private currentAim(time: number): [number, number] {
    const [wx, wy] = this.wobble(time);
    return clampAim(this.stroke, this.aimX + wx, this.aimY + wy);
  }

  // ---- Shot ------------------------------------------------------------------------------------
  private strike(): void {
    const [ax, ay] = this.currentAim(this.engine.time);
    const power = this.meter;
    this.release = { aimX: ax, aimY: ay, power, backswing: Math.min(1, this.meter) };
    this.shotSeed = this.shot.seed ^ Math.floor(power * 1000);
    this.result = simulateShot(this.shot.situation, { stroke: this.stroke, aimX: ax, aimY: ay, power }, this.shotSeed);
    this.playT = -STROKES[this.stroke].strikeDelay;
    this.firedEvents.clear();
    this.trail.reset();
    this.aim.group.visible = false;
    this.aim.zoneMesh.visible = false;
    this.setPhase('strike');
    if (this.mode === 'practice') {
      const q = strikeQuality(this.stroke, power);
      if (q === 'perfect') sfx.ui('perfect');
    }
  }

  private tackle(): void {
    this.tackled = true;
    sfx.stickClash();
    haptic([20, 30, 20]);
    sfx.crowd('groan');
    this.engine.addShake(0.4);
    const d = this.defenders.find((x) => x.root.visible);
    const away = new THREE.Vector3(this.rng.range(-1, 1), 0, -1).normalize();
    this.ball.userData.vel = away.multiplyScalar(6);
    if (d) d.setPose({ ...d.getPose(), crouch: 0.6, lean: 0.7, H: [-0.3, 0.04, 1.4] });
    this.finish('tackled');
  }

  private finish(key: string): void {
    this.setPhase('result');
    if (this.mode !== 'practice') return;
    const r = this.result;
    const q = r ? r.quality : 'scuffed';
    const isGoal = r?.outcome === 'goal' && !this.tackled;
    let points = 0;
    const hud = getState().hud;
    if (isGoal) {
      points = 100 + (r!.detail === 'topBins' ? 50 : 0) + (r!.detail === 'backboard' ? 20 : 0) + (q === 'perfect' ? 30 : 0);
      points = Math.round(points * (1 + hud.streak * 0.1));
    } else if (r?.outcome === 'save' && !this.tackled) points = 10;
    const [title, sub] = TITLES[key] ?? ['MISS', ''];
    const streak = isGoal ? hud.streak + 1 : 0;
    const entry: ShotLog = {
      outcome: this.tackled ? 'tackled' : r!.outcome,
      title,
      stroke: this.stroke,
      quality: q,
      speedKmh: r?.speedKmh ?? 0,
      points,
    };
    setHud({
      result: {
        title,
        sub,
        tone: isGoal ? 'goal' : r?.outcome === 'save' ? 'save' : 'miss',
        quality: this.tackled ? undefined : q,
        points,
        speed: this.tackled ? undefined : r?.speedKmh,
      },
      goals: hud.goals + (isGoal ? 1 : 0),
      score: hud.score + points,
      streak,
      bestStreak: Math.max(hud.bestStreak, streak),
      log: [...hud.log, entry],
    });
  }

  private next(): void {
    if (this.mode === 'practice' && getState().hud.shot >= getState().hud.total) {
      this.setPhase('done');
      sfx.whistle(true);
      setState({ screen: 'results' });
      this.mode = 'attract';
      this.newShot();
      return;
    }
    this.engine.timeScale = 1;
    this.newShot();
  }

  // ---- Frame -----------------------------------------------------------------------------------
  private sampleFrame(t: number): ShotFrame | null {
    const f = this.result?.frames;
    if (!f || !f.length) return null;
    if (t <= f[0].t) return f[0];
    const dt = f[1] ? f[1].t - f[0].t : 1 / 60;
    const i = Math.min(f.length - 2, Math.floor((t - f[0].t) / dt));
    if (i < 0) return f[0];
    const a = f[i];
    const b = f[i + 1];
    const u = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    return {
      t,
      ball: [a.ball[0] + (b.ball[0] - a.ball[0]) * u, a.ball[1] + (b.ball[1] - a.ball[1]) * u, a.ball[2] + (b.ball[2] - a.ball[2]) * u],
      keeperX: a.keeperX + (b.keeperX - a.keeperX) * u,
      keeperDive: a.keeperDive + (b.keeperDive - a.keeperDive) * u,
      keeperReach: a.keeperReach + (b.keeperReach - a.keeperReach) * u,
      defenderLunge: a.defenderLunge,
    };
  }

  /** Shooter pose as a function of time since release (negative = still in the backswing). */
  private shooterPoseAt(tRel: number): Pose {
    const poses = strokePoses(this.stroke);
    const delay = STROKES[this.stroke].strikeDelay;
    const back = lerpPose(SHOOTER_POSES.ready, poses.back, this.release?.backswing ?? 1);
    if (tRel < -delay) return back;
    if (tRel < 0) return lerpPose(back, poses.contact, ease((tRel + delay) / delay));
    if (tRel < 0.3) return lerpPose(poses.contact, poses.through, easeOut(tRel / 0.3));
    return poses.through;
  }

  private behindCam(): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const b = new THREE.Vector3(this.shot.situation.ball.x, 0, this.shot.situation.ball.z);
    const toGoal = new THREE.Vector3(-b.x, 0, -b.z).normalize();
    const left = new THREE.Vector3(toGoal.z, 0, -toGoal.x); // shooter's left
    // Over the right shoulder (the ball side), high enough to see the keeper over the shooter.
    const pos = b.clone().addScaledVector(toGoal, -4.0).addScaledVector(left, -0.75).setY(2.15);
    const look = new THREE.Vector3(0, 0.8, 0).lerp(b, 0.22);
    return { pos, look };
  }

  private update(dt: number, time: number, realDt: number): void {
    this.phaseT += realDt;
    const cam = this.engine.camera;
    const sit = this.shot.situation;
    let targetPos = this.behindCam().pos;
    let targetLook = this.behindCam().look;
    let camLerp = 1 - Math.exp(-realDt * 5);

    if (this.mode === 'attract') this.updateAttract(realDt);

    switch (this.phase) {
      case 'intro': {
        camLerp = 1 - Math.exp(-realDt * 3.2);
        if (this.mode === 'practice' && this.phaseT > 1.1) this.setPhase('aim');
        break;
      }
      case 'aim':
      case 'charging': {
        this.pressure += (realDt / this.shot.pressureTime) * (this.mode === 'practice' ? 1 : 0);
        if (this.phase === 'charging') {
          const sp = STROKES[this.stroke];
          this.meterT += realDt;
          // Ping-pong 0 → 1.12 → 0: holding too long overcooks it, then it falls back.
          const cyc = (this.meterT / sp.chargeTime) % 2.24;
          this.meter = cyc <= 1.12 ? cyc : 2.24 - cyc;
          const tick = Math.floor(this.meter * 8);
          if (tick !== this.lastChargeTick) {
            this.lastChargeTick = tick;
            sfx.charge(this.meter);
          }
          targetPos = targetPos.clone().lerp(targetLook, 0.05 * this.meter);
        }
        const [ax, ay] = this.currentAim(time);
        const sp = STROKES[this.stroke];
        const q = this.phase === 'charging' ? (this.meter >= sp.sweet[0] && this.meter <= sp.sweet[1] ? 1 : 0.35) : 0.7;
        this.aim.set(ax, ay, 0.8 + (1 - this.pressure) * 0.3, q);
        this.aim.group.visible = this.mode === 'practice';
        this.aim.setZone(sp.minAimHeight, sp.maxAimHeight);
        this.aim.zoneMesh.visible = this.mode === 'practice';
        this.aim.zoneMesh.rotation.y = Math.PI;
        this.shooter.setPose(this.phase === 'charging' ? lerpPose(SHOOTER_POSES.ready, strokePoses(this.stroke).back, Math.min(1, this.meter)) : SHOOTER_POSES.ready);
        // Defenders close you down
        this.defenders.forEach((d, i) => {
          if (!d.root.visible) return;
          const start = this.defenderStart[i];
          const toBall = new THREE.Vector3(sit.ball.x - start.x, 0, sit.ball.z - start.z);
          const dist = toBall.length();
          const travel = Math.min(this.pressure, 1) * Math.max(0, dist - 1.3);
          d.root.position.copy(start).addScaledVector(toBall.normalize(), travel);
          d.setPose(lerpPose(d.getPose(), { ...SHOOTER_POSES.ready, crouch: 0.45, lean: 0.55, stepL: Math.sin(time * 9) * 0.25 * (travel > 0 ? 1 : 0), stepR: -Math.sin(time * 9) * 0.25 * (travel > 0 ? 1 : 0), H: [-0.25, 0.04, 0.85] }, 0.3));
        });
        if (this.mode === 'practice') {
          setHud({ meter: this.meter, pressure: Math.min(1, this.pressure) });
          if (this.pressure >= 1) this.tackle();
        }
        break;
      }
      case 'strike':
      case 'flight': {
        this.playT += dt;
        this.shooter.setPose(this.shooterPoseAt(this.playT));
        if (this.playT >= 0 && this.phase === 'strike') {
          this.setPhase('flight');
          sfx.strike(this.stroke, this.release!.power);
          haptic(this.stroke === 'hit' ? 35 : 18);
          this.engine.hitStop(this.stroke === 'hit' ? 0.09 : 0.05);
          this.engine.kickFov(this.stroke === 'hit' ? -6 : -3);
          this.engine.addShake(this.stroke === 'hit' ? 0.35 : 0.15);
          this.particles.burst(this.ball.position, 14, 2.5, 0x6f9bff, 0.6);
        }
        if (this.phase === 'flight') this.playBall(true);
        const r = this.result!;
        // Drama: slow-mo as a close call reaches the keeper
        const f = this.sampleFrame(this.playT);
        const close = r.outcome === 'save' || r.outcome === 'post' || r.detail === 'topBins' || r.detail === 'postIn';
        if (f && close && Math.abs(f.ball[2] - sit.keeper.z) < 1.4 && this.playT < r.resolveTime + 0.15) this.engine.timeScale = 0.28;
        else this.engine.timeScale = 1;
        // Camera follows the ball a touch
        if (f) {
          const bp = new THREE.Vector3(...f.ball);
          targetLook = targetLook.clone().lerp(bp, 0.35);
          targetPos = targetPos.clone().lerp(bp.clone().setY(1.6), 0.08);
        }
        if (this.playT > r.resolveTime + 0.35) {
          this.engine.timeScale = 1;
          this.finish(`${r.outcome}:${r.detail}`);
          this.onResult(r);
        }
        break;
      }
      case 'result': {
        if (this.tackled) {
          const v = this.ball.userData.vel as THREE.Vector3 | undefined;
          if (v) {
            this.ball.position.addScaledVector(v, dt);
            v.multiplyScalar(Math.exp(-dt * 1.5));
          }
        } else {
          this.playT += dt;
          this.playBall(false);
        }
        const goal = this.result?.outcome === 'goal' && !this.tackled;
        const pose = goal ? SHOOTER_POSES.celebrate : SHOOTER_POSES.dejected;
        const blend = easeOut(this.phaseT / 0.5);
        const p = lerpPose(this.shooter.getPose(), pose, blend * 0.25);
        if (goal) p.drop = -Math.abs(Math.sin(this.phaseT * 7)) * 0.18 * Math.max(0, 1 - this.phaseT / 2.2);
        this.shooter.setPose(p);
        if (goal && this.phaseT > 0.5) {
          // Cut to the celebration, framed from in front of the shooter.
          const s = this.shooter.root;
          const fwd = new THREE.Vector3(Math.sin(s.rotation.y), 0, Math.cos(s.rotation.y));
          targetPos = s.position.clone().addScaledVector(fwd, 3.4).setY(1.35).add(new THREE.Vector3(fwd.z, 0, -fwd.x).multiplyScalar(0.8));
          targetLook = s.position.clone().setY(1.25);
          camLerp = this.celebrating ? 1 - Math.exp(-realDt * 2) : 1;
          this.celebrating = true;
        }
        const wantsReplay = !this.tackled && this.result && (this.result.outcome === 'goal' || this.result.outcome === 'post' || (this.result.outcome === 'save' && this.result.detail !== 'body'));
        const hold = this.mode === 'attract' ? 2.4 : 2.2;
        if (this.phaseT > hold) {
          if (wantsReplay && this.mode === 'practice') this.startReplay();
          else if (this.mode === 'attract') this.newShot();
        }
        break;
      }
      case 'replay': {
        this.playT += dt;
        this.shooter.setPose(this.shooterPoseAt(this.playT));
        this.playBall(false);
        const r = this.result!;
        const f = this.sampleFrame(this.playT);
        const side = sit.ball.x >= 0 ? 1 : -1;
        targetPos = new THREE.Vector3(side * 2.6, 1.2, 3.8);
        targetLook = f ? new THREE.Vector3(...f.ball).lerp(new THREE.Vector3(0, 0.6, 0), 0.2) : this.ball.position.clone();
        camLerp = this.snapCam ? 1 : 1 - Math.exp(-realDt * 6);
        this.snapCam = false;
        if (this.playT > r.resolveTime + 0.9) this.next();
        break;
      }
      default:
        break;
    }

    // Keeper and defenders follow the sim during play and replays
    const f = this.result && (this.phase === 'flight' || this.phase === 'result' || this.phase === 'replay') ? this.sampleFrame(Math.max(0, this.playT)) : null;
    if (f && !this.tackled) {
      this.keeper.root.position.x = f.keeperX;
      // The keeper faces the shooter, so their local left is world -X.
      this.keeper.setPose(keeperPose(-f.keeperDive, f.keeperReach));
      this.defenders.forEach((d, i) => {
        if (!d.root.visible) return;
        const l = f.defenderLunge[i] ?? 0;
        d.setPose(lerpPose(d.getPose(), { ...SHOOTER_POSES.ready, crouch: 0.55, lean: 0.7, stepL: 0.4, H: [-0.6 * l, 0.04, 0.9 + l * 0.5] }, 0.4));
      });
    } else if (this.phase !== 'result') {
      // Keeper shuffles on their toes, tracking the ball.
      const k = this.keeper.getPose();
      this.keeper.setPose({ ...KEEPER_SET, stepL: Math.sin(time * 6) * 0.04, stepR: -Math.sin(time * 6) * 0.04, freeHand: k.freeHand ?? KEEPER_SET.freeHand });
      this.keeper.root.position.x = sit.keeper.x + Math.sin(time * 1.3) * 0.05;
    }

    this.shooter.update(dt);
    this.keeper.update(dt);
    this.umpire.update(dt);
    this.defenders.forEach((d) => d.root.visible && d.update(dt));
    this.particles.update(dt);
    this.trail.fade(dt);
    this.trail.update(cam);
    this.stadium.update(dt, time);

    this.camPos.lerp(targetPos, camLerp);
    this.camLook.lerp(targetLook, camLerp);
    if (this.mode === 'attract' && this.phase !== 'result') {
      // Slow orbit for the title screen
      const a = time * 0.06;
      const r = 9;
      this.camPos.set(Math.sin(a) * r, 2.6 + Math.sin(time * 0.2) * 0.4, -6 - Math.cos(a) * r * 0.6);
      this.camLook.set(0, 0.9, -3);
    }
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
  }

  private playBall(live: boolean): void {
    const r = this.result!;
    const f = this.sampleFrame(Math.max(0, this.playT));
    if (!f) return;
    const prev = this.ball.position.clone();
    this.ball.position.set(...f.ball);
    const speed = prev.distanceTo(this.ball.position) / Math.max(1e-4, 1 / 60);
    if (this.playT > 0) this.trail.push(this.ball.position, speed);
    this.ball.rotation.x += speed * 0.02;
    r.events.forEach((e, i) => {
      if (this.firedEvents.has(i) || e.t > this.playT || e.type === 'strike') return;
      this.firedEvents.add(i);
      const at = new THREE.Vector3(...e.pos);
      const loud = live ? 1 : 0.55;
      switch (e.type) {
        case 'backboard':
          sfx.backboard(e.strength * loud);
          this.engine.addShake(0.5 * loud);
          this.engine.flashScreen(0.12 * loud, 0.6 * loud);
          this.particles.burst(at, 30, 3, 0xffffff, 1.2);
          haptic([30, 20, 50]);
          break;
        case 'net':
          sfx.net(e.strength * loud);
          this.stadium.net.hit(e.pos[0], e.pos[1], e.strength);
          this.engine.addShake(0.25 * loud);
          break;
        case 'post':
        case 'crossbar':
          sfx.post(e.strength * loud);
          this.engine.addShake(0.45 * loud);
          this.particles.burst(at, 12, 2, 0xffffff);
          haptic(40);
          break;
        case 'save':
          sfx.pad(e.strength * loud);
          this.engine.addShake(0.3 * loud);
          this.particles.burst(at, 16, 2, 0xffd400, 1);
          break;
        case 'block':
          sfx.stickClash();
          this.engine.addShake(0.3 * loud);
          break;
        case 'bounce':
          sfx.bounce(e.strength * loud);
          this.particles.burst(at, 6, 1.2, 0x6f9bff, 0.5);
          break;
        default:
          break;
      }
    });
    if (r.outcome === 'goal' && this.playT > r.resolveTime && this.playT < r.resolveTime + 0.1 && !this.firedEvents.has(-1)) {
      this.firedEvents.add(-1);
      this.stadium.net.hit(f.ball[0], Math.max(0.6, f.ball[1]), 0.6);
    }
  }

  private onResult(r: ShotResult): void {
    if (this.mode !== 'practice') {
      if (r.outcome === 'goal') this.stadium.crowd.setExcitement(0.8);
      return;
    }
    if (r.outcome === 'goal') {
      sfx.crowd('roar');
      sfx.whistle();
      this.stadium.crowd.setExcitement(1);
      haptic([40, 40, 80]);
    } else if (r.outcome === 'save' || r.outcome === 'post') {
      sfx.crowd('ooh');
      this.stadium.crowd.setExcitement(0.4);
    } else sfx.crowd('groan');
  }

  private startReplay(): void {
    this.playT = -STROKES[this.stroke].strikeDelay - 0.35;
    this.firedEvents.clear();
    this.trail.reset();
    this.ball.position.set(this.shot.situation.ball.x, BALL_RADIUS, this.shot.situation.ball.z);
    this.engine.timeScale = 0.45;
    this.setPhase('replay');
  }

  // ---- Title-screen attract loop ----------------------------------------------------------------
  private updateAttract(dt: number): void {
    if (this.phase === 'intro') {
      this.attractTimer += dt;
      if (this.attractTimer > 1.6) {
        this.attractTimer = 0;
        this.setPhase('aim');
      }
    } else if (this.phase === 'aim') {
      this.attractTimer += dt;
      if (this.attractTimer > 0.4) {
        this.attractTimer = 0;
        this.stroke = this.rng.pick(['push', 'flick', 'hit'] as const);
        const sp = STROKES[this.stroke];
        this.aimX = this.rng.pick([-1, 1]) * this.rng.range(1.0, GOAL_HALF_WIDTH - 0.25);
        this.aimY = this.rng.range(sp.minAimHeight, sp.maxAimHeight);
        this.meter = (sp.sweet[0] + sp.sweet[1]) / 2;
        this.setPhase('charging');
        this.meterT = 0;
      }
    } else if (this.phase === 'charging') {
      this.attractTimer += dt;
      const sp = STROKES[this.stroke];
      if (this.attractTimer > sp.chargeTime) {
        this.attractTimer = 0;
        this.meter = (sp.sweet[0] + sp.sweet[1]) / 2;
        this.strike();
      }
    }
  }
}
