import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { inCircle } from '../../src/core/pitch';
import { simulateShot, strikeQuality, type ShotSituation, type ShotInput } from '../../src/core/shot';
import { STROKES } from '../../src/core/tuning';

const base: ShotSituation = {
  ball: { x: 0.5, z: -8 },
  keeper: { x: 0, z: -1, rating: 60 },
  defenders: [],
  shooter: { shooting: 60, flicking: 60, composure: 50 },
  confidence: 55,
};

function rate(input: ShotInput, sit = base, n = 600) {
  const counts: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const r = simulateShot(sit, input, i * 7919 + 13);
    counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  }
  return (o: string) => (counts[o] ?? 0) / n;
}

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 10; i++) expect(a.next()).toBe(b.next());
  });
});

describe('pitch', () => {
  it('knows the D', () => {
    expect(inCircle(0, -14)).toBe(true);
    expect(inCircle(0, -15)).toBe(false);
    expect(inCircle(10, -10)).toBe(true);
    expect(inCircle(14, -10)).toBe(false);
  });
});

describe('shot simulation', () => {
  it('is deterministic for the same seed', () => {
    const input: ShotInput = { stroke: 'push', aimX: 1.5, aimY: 0.1, power: 0.83 };
    const a = simulateShot(base, input, 99);
    const b = simulateShot(base, input, 99);
    expect(a.outcome).toBe(b.outcome);
    expect(a.frames.length).toBe(b.frames.length);
  });

  it('grades the release against the sweet band', () => {
    const [lo, hi] = STROKES.hit.sweet;
    expect(strikeQuality('hit', (lo + hi) / 2)).toBe('perfect');
    expect(strikeQuality('hit', 0.2)).toBe('scuffed');
    expect(strikeQuality('hit', 0.99)).toBe('overcooked');
  });

  it('a clean push into the corner scores often but not always', () => {
    const goal = rate({ stroke: 'push', aimX: 1.55, aimY: 0.1, power: 0.83 })('goal');
    expect(goal).toBeGreaterThan(0.3);
    expect(goal).toBeLessThan(0.9);
  });

  it('a flick into the top corner beats the keeper more than a central one', () => {
    const corner = rate({ stroke: 'flick', aimX: 1.5, aimY: 1.8, power: 0.81 })('goal');
    const central = rate({ stroke: 'flick', aimX: 0, aimY: 0.9, power: 0.81 })('goal');
    expect(corner).toBeGreaterThan(central + 0.2);
    expect(central).toBeLessThan(0.25);
  });

  it('scuffed shots are worse than clean ones', () => {
    const clean = rate({ stroke: 'hit', aimX: 1.4, aimY: 0.1, power: 0.88 })('goal');
    const scuffed = rate({ stroke: 'hit', aimX: 1.4, aimY: 0.1, power: 0.3 })('goal');
    expect(clean).toBeGreaterThan(scuffed);
  });

  it('a defender in the lane blocks ground shots', () => {
    const sit: ShotSituation = { ...base, defenders: [{ x: 0.9, z: -5 }] };
    const blocked = rate({ stroke: 'push', aimX: 1.5, aimY: 0.1, power: 0.83 }, sit)('blocked');
    expect(blocked).toBeGreaterThan(0.2);
  });

  it('ground goals hit the backboard', () => {
    for (let i = 0; i < 200; i++) {
      const r = simulateShot(base, { stroke: 'push', aimX: 1.5, aimY: 0.1, power: 0.83 }, i);
      if (r.outcome === 'goal' && r.detail !== 'postIn') {
        expect(r.events.some((e) => e.type === 'backboard')).toBe(true);
        return;
      }
    }
    throw new Error('no goal found');
  });
});
