# Randomovie

Infinite 2D canvas of movie posters. Swipe in any direction — see similar movies appear. The more you explore, the more the canvas adapts to your taste. Random movies are mixed in to keep things fresh.

## How it works

~80k movies are represented as 16-dimensional vectors (UMAP-reduced from 768-dim text embeddings). When you scroll to the edge:

1. Visible neighbors' embeddings are averaged (weighted by distance), then a gradient is extrapolated along the scroll direction to continue genre trends
2. Noise is added for variety
3. Brute-force search finds the closest match (~1ms)
4. 5% of tiles are fully random to prevent similarity bubbles

All computation runs client-side in a Web Worker. No backend needed.

## Quick start (mock data)

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173` with colored placeholder tiles (no real posters). Pan, zoom, and scroll work — you can verify the infinite canvas behavior immediately.

## Full setup (real movie data)

### 1. Generate embeddings

```bash
python -m venv .venv
source .venv/bin/activate
pip install datasets numpy umap-learn
python scripts/pipeline.py
```

This downloads ~680k movies from HuggingFace, filters to ~80k, runs UMAP dimensionality reduction, and outputs `public/data/embeddings.bin` (~4 MB).

Takes a while on first run (dataset download + UMAP). Subsequent runs are faster if the dataset is cached.

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

Output goes to `dist/`. Deploy anywhere that serves static files.

## Project structure

```
src/
  main.ts                — entry point, wiring
  canvas/
    viewport.ts          — coordinate math, cell ranges, dynamic zoom limits
    gestures.ts          — pan/pinch/zoom with inertia
    renderer.ts          — Canvas 2D render loop, culling
  engine/
    grid.ts              — cell storage, expansion, eviction
    generator.ts         — similarity + random algorithm
    embeddings.ts        — .bin parser, brute-force search
  data/
    poster-cache.ts      — LRU image cache, adaptive LOD (400 entries)
scripts/
  pipeline.py            — HuggingFace → UMAP → quantize → .bin
```

## Tech

- Vanilla TypeScript, Vite
- HTML5 Canvas 2D (no WebGL, no framework)
- Dynamic zoom limit — max ~78 visible posters to prevent rendering lag
- Posters from TMDB CDN (`image.tmdb.org`)
- Movie embeddings: [Remsky/Embeddings__Ultimate_1Million_Movies_Dataset](https://huggingface.co/datasets/Remsky/Embeddings__Ultimate_1Million_Movies_Dataset)

## License

[MIT](LICENSE)
