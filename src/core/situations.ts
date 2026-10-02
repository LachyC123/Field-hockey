import { Rng } from './rng';
import type { ShotSituation } from './shot';
import type { StrokeKey } from './tuning';

export interface PracticeShot {
  situation: ShotSituation;
  /** Short broadcast-style line shown when the moment opens. */
  context: string;
  suggested: StrokeKey;
  /** Seconds before the defender closes you down. */
  pressureTime: number;
  seed: number;
}

interface Spot {
  name: string;
  x: [number, number];
  z: [number, number];
  context: string[];
  suggested: StrokeKey;
}

const SPOTS: Spot[] = [
  {
    name: 'penalty spot',
    x: [-0.6, 0.6],
    z: [-7.5, -5.5],
    context: ['Ball drops to you on the spot', 'Rebound falls kindly, right on the spot', 'Slipped in behind, one on one with the keeper'],
    suggested: 'flick',
  },
  {
    name: 'top of the D',
    x: [-3, 3],
    z: [-14, -12],
    context: ['Picked up at the top of the D', 'Free hit tapped short, you\'re on the edge of the D', 'Space opens at the top of the circle'],
    suggested: 'hit',
  },
  {
    name: 'right side',
    x: [4, 7.5],
    z: [-10, -6],
    context: ['Carried in on the right of the D', 'Baseline run, cut back toward the penalty spot', 'Driving in from the right'],
    suggested: 'push',
  },
  {
    name: 'left side',
    x: [-7.5, -4],
    z: [-10, -6],
    context: ['Open stick on the left of the D', 'Received on the left, defender coming across', 'Inside left, room to shoot'],
    suggested: 'flick',
  },
  {
    name: 'close range',
    x: [-2, 2],
    z: [-4.5, -3],
    context: ['Scramble in the D, ball at your feet... at your stick', 'Loose ball right in front of goal', 'Pass across the face, you\'re at the back post'],
    suggested: 'push',
  },
];

export function makePracticeShot(rng: Rng, difficulty = 0.5): PracticeShot {
  const spot = rng.pick(SPOTS);
  const x = rng.range(spot.x[0], spot.x[1]);
  const z = rng.range(spot.z[0], spot.z[1]);
  // The keeper narrows the angle: stands a little off the line, shading toward the ball.
  const dist = Math.hypot(x, z);
  const keeperZ = -Math.min(1.6, 0.5 + 4 / dist);
  const keeperX = (x / dist) * Math.abs(keeperZ) * 0.9;
  const defenders: { x: number; z: number }[] = [];
  const nDef = rng.chance(0.25 + difficulty * 0.4) ? (rng.chance(0.3 * difficulty) ? 2 : 1) : 0;
  for (let i = 0; i < nDef; i++) {
    const tAlong = rng.range(0.25, 0.55);
    const lateral = rng.range(1.2, 2.4) * (rng.chance(0.5) ? 1 : -1);
    const ux = -x / dist;
    const uz = -z / dist;
    defenders.push({ x: x + ux * dist * tAlong + uz * lateral, z: z + uz * dist * tAlong - ux * lateral * 0.2 });
  }
  return {
    situation: {
      ball: { x, z },
      keeper: { x: keeperX, z: keeperZ, rating: Math.round(40 + difficulty * 40 + rng.range(-8, 8)) },
      defenders,
      shooter: { shooting: 55, flicking: 50, composure: 50 },
      confidence: 55,
    },
    context: rng.pick(spot.context),
    suggested: spot.suggested,
    pressureTime: 3.2 + rng.range(0, 1.4) - nDef * 0.4,
    seed: Math.floor(rng.next() * 2 ** 31),
  };
}
