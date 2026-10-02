import { Rng } from './rng';
import {
  BACKBOARD_HEIGHT,
  BALL_RADIUS,
  GOAL_DEPTH,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  POST_RADIUS,
} from './pitch';
import { STROKES, TUNING, type StrokeKey } from './tuning';

export type Vec3 = [number, number, number];
const v3 = (p: Vec3): Vec3 => [p[0], p[1], p[2]];

export interface ShotSituation {
  ball: { x: number; z: number };
  keeper: { x: number; z: number; rating: number };
  defenders: { x: number; z: number }[];
  shooter: { shooting: number; flicking: number; composure: number };
  confidence: number; // 0..100
}

export interface ShotInput {
  stroke: StrokeKey;
  /** Target point on the goal plane (z = 0). */
  aimX: number;
  aimY: number;
  /** Power meter value at release, 0..1. */
  power: number;
}

export type Outcome = 'goal' | 'save' | 'post' | 'wide' | 'over' | 'blocked';
export type OutcomeDetail =
  | 'backboard'
  | 'net'
  | 'topBins'
  | 'postIn'
  | 'pads'
  | 'stick'
  | 'glove'
  | 'body'
  | 'wide'
  | 'over'
  | 'post'
  | 'blocked';

export type StrikeQuality = 'perfect' | 'clean' | 'scuffed' | 'overcooked';

export interface ShotEvent {
  t: number;
  type: 'strike' | 'save' | 'post' | 'crossbar' | 'backboard' | 'net' | 'block' | 'bounce' | 'line';
  pos: Vec3;
  strength: number;
}

export interface ShotFrame {
  t: number;
  ball: Vec3;
  /** Keeper body centre x. */
  keeperX: number;
  /** -1..1: how far and which way the keeper is diving. */
  keeperDive: number;
  /** 0..1: how high the keeper is reaching. */
  keeperReach: number;
  /** 0..1 lunge of each defender toward the ball. */
  defenderLunge: number[];
}

export interface ShotResult {
  outcome: Outcome;
  detail: OutcomeDetail;
  quality: StrikeQuality;
  speedKmh: number;
  /** Time the ball crosses the goal line or is stopped. */
  resolveTime: number;
  frames: ShotFrame[];
  events: ShotEvent[];
  launch: Vec3;
}

export function strikeQuality(stroke: StrokeKey, power: number): StrikeQuality {
  const [lo, hi] = STROKES[stroke].sweet;
  const mid = (lo + hi) / 2;
  if (power > hi) return 'overcooked';
  if (power >= lo) return Math.abs(power - mid) < (hi - lo) * 0.22 ? 'perfect' : 'clean';
  return 'scuffed';
}

/** Clamp an aim point to what the stroke can reach. */
export function clampAim(stroke: StrokeKey, x: number, y: number): [number, number] {
  const s = STROKES[stroke];
  return [
    Math.max(-GOAL_HALF_WIDTH - 1.2, Math.min(GOAL_HALF_WIDTH + 1.2, x)),
    Math.max(s.minAimHeight, Math.min(s.maxAimHeight, y)),
  ];
}

function skillFor(stroke: StrokeKey, sit: ShotSituation): number {
  return stroke === 'flick' ? sit.shooter.flicking : sit.shooter.shooting;
}

/** Launch velocity for a shot before random error. */
function aimVelocity(from: Vec3, tx: number, ty: number, speed: number, ground: boolean): Vec3 {
  const dx = tx - from[0];
  const dz = 0 - from[2];
  const d = Math.hypot(dx, dz);
  const ux = dx / d;
  const uz = dz / d;
  if (ground) return [ux * speed, 0, uz * speed];
  // Drag slows the ball a little over the flight; compensate so the aim height is roughly right.
  const vh = speed * 0.94;
  const t = d / (vh * (1 - TUNING.airDrag * speed * 0.5 * (d / vh)));
  const vy = (ty - from[1] + 0.5 * TUNING.gravity * t * t) / t;
  return [ux * vh, vy, uz * vh];
}

/**
 * Resolve a shot completely and deterministically. The renderer plays the returned frames back,
 * so live play, replays and tests all see the same thing.
 */
export function simulateShot(sit: ShotSituation, input: ShotInput, seed: number): ShotResult {
  const rng = new Rng(seed);
  const stroke = STROKES[input.stroke];
  const quality = strikeQuality(input.stroke, input.power);
  const [aimX, aimY] = clampAim(input.stroke, input.aimX, input.aimY);
  const skill = skillFor(input.stroke, sit);

  // ---- Launch ---------------------------------------------------------------------------------
  const power = Math.min(1, input.power);
  const speed = stroke.minSpeed + (stroke.maxSpeed - stroke.minSpeed) * power;
  let errScale = 1 - skill / 130;
  errScale *= 1 - (sit.confidence - 50) / 400;
  if (quality === 'perfect') errScale *= 0.45;
  if (quality === 'scuffed') errScale *= TUNING.shooter.offSweetError;
  if (quality === 'overcooked')
    errScale *= TUNING.shooter.offSweetError + (input.power - stroke.sweet[1]) * 10 * TUNING.shooter.overpowerError;
  const yawErr = rng.gauss() * stroke.baseError * errScale;
  const pitchErr = rng.gauss() * stroke.baseError * errScale * (input.stroke === 'flick' ? 0.9 : 0.25);

  const ground = input.stroke !== 'flick' && aimY < 0.16;
  const from: Vec3 = [sit.ball.x, BALL_RADIUS, sit.ball.z];
  const v0 = aimVelocity(from, aimX, aimY, speed, ground);
  const cos = Math.cos(yawErr);
  const sin = Math.sin(yawErr);
  const vel: Vec3 = [v0[0] * cos - v0[2] * sin, v0[1] + pitchErr * speed, v0[0] * sin + v0[2] * cos];
  if (quality === 'overcooked' && input.stroke !== 'push') vel[1] += (input.power - stroke.sweet[1]) * 14;
  if (input.stroke === 'hit' && !ground) vel[1] = Math.min(vel[1], 3.2);
  const launch: Vec3 = v3(vel);

  // ---- Keeper read ----------------------------------------------------------------------------
  const k = TUNING.keeper;
  const kr = sit.keeper.rating;
  const reaction = Math.max(0.1, k.baseReaction - kr * k.reactionPerRating + stroke.readBonus + rng.gauss() * 0.03);
  const predicted = predictCrossing(v3(from), v3(vel), sit.keeper.z);
  const guessNoise = k.readNoise * (1 - kr / 120) * (0.6 + speed / 40);
  const guessX = predicted.x + rng.gauss() * guessNoise;
  const guessY = predicted.y + rng.gauss() * guessNoise * 0.5;
  const diveSpeed = k.diveSpeed + kr * k.diveSpeedPerRating;
  const k0 = sit.keeper.x;
  let kx = k0;

  // ---- Integrate ------------------------------------------------------------------------------
  const pos: Vec3 = v3(from);
  const frames: ShotFrame[] = [];
  const events: ShotEvent[] = [];
  const lunge = sit.defenders.map(() => 0);
  let outcome: Outcome | null = null;
  let detail: OutcomeDetail = 'wide';
  let resolveTime: number = TUNING.maxSimTime;
  let crossedKeeper = false;
  const crossedDefender = sit.defenders.map(() => false);
  let inGoal = false;
  let touchedPost = false;
  let stopAt: number = TUNING.maxSimTime;
  const dt = TUNING.dt;
  let step = 0;
  events.push({ t: 0, type: 'strike', pos: v3(from), strength: speed / 33 });

  for (let t = 0; t < stopAt; t += dt, step++) {
    const prev: Vec3 = v3(pos);

    // Ball dynamics
    const sp = Math.hypot(vel[0], vel[1], vel[2]);
    const drag = TUNING.airDrag * sp;
    vel[0] -= vel[0] * drag * dt;
    vel[2] -= vel[2] * drag * dt;
    const airborne = pos[1] > BALL_RADIUS + 0.002 || vel[1] > 0.01;
    if (airborne) {
      vel[1] -= TUNING.gravity * dt;
      vel[1] -= vel[1] * drag * dt;
    } else {
      const hs = Math.hypot(vel[0], vel[2]);
      if (hs > 0) {
        const ns = Math.max(0, hs - TUNING.groundFriction * dt);
        vel[0] *= ns / hs;
        vel[2] *= ns / hs;
      }
    }
    pos[0] += vel[0] * dt;
    pos[1] += vel[1] * dt;
    pos[2] += vel[2] * dt;
    if (pos[1] < BALL_RADIUS) {
      pos[1] = BALL_RADIUS;
      if (vel[1] < -1.2) {
        events.push({ t, type: 'bounce', pos: v3(pos), strength: Math.min(1, -vel[1] / 8) });
        vel[1] = -vel[1] * TUNING.bounce;
      } else vel[1] = 0;
    }

    // Keeper moves after reacting (stays committed once diving)
    if (t > reaction && outcome === null) {
      const target = Math.max(k0 - k.maxDive, Math.min(k0 + k.maxDive, guessX));
      const dir = Math.sign(target - kx);
      kx += dir * Math.min(Math.abs(target - kx), diveSpeed * dt);
    }

    // Defenders' sticks
    sit.defenders.forEach((d, i) => {
      if (crossedDefender[i] || outcome) return;
      lunge[i] = Math.min(1, lunge[i] + dt * 5);
      if (prev[2] < d.z && pos[2] >= d.z) {
        crossedDefender[i] = true;
        const reach = TUNING.defender.stickReach * (0.4 + 0.6 * lunge[i]);
        if (Math.abs(pos[0] - d.x) < reach && pos[1] < TUNING.defender.blockHeight) {
          outcome = 'blocked';
          detail = 'blocked';
          resolveTime = t;
          events.push({ t, type: 'block', pos: v3(pos), strength: 1 });
          vel[2] = -Math.abs(vel[2]) * 0.3;
          vel[0] = (pos[0] - d.x) * 6 + rng.gauss() * 2;
          vel[1] = Math.abs(vel[1]) * 0.3 + 1.5;
          stopAt = t + 1.0;
        }
      }
    });

    // Keeper save check when the ball passes the keeper's plane
    if (!crossedKeeper && prev[2] < sit.keeper.z && pos[2] >= sit.keeper.z && outcome === null) {
      crossedKeeper = true;
      const diveAmt = Math.min(1, Math.abs(kx - k0) / k.maxDive);
      const reachHeight = 1.75 - 0.55 * diveAmt + (guessY > 1.2 ? 0.2 : 0);
      let half = k.bodyHalfWidth + 0.28 * diveAmt + 0.08;
      if (pos[1] > 1.2) half *= 1 - k.highBallPenalty * ((pos[1] - 1.2) / 0.95);
      const fullyBeaten = Math.abs(pos[0] - kx) > half || pos[1] > reachHeight;
      if (!fullyBeaten) {
        outcome = 'save';
        detail = pos[1] < 0.35 ? 'pads' : pos[1] < 0.95 ? (diveAmt > 0.4 ? 'stick' : 'body') : 'glove';
        resolveTime = t;
        events.push({ t, type: 'save', pos: v3(pos), strength: Math.min(1, sp / 25) });
        vel[2] = -Math.abs(vel[2]) * (detail === 'pads' ? 0.45 : 0.25);
        vel[0] = (pos[0] - kx) * 4 + rng.gauss() * 2.5;
        vel[1] = Math.abs(vel[1]) * 0.25 + (detail === 'glove' ? 3.5 : 1.2);
        stopAt = t + 1.1;
      }
    }

    // Posts (vertical cylinders) and crossbar
    if (!inGoal && pos[2] > -0.15 && pos[2] < 0.15 && pos[1] < GOAL_HEIGHT + POST_RADIUS) {
      for (const side of [-1, 1]) {
        const px = side * (GOAL_HALF_WIDTH + POST_RADIUS);
        const dx = pos[0] - px;
        const dz = pos[2] - 0;
        const dist = Math.hypot(dx, dz);
        const min = POST_RADIUS + BALL_RADIUS;
        if (dist < min) {
          const nx = dx / dist;
          const nz = dz / dist;
          const vn = vel[0] * nx + vel[2] * nz;
          if (vn < 0) {
            vel[0] -= 1.7 * vn * nx;
            vel[2] -= 1.7 * vn * nz;
            pos[0] = px + nx * min;
            pos[2] = nz * min;
            touchedPost = true;
            events.push({ t, type: 'post', pos: v3(pos), strength: Math.min(1, -vn / 20) });
          }
        }
      }
    }
    if (prev[2] < 0 && pos[2] >= 0 && Math.abs(pos[0]) < GOAL_HALF_WIDTH + POST_RADIUS) {
      if (Math.abs(pos[1] - GOAL_HEIGHT) < POST_RADIUS + BALL_RADIUS) {
        vel[2] = -Math.abs(vel[2]) * 0.5;
        vel[1] = -Math.abs(vel[1]) * 0.6;
        pos[2] = -0.01;
        touchedPost = true;
        events.push({ t, type: 'crossbar', pos: v3(pos), strength: 1 });
      }
    }

    // Crossing the goal line
    if (prev[2] < 0 && pos[2] >= 0 && !inGoal) {
      const inMouth = Math.abs(pos[0]) < GOAL_HALF_WIDTH - BALL_RADIUS * 0.5 && pos[1] < GOAL_HEIGHT - BALL_RADIUS;
      if (inMouth && (outcome === null || outcome === 'save')) {
        // A save that still trickles in is still a goal.
        inGoal = true;
        outcome = 'goal';
        resolveTime = t;
        detail = touchedPost
          ? 'postIn'
          : pos[1] > 1.45 && Math.abs(pos[0]) > 1.1
            ? 'topBins'
            : pos[1] < BACKBOARD_HEIGHT
              ? 'backboard'
              : 'net';
        stopAt = t + 1.2;
      } else if (outcome === null) {
        outcome = touchedPost ? 'post' : pos[1] >= GOAL_HEIGHT && Math.abs(pos[0]) < GOAL_HALF_WIDTH + 0.6 ? 'over' : 'wide';
        detail = outcome === 'post' ? 'post' : outcome === 'over' ? 'over' : 'wide';
        resolveTime = t;
        events.push({ t, type: 'line', pos: v3(pos), strength: 0 });
        stopAt = t + 0.9;
      }
    }

    // Inside the goal: backboard, sideboards and net
    if (inGoal) {
      const back = GOAL_DEPTH - 0.06;
      if (pos[2] > back) {
        const hitBoard = pos[1] < BACKBOARD_HEIGHT;
        if (vel[2] > 0.3)
          events.push({ t, type: hitBoard ? 'backboard' : 'net', pos: v3(pos), strength: Math.min(1, vel[2] / 25) });
        pos[2] = back;
        vel[2] = -vel[2] * (hitBoard ? 0.22 : 0.06);
        vel[0] *= 0.5;
        vel[1] *= hitBoard ? 0.5 : 0.2;
      }
      const side = GOAL_HALF_WIDTH - 0.04;
      if (Math.abs(pos[0]) > side) {
        pos[0] = Math.sign(pos[0]) * side;
        vel[0] = -vel[0] * 0.2;
      }
      if (pos[1] > GOAL_HEIGHT - 0.05) {
        pos[1] = GOAL_HEIGHT - 0.05;
        vel[1] = -Math.abs(vel[1]) * 0.1;
      }
    }

    if (outcome === null && Math.hypot(vel[0], vel[2]) < 0.4 && pos[1] <= BALL_RADIUS + 0.001) {
      outcome = 'wide';
      detail = 'wide';
      resolveTime = t;
      stopAt = t + 0.5;
    }

    if (step % 2 === 0) {
      const diveAmt = (kx - k0) / k.maxDive;
      const reach = Math.max(0, Math.min(1, (guessY - 0.3) / 1.5)) * (t > reaction ? 1 : 0);
      frames.push({
        t,
        ball: v3(pos),
        keeperX: kx,
        keeperDive: Math.max(-1, Math.min(1, diveAmt)),
        keeperReach: reach,
        defenderLunge: [...lunge],
      });
    }
  }

  return {
    outcome: outcome ?? 'wide',
    detail,
    quality,
    speedKmh: Math.round(Math.hypot(launch[0], launch[1], launch[2]) * 3.6),
    resolveTime,
    frames,
    events,
    launch,
  };
}

/** Where a ball will cross a z-plane, ignoring the keeper (used for the keeper's read). */
function predictCrossing(pos: Vec3, vel: Vec3, z: number): { x: number; y: number } {
  const dt = TUNING.dt;
  for (let t = 0; t < 3; t += dt) {
    const sp = Math.hypot(vel[0], vel[1], vel[2]);
    const drag = TUNING.airDrag * sp;
    vel[0] -= vel[0] * drag * dt;
    vel[2] -= vel[2] * drag * dt;
    if (pos[1] > BALL_RADIUS + 0.002 || vel[1] > 0.01) vel[1] -= TUNING.gravity * dt;
    pos[0] += vel[0] * dt;
    pos[1] += vel[1] * dt;
    pos[2] += vel[2] * dt;
    if (pos[1] < BALL_RADIUS) {
      pos[1] = BALL_RADIUS;
      vel[1] = vel[1] < -1.2 ? -vel[1] * TUNING.bounce : 0;
    }
    if (pos[2] >= z) return { x: pos[0], y: pos[1] };
  }
  return { x: pos[0], y: pos[1] };
}
