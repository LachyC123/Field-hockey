# Stickwork

A field hockey career game in the spirit of New Star Soccer: one player's journey from Formby's 2s to England, played through the key moments that decide matches.

This first build is the **shooting moment**: a floodlit 3D pitch with a keeper, defenders closing you down, and drag-to-shoot controls with push, flick and hit strokes, slow-mo, sound and replays. The full design and build plan lives in the project files (`plan/game-plan.md`).

## Play

Open the GitHub Pages site on your phone (portrait) or desktop. Hold anywhere to wind up, slide to move the target on the goal, and release when the power ring is in the green.

## Develop

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (shot physics, keeper model, pitch geometry)
npm run build      # typecheck + production build into dist/
npm run test:e2e   # Playwright smoke test on a phone-sized viewport
```

Add `?quality=low|medium|high` to the URL to force a graphics tier.

## Layout

- `src/core/`: pure, deterministic game logic (no DOM): pitch geometry, seeded RNG, tuning numbers, shot and keeper simulation.
- `src/game/`: Three.js rendering: engine and post-processing, stadium, procedural athletes, effects, the practice moment controller.
- `src/app/`: Preact UI (title, HUD, results) and a small store.
- `src/audio/`: procedural WebAudio sound effects (no audio files).
