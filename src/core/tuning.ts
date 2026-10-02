/**
 * Every balance number for the shooting moment lives here, so feel can be tuned in one place.
 * Speeds are m/s, times are seconds, distances metres.
 */
export type StrokeKey = 'push' | 'flick' | 'hit';

export interface StrokeSpec {
  label: string;
  /** Ball speed at full power. */
  maxSpeed: number;
  /** Ball speed at zero power. */
  minSpeed: number;
  /** Highest point on the goal the stroke can be aimed at. */
  maxAimHeight: number;
  /** Lowest aim height (ground strokes stay on the deck). */
  minAimHeight: number;
  /** Base aiming error in radians at 0 skill. */
  baseError: number;
  /** Seconds for the power meter to fill once. */
  chargeTime: number;
  /** Power band that counts as a clean strike. */
  sweet: [number, number];
  /** The keeper reads big backlifts sooner: added to reaction time (negative = earlier). */
  readBonus: number;
  /** Seconds between release and the ball leaving the stick. */
  strikeDelay: number;
}

export const STROKES: Record<StrokeKey, StrokeSpec> = {
  push: {
    label: 'Push',
    maxSpeed: 21,
    minSpeed: 9,
    maxAimHeight: 0.35,
    minAimHeight: 0.04,
    baseError: 0.05,
    chargeTime: 0.45,
    sweet: [0.72, 0.94],
    readBonus: 0.03,
    strikeDelay: 0.06,
  },
  flick: {
    label: 'Flick',
    maxSpeed: 17,
    minSpeed: 9,
    maxAimHeight: 2.05,
    minAimHeight: 0.3,
    baseError: 0.08,
    chargeTime: 0.6,
    sweet: [0.7, 0.92],
    readBonus: 0.03,
    strikeDelay: 0.09,
  },
  hit: {
    label: 'Hit',
    maxSpeed: 33,
    minSpeed: 15,
    maxAimHeight: 0.45,
    minAimHeight: 0.04,
    baseError: 0.16,
    chargeTime: 0.95,
    sweet: [0.8, 0.96],
    readBonus: -0.06,
    strikeDelay: 0.16,
  },
};

export const TUNING = {
  gravity: 9.81,
  airDrag: 0.004,
  groundFriction: 0.9, // rolling deceleration, m/s^2
  bounce: 0.35,
  dt: 1 / 120,
  maxSimTime: 3,

  keeper: {
    baseReaction: 0.3,
    reactionPerRating: 0.0016, // subtract per rating point
    diveSpeed: 4.2, // lateral m/s while diving
    diveSpeedPerRating: 0.015,
    maxDive: 1.75, // lateral reach from the centre of the keeper's body when fully stretched
    bodyHalfWidth: 0.38,
    readNoise: 0.35, // metres of guess error at rating 0
    highBallPenalty: 0.2, // fraction of reach lost reaching top corners
  },

  shooter: {
    /** Extra aim error scale when the release misses the sweet band. */
    offSweetError: 2.4,
    /** Error added per unit of over-power beyond the sweet band. */
    overpowerError: 1.6,
    /** Reticle wobble amplitude in metres at 0 skill and 0 confidence. */
    wobble: 0.55,
  },

  defender: {
    stickReach: 0.55,
    blockHeight: 0.45,
  },
} as const;
