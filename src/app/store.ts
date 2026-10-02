import { useEffect, useState } from 'preact/hooks';
import type { StrokeKey } from '../core/tuning';

export type Screen = 'loading' | 'title' | 'practice' | 'results';

export interface ShotLog {
  outcome: string;
  title: string;
  stroke: StrokeKey;
  quality: string;
  speedKmh: number;
  points: number;
}

export interface HudState {
  phase: 'intro' | 'aim' | 'charging' | 'flight' | 'result' | 'replay' | 'idle';
  shot: number;
  total: number;
  goals: number;
  score: number;
  streak: number;
  bestStreak: number;
  stroke: StrokeKey;
  suggested: StrokeKey;
  context: string;
  meter: number;
  sweet: [number, number];
  pressure: number;
  keeperRating: number;
  result: { title: string; sub: string; tone: 'goal' | 'miss' | 'save'; quality?: string; points?: number; speed?: number } | null;
  log: ShotLog[];
}

export interface AppState {
  screen: Screen;
  muted: boolean;
  showHelp: boolean;
  hud: HudState;
}

export const initialHud = (): HudState => ({
  phase: 'idle',
  shot: 0,
  total: 10,
  goals: 0,
  score: 0,
  streak: 0,
  bestStreak: 0,
  stroke: 'push',
  suggested: 'push',
  context: '',
  meter: 0,
  sweet: [0.7, 0.9],
  pressure: 0,
  keeperRating: 60,
  result: null,
  log: [],
});

let state: AppState = { screen: 'loading', muted: false, showHelp: true, hud: initialHud() };
const subs = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  subs.forEach((s) => s());
}

export function setHud(patch: Partial<HudState>): void {
  state = { ...state, hud: { ...state.hud, ...patch } };
  subs.forEach((s) => s());
}

export function useStore<T>(select: (s: AppState) => T): T {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  }, []);
  return select(state);
}

/** Commands the UI sends to the game. */
type Command = { type: 'stroke'; stroke: StrokeKey } | { type: 'skipReplay' } | { type: 'startPractice' } | { type: 'quit' };
const cmdSubs = new Set<(c: Command) => void>();
export function send(c: Command): void {
  cmdSubs.forEach((s) => s(c));
}
export function onCommand(fn: (c: Command) => void): () => void {
  cmdSubs.add(fn);
  return () => cmdSubs.delete(fn);
}
