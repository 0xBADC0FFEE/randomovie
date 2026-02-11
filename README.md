# Randomovie

Infinite 2D canvas of movie posters. Swipe in any direction — see similar movies appear. The more you explore, the more the canvas adapts to your taste. Random movies are mixed in to keep things fresh.

## How it works

~80k movies are represented as 16-dimensional vectors (UMAP-reduced from 768-dim text embeddings). When you scroll to the edge:

1. Visible neighbors' embeddings are averaged (weighted by distance), then a gradient is extrapolated along the scroll direction to continue genre trends
2. Noise is added for variety
3. Brute-force search finds the closest match (~1ms)
4. 5% of tiles are fully random to prevent similarity bubbles

All computation runs client-side in a Web Worker. No backend needed.

Type to search — fuzzy title matching runs in a Web Worker (`titles.bin`, ~1 MB). Center poster swaps instantly, neighbors regenerate after a short delay.

## Quick start (mock data)

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173` with colored placeholder tiles (no real posters). Pan, zoom, and scroll work — you can verify the infinite canvas behavior immediately.

## Full setup (real movie data)

### 1. Generate embeddings

```bash
# Install Ollama (https://ollama.com) and pull the embedding model
ollama pull nomic-embed-text-v2-moe

# Set up Python env
python -m venv .venv
source .venv/bin/activate
pip install kagglehub pandas numpy umap-learn requests

# Requires Kaggle API key in ~/.kaggle/kaggle.json
python scripts/pipeline.py
```

This downloads ~1M movies from Kaggle ([alanvourch/tmdb-movies-daily-updates](https://www.kaggle.com/datasets/alanvourch/tmdb-movies-daily-updates)), filters to ~80k, generates 768-dim embeddings via Ollama, runs UMAP to 16-dim, and outputs `public/data/embeddings.bin` (~4 MB) and `public/data/titles.bin` (~1 MB).

First run takes a while (embedding generation + UMAP). Subsequent runs are fast — embeddings are cached in `scripts/embedding_cache.npz`.

### 2. Run the app

```bash
npm run dev
```

Posters load from TMDB CDN. The canvas is infinite in all directions.

## Build

```bash
npm run build
npm run preview
```

Output goes to `dist/`.

Pushing to `main` auto-deploys to GitHub Pages via Actions. Live at **https://0xBADC0FFEE.github.io/randomovie/**

Installable as a PWA (offline-capable after first load).

## Project structure

```
src/
  main.ts                — entry point, wiring
  canvas/
    viewport.ts          — coordinate math, cell ranges, dynamic zoom limits
    gestures.ts          — pan/pinch/zoom with inertia
    renderer.ts          — Canvas 2D render loop, culling
    animation.ts         — viewport lerp for search transitions
  engine/
    grid.ts              — cell storage, expansion, eviction
    generator.ts         — similarity + random algorithm
    embeddings.ts        — .bin parser, brute-force search
    search.worker.ts     — fuzzy title search (Web Worker)
    titles.ts            — titles.bin parser
  debug/
    overlay.ts             — FPS/viewport/grid debug HUD (2-finger double-tap)
  canvas/
    poster-loader.ts     — image cache keyed by grid cell, adaptive LOD
scripts/
  pipeline.py            — Kaggle → Ollama embeddings → UMAP → quantize → .bin
```

## Debug mode

Activate: 2-finger double-tap on touchscreen, or add `?debug` to URL.

Shows a minimap overlay (top-left corner) where each cell is colored by its embedding — similar movies share similar hues. A cyan rectangle marks the current viewport. Useful for visualizing how the similarity algorithm fills the grid.

## Tech

- Vanilla TypeScript, Vite, PWA (vite-plugin-pwa + Workbox)
- HTML5 Canvas 2D (no WebGL, no framework)
- Dynamic zoom limit — max ~78 visible posters to prevent rendering lag
- Posters from TMDB CDN (`image.tmdb.org`)
- Movie dataset: [alanvourch/tmdb-movies-daily-updates](https://www.kaggle.com/datasets/alanvourch/tmdb-movies-daily-updates) (updated daily)
- Embeddings: generated locally via [Ollama](https://ollama.com) + `nomic-embed-text-v2-moe`

## License

[MIT](LICENSE)
