import { useEffect, useState } from 'preact/hooks';
import { STROKES, type StrokeKey } from '../core/tuning';
import { sfx } from '../audio/sfx';
import { send, setState, useStore, type HudState } from './store';

export function App() {
  const screen = useStore((s) => s.screen);
  return (
    <div class="ui">
      {screen === 'loading' && <Loading />}
      {screen === 'title' && <Title />}
      {screen === 'practice' && <Hud />}
      {screen === 'results' && <Results />}
    </div>
  );
}

function Loading() {
  return (
    <div class="loading">
      <Logo />
      <div class="loading-bar">
        <span />
      </div>
    </div>
  );
}

function Logo({ small }: { small?: boolean }) {
  return (
    <div class={`logo ${small ? 'logo-small' : ''}`}>
      <span class="logo-word">STICK</span>
      <span class="logo-word logo-accent">WORK</span>
      <svg class="logo-stick" viewBox="0 0 200 24" aria-hidden="true">
        <path d="M4 12 H168 Q190 12 192 4" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
        <circle cx="180" cy="20" r="3.5" fill="#fff" />
      </svg>
    </div>
  );
}

function Title() {
  const muted = useStore((s) => s.muted);
  return (
    <div class="title-screen">
      <div class="title-top">
        <Logo />
        <p class="tagline">A field hockey career, one moment at a time.</p>
      </div>
      <div class="title-menu">
        <button
          class="btn btn-primary"
          onClick={() => {
            sfx.unlock();
            sfx.ui('select');
            send({ type: 'startPractice' });
          }}
        >
          <span class="btn-kicker">Play now</span>
          Shooting Practice
        </button>
        <button class="btn btn-ghost" disabled>
          <span class="btn-kicker">Coming soon</span>
          Career: Formby 2s
        </button>
        <div class="title-row">
          <button
            class="chip"
            onClick={() => {
              sfx.unlock();
              sfx.setMuted(!muted);
              setState({ muted: !muted });
            }}
          >
            {muted ? 'Sound off' : 'Sound on'}
          </button>
          <span class="build">Early build · v0.1</span>
        </div>
      </div>
    </div>
  );
}

function Hud() {
  const hud = useStore((s) => s.hud);
  const showHelp = useStore((s) => s.showHelp);
  return (
    <div class={`hud phase-${hud.phase}`}>
      <ScoreBug hud={hud} />
      {(hud.phase === 'intro' || hud.phase === 'aim' || hud.phase === 'charging') && (
        <div class="context">
          <span class="context-tag">IN THE D</span>
          <span class="context-text">{hud.context}</span>
          <span class="gk-chip">GK {hud.keeperRating}</span>
        </div>
      )}
      {(hud.phase === 'aim' || hud.phase === 'charging') && <Pressure value={hud.pressure} />}
      {(hud.phase === 'aim' || hud.phase === 'charging' || hud.phase === 'intro') && <Controls hud={hud} />}
      {hud.phase === 'replay' && (
        <>
          <div class="letterbox top" />
          <div class="letterbox bottom" />
          <div class="replay-tag">
            <i /> REPLAY
          </div>
          <button class="skip" onClick={() => send({ type: 'skipReplay' })}>
            Skip
          </button>
        </>
      )}
      {hud.result && (hud.phase === 'result' || hud.phase === 'replay') && <ResultCard hud={hud} />}
      <button class="quit" aria-label="Back to menu" onClick={() => send({ type: 'quit' })}>
        ✕
      </button>
      {showHelp && hud.shot === 1 && hud.phase !== 'flight' && hud.phase !== 'result' && <Help />}
    </div>
  );
}

function ScoreBug({ hud }: { hud: HudState }) {
  return (
    <div class="scorebug">
      <div class="bug-left">
        <span class="bug-label">PRACTICE</span>
        <span class="bug-shot">
          SHOT {hud.shot}/{hud.total}
        </span>
      </div>
      <div class="bug-goals">
        <b>{hud.goals}</b>
        <span>GOALS</span>
      </div>
      <div class="bug-score">
        <b>{hud.score}</b>
        {hud.streak > 1 && <span class="streak">🔥 x{hud.streak}</span>}
      </div>
    </div>
  );
}

function Pressure({ value }: { value: number }) {
  return (
    <div class={`pressure ${value > 0.7 ? 'hot' : ''}`}>
      <span>DEFENDER CLOSING</span>
      <div class="pressure-bar">
        <i style={{ width: `${Math.min(100, value * 100)}%` }} />
      </div>
    </div>
  );
}

function Controls({ hud }: { hud: HudState }) {
  const strokes: StrokeKey[] = ['push', 'flick', 'hit'];
  const hints: Record<StrokeKey, string> = {
    push: 'Quick, low, accurate',
    flick: 'Lift it. Slide up to aim high',
    hit: 'Big backlift, huge power',
  };
  return (
    <div class="controls">
      <PowerRing hud={hud} />
      <div class="hint">{hud.phase === 'charging' ? 'Slide to aim · release in the green' : 'Hold anywhere to wind up'}</div>
      <div class="strokes">
        {strokes.map((s) => (
          <button
            key={s}
            class={`stroke ${hud.stroke === s ? 'on' : ''}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              send({ type: 'stroke', stroke: s });
            }}
          >
            <b>{STROKES[s].label}</b>
            <small>{hints[s]}</small>
            {hud.suggested === s && <em>Best</em>}
          </button>
        ))}
      </div>
    </div>
  );
}

function PowerRing({ hud }: { hud: HudState }) {
  const R = 46;
  const C = 2 * Math.PI * R;
  const max = 1.12;
  const frac = (v: number) => (v / max) * 0.75; // ring covers 270°
  const [lo, hi] = hud.sweet;
  const inSweet = hud.meter >= lo && hud.meter <= hi;
  const over = hud.meter > hi;
  return (
    <svg class={`power ${hud.phase === 'charging' ? 'live' : ''} ${inSweet ? 'sweet' : ''} ${over ? 'over' : ''}`} viewBox="0 0 120 120">
      <g transform="rotate(135 60 60)">
        <circle cx="60" cy="60" r={R} class="track" stroke-dasharray={`${C * 0.75} ${C}`} />
        <circle cx="60" cy="60" r={R} class="band" stroke-dasharray={`${C * (frac(hi) - frac(lo))} ${C}`} stroke-dashoffset={-C * frac(lo)} />
        <circle cx="60" cy="60" r={R} class="overband" stroke-dasharray={`${C * (0.75 - frac(hi))} ${C}`} stroke-dashoffset={-C * frac(hi)} />
        <circle cx="60" cy="60" r={R} class="fill" stroke-dasharray={`${C * frac(Math.min(max, hud.meter))} ${C}`} />
      </g>
      <text x="60" y="66" class="power-label">
        {hud.phase === 'charging' ? (inSweet ? 'NOW' : over ? 'TOO MUCH' : `${Math.round(Math.min(1, hud.meter) * 100)}`) : STROKES[hud.stroke].label.toUpperCase()}
      </text>
    </svg>
  );
}

function ResultCard({ hud }: { hud: HudState }) {
  const r = hud.result!;
  const qualityLabel: Record<string, string> = { perfect: 'PERFECT STRIKE', clean: 'CLEAN STRIKE', scuffed: 'SCUFFED IT', overcooked: 'OVERCOOKED' };
  return (
    <div class={`result tone-${r.tone} ${hud.phase === 'replay' ? 'mini' : ''}`}>
      <div class="result-title">{r.title}</div>
      <div class="result-sub">{r.sub}</div>
      <div class="result-chips">
        {r.quality && <span class={`q q-${r.quality}`}>{qualityLabel[r.quality]}</span>}
        {r.speed ? <span>{r.speed} km/h</span> : null}
        {r.points ? <span class="pts">+{r.points}</span> : null}
      </div>
      {hud.phase === 'result' && <div class="tap">Tap to continue</div>}
    </div>
  );
}

function Help() {
  const [step, setStep] = useState(0);
  const steps = [
    ['Pick your stroke', 'Push, flick or hit. The best option for the spot is marked.'],
    ['Hold and slide', 'Press anywhere and slide to move the target on the goal. Slide up to lift a flick.'],
    ['Release in the green', "The power ring pulses. Let go in the green band for a clean strike before the defender gets to you."],
  ];
  useEffect(() => {
    const t = setTimeout(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 2600);
    return () => clearTimeout(t);
  }, [step]);
  return (
    <div class="help">
      <div class="help-card">
        <div class="help-step">
          {step + 1}/{steps.length}
        </div>
        <b>{steps[step][0]}</b>
        <p>{steps[step][1]}</p>
      </div>
    </div>
  );
}

function Results() {
  const hud = useStore((s) => s.hud);
  const icon = (o: string) => (o === 'goal' ? '●' : o === 'save' ? '◐' : '○');
  const rating = hud.goals >= 8 ? 'Clinical' : hud.goals >= 6 ? 'Sharp in the D' : hud.goals >= 4 ? 'Decent session' : 'Back to the drawing board';
  return (
    <div class="results">
      <Logo small />
      <div class="results-card">
        <div class="results-head">SESSION COMPLETE</div>
        <div class="results-score">{hud.score}</div>
        <div class="results-rating">{rating}</div>
        <div class="results-stats">
          <div>
            <b>
              {hud.goals}/{hud.total}
            </b>
            <span>Goals</span>
          </div>
          <div>
            <b>{hud.bestStreak}</b>
            <span>Best streak</span>
          </div>
          <div>
            <b>{Math.max(0, ...hud.log.map((l) => l.speedKmh))}</b>
            <span>Top km/h</span>
          </div>
        </div>
        <ol class="results-log">
          {hud.log.map((l, i) => (
            <li key={i} class={`o-${l.outcome}`}>
              <span class="ico">{icon(l.outcome)}</span>
              <span class="what">{l.title}</span>
              <span class="how">
                {STROKES[l.stroke].label} · {l.quality}
              </span>
              <span class="p">{l.points ? `+${l.points}` : ''}</span>
            </li>
          ))}
        </ol>
      </div>
      <div class="results-actions">
        <button class="btn btn-primary" onClick={() => send({ type: 'startPractice' })}>
          Go again
        </button>
        <button class="btn btn-ghost" onClick={() => send({ type: 'quit' })}>
          Menu
        </button>
      </div>
    </div>
  );
}
