/**
 * Field hockey pitch geometry in metres.
 * Coordinate frame for moments: x across the pitch (goal centre at x = 0), y up, z toward the goal.
 * The goal line is z = 0; the field of play is z < 0; the inside of the goal is 0 < z < GOAL_DEPTH.
 */
export const PITCH_LENGTH = 91.4;
export const PITCH_WIDTH = 55.0;
export const GOAL_HALF_WIDTH = 1.83; // inside of posts, 3.66 m mouth
export const GOAL_HEIGHT = 2.14;
export const GOAL_DEPTH = 1.2;
export const BACKBOARD_HEIGHT = 0.46;
export const POST_RADIUS = 0.05;
export const CIRCLE_RADIUS = 14.63; // the striking circle ("the D")
export const DOTTED_CIRCLE_RADIUS = 19.63;
export const PENALTY_SPOT = 6.475;
export const LINE_23 = 22.9;
export const BALL_RADIUS = 0.0365;

/** True when a point on the pitch (z <= 0) is inside the striking circle. */
export function inCircle(x: number, z: number): boolean {
  if (z > 0) return false;
  const ax = Math.abs(x);
  if (ax <= GOAL_HALF_WIDTH) return -z <= CIRCLE_RADIUS;
  const dx = ax - GOAL_HALF_WIDTH;
  return dx * dx + z * z <= CIRCLE_RADIUS * CIRCLE_RADIUS;
}

/** Distance to the centre of the goal mouth. */
export function distanceToGoal(x: number, z: number): number {
  return Math.hypot(x, z);
}
