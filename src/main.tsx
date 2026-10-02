import { render } from 'preact';
import { App } from './app/App';
import { setState } from './app/store';
import { Engine } from './game/engine';
import { PracticeMode } from './game/practice';
import './styles/app.css';

render(<App />, document.getElementById('ui')!);

// Let the loading screen paint before building the stadium.
requestAnimationFrame(() =>
  setTimeout(() => {
    const engine = new Engine(document.getElementById('game') as HTMLCanvasElement);
    const game = new PracticeMode(engine);
    engine.start();
    // Dev/test hook: lets automated tests drive the game.
    (window as unknown as { __stickwork: unknown }).__stickwork = { engine, game, setState };
  }, 30),
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}
