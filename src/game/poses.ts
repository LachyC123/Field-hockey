import { POSE_DEFAULT, type Pose } from './actors/athlete';
import type { StrokeKey } from '../core/tuning';

/** Where the ball sits relative to the shooter's feet (local space, facing +Z). */
export const BALL_LOCAL: [number, number, number] = [-0.3, 0, 0.62];

const P = (o: Partial<Pose>): Pose => ({ ...POSE_DEFAULT, ...o });

export const SHOOTER_POSES = {
  ready: P({ crouch: 0.3, lean: 0.45, stepL: 0.15, stepR: -0.1, L: [0.02, 0.92, 0.3], H: [-0.3, 0.04, 0.5] }),
  push: {
    back: P({ crouch: 0.5, lean: 0.6, stepL: 0.3, stepR: -0.2, stance: 0.2, twist: 0.15, L: [0.02, 0.8, 0.2], H: [-0.28, 0.04, 0.42] }),
    contact: P({ crouch: 0.48, lean: 0.55, stepL: 0.35, stepR: -0.25, stance: 0.2, L: [0.05, 0.82, 0.48], H: [-0.27, 0.05, 0.75] }),
    through: P({ crouch: 0.4, lean: 0.42, stepL: 0.4, stepR: -0.3, stance: 0.2, twist: -0.25, headPitch: 0.05, L: [0.15, 0.95, 0.75], H: [-0.08, 0.3, 1.38] }),
  },
  flick: {
    back: P({ crouch: 0.65, lean: 0.65, stepL: 0.45, stepR: -0.3, stance: 0.3, twist: 0.2, L: [0.0, 0.72, 0.12], H: [-0.34, 0.04, 0.32] }),
    contact: P({ crouch: 0.6, lean: 0.55, stepL: 0.45, stepR: -0.3, stance: 0.3, L: [0.06, 0.78, 0.45], H: [-0.27, 0.06, 0.72] }),
    through: P({ crouch: 0.35, lean: 0.2, stepL: 0.45, stepR: -0.35, stance: 0.25, twist: -0.4, headPitch: -0.05, L: [0.18, 1.08, 0.55], H: [-0.06, 1.25, 1.2] }),
  },
  hit: {
    back: P({ crouch: 0.35, lean: 0.4, stepL: 0.25, stepR: -0.15, stance: 0.25, twist: 0.65, headPitch: 0.25, L: [-0.15, 1.05, 0.02], H: [-0.78, 1.42, -0.42] }),
    contact: P({ crouch: 0.45, lean: 0.55, stepL: 0.35, stepR: -0.2, stance: 0.25, twist: 0.05, L: [-0.12, 0.78, 0.48], H: [-0.3, 0.04, 0.64] }),
    through: P({ crouch: 0.3, lean: 0.3, stepL: 0.35, stepR: -0.25, stance: 0.25, twist: -0.65, headPitch: 0.05, L: [0.25, 1.18, 0.55], H: [0.42, 1.05, 1.15] }),
  },
  celebrate: P({ crouch: 0.05, lean: -0.15, headPitch: -0.35, stance: 0.18, stepL: 0, stepR: 0, L: [0.15, 1.75, 0.25], H: [0.05, 2.65, 0.55] }),
  dejected: P({ crouch: 0.1, lean: 0.55, headPitch: 0.6, stance: 0.1, L: [0.05, 0.95, 0.2], H: [-0.15, 0.04, 0.55] }),
} as const;

export function strokePoses(s: StrokeKey) {
  return SHOOTER_POSES[s];
}

export const KEEPER_SET: Pose = P({
  crouch: 0.58,
  lean: 0.5,
  stance: 0.16,
  stepL: 0.05,
  stepR: 0.05,
  headPitch: -0.1,
  L: [-0.32, 0.72, 0.3],
  H: [-0.48, 0.05, 0.72],
  freeHand: [0.42, 0.85, 0.42],
});

/** Keeper pose from the sim: dive is -1..1 in the keeper's own left/right, reach 0..1 how high. */
export function keeperPose(dive: number, reach: number): Pose {
  const a = Math.abs(dive);
  const s = Math.sign(dive) || 1;
  const p: Pose = { ...KEEPER_SET, L: [...KEEPER_SET.L], H: [...KEEPER_SET.H], freeHand: [...KEEPER_SET.freeHand!] };
  // Low dives become a sliding "double-stack"; high ones a stretched glove.
  const high = reach > 0.45;
  p.roll = -s * a * (high ? 1.0 : 1.35);
  p.drop = a * (high ? 0.15 : 0.45);
  p.shiftX = 0;
  p.crouch = KEEPER_SET.crouch + a * 0.2;
  p.stance = KEEPER_SET.stance + a * 0.25;
  if (s > 0) {
    p.freeHand = [0.42 + a * 0.5, 0.85 + reach * a * 1.2, 0.42 + a * 0.1];
  } else {
    p.L = [-0.35 - a * 0.45, 0.72 + reach * a * 1.0, 0.3];
    p.H = [-0.55 - a * 0.9, 0.1 + reach * a * 1.1, 0.75];
  }
  return p;
}
