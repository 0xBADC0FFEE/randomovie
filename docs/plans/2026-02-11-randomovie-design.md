# Randomovie — Design Document

Movie discovery app: infinite 2D canvas of posters, similarity-driven exploration with random mixing.

## Stack

- **PWA**: Vanilla TypeScript + Vite + Workbox
- **Rendering**: HTML5 Canvas 2D (single `<canvas>`)
- **Data**: Precomputed embeddings on CDN, posters from TMDB CDN, metadata via TMDB API on tap

## Data Pipeline (one-time, offline)

**Source**: HuggingFace 680k movies dataset (nomic-embed-text embeddings) + TMDB poster paths.

**Steps**:
1. Filter: movies with poster, >100 votes, rating >5.0 → ~80k movies
2. Reduce: UMAP 768-dim → 16-dim (preserves cluster structure)
3. Quantize: float32 → uint8 (min-max per axis). 16 bytes/movie
4. Output: `embeddings.bin`

**`embeddings.bin` format**:
```
[count: uint32]
[per movie: tmdb_id: uint32, poster_path_len: uint8, poster_path: utf8[...], embedding: uint8[16]]
```
~50 bytes/movie → ~4MB raw, ~2MB gzipped.

**On client**: only ID + poster_path + 16-dim vector. No metadata until tap.

## Algorithm: Content Generation

**Grid model**: infinite 2D grid of cells (col, row). Each cell = one movie. Filled cells stored in `Map<"col:row", MovieCell>`.

**Init**: random seed movie at (0,0), fill viewport + 2-row buffer.

**New cell generation** (when scrolling to edge):
```
function generateMovie(col, row):
  neighbors = getFilledNeighbors(col, row, radius=3)

  if neighbors.length == 0:
    return randomMovie()

  // Weighted average — closer neighbors have more influence
  targetVector = weightedAverage(
    neighbors.map(n => n.embedding),
    weights = 1 / distance(col, row, n.col, n.row)
  )

  // Add noise for variety (tunable: 0.1-0.3)
  targetVector = normalize(targetVector + randomVector() * NOISE_FACTOR)

  // Brute-force top-K over 80k 16-dim uint8 vectors (~1ms in Worker)
  candidates = findTopK(targetVector, k=10, exclude=onScreenSet)

  // Weighted random pick from top-K (not always top-1)
  return weightedRandomPick(candidates)
```

**Random injection**: ~20% chance to place a fully random movie instead of similarity-based. Creates "seeds" for new exploration directions.

**Performance**: 80k × 16-dim brute-force = ~1.3M ops. Web Worker: <2ms. Full row (15 cells): <30ms.

## Rendering

**Viewport**: transform state `{offsetX, offsetY, scale}`. Conversion: `screenX = worldX * scale + offsetX`.

**Culling**: only draw cells in viewport + 1-row buffer. ~24 visible cells on phone, ~60 with buffer.

**Gestures** (touch events on canvas):
- **Pan**: single finger, inertia via requestAnimationFrame + velocity decay
- **Pinch-zoom**: two fingers, zoom toward focal point
- **Tap**: detected via distance/time threshold (vs pan)

**Poster loading**:
- `Image()` objects in LRU cache (max ~200)
- Load only for visible + buffer cells
- Placeholder: colored rect (hue from embedding byte) while loading

**Render loop**: requestAnimationFrame, only when dirty (viewport changed or poster loaded).

**Generation trigger**: when viewport reaches <1 row from edge of filled area → expand in that direction via Worker.

## Architecture

```
src/
  main.ts              — entry, init
  canvas/
    renderer.ts        — render loop, drawImage, culling
    viewport.ts        — transform state, coordinate math
    gestures.ts        — touch/mouse, pan/pinch/tap with inertia
  engine/
    grid.ts            — Map<key, MovieCell>, expansion logic
    generator.ts       — similarity + random algorithm
    embeddings.ts      — load/parse .bin, brute-force search
    worker.ts          — Web Worker wrapper
  data/
    poster-cache.ts    — LRU Image cache
    api.ts             — TMDB API for details on tap
  ui/
    movie-card.ts      — HTML overlay for movie details
  sw.ts                — Service Worker, cache shell + embeddings
scripts/
  pipeline.py          — TMDB → UMAP → quantize → .bin
```

**Data flow**:
1. `main` → load `embeddings.bin` → init `grid`, `renderer`
2. `gestures` → update `viewport` → `renderer.render()`
3. Scroll to edge → `grid.expand(dir)` → Worker: `generator.generate()` → `grid.add()` → render
4. `poster-cache` loads images async → re-render on load
5. Tap → `movie-card` overlay → `api.fetchDetails(tmdbId)`

**PWA**: Service Worker caches app shell + embeddings.bin. Repeat visits: instant, works offline (except new poster images).

## Key Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Embedding dims | 16 (UMAP from 768) | Balance: quality vs size. 16-dim uint8 = 16 bytes/movie |
| Search method | Brute-force in Worker | 80k × 16-dim = trivial. No index overhead. |
| Random mix | 20% fully random | Prevents similarity bubble, creates exploration seeds |
| Rendering | Canvas 2D | Simpler than WebGL for image grid, sufficient perf |
| Framework | Vanilla TS | Canvas app doesn't benefit from React/Vue, less overhead |
| Metadata loading | Lazy (TMDB API on tap) | Minimizes initial data. Only ID + poster_path preloaded |

## Resolved Questions

1. **NOISE_FACTOR**: start with 0.15, tune later
2. **Zoom**: visual only — more/fewer cards visible, same grid
3. **Gap**: zero — wall-to-wall posters
4. **Initial experience**: random seed
5. **Memory**: evict cells beyond viewport + buffer zone (keeps navigation smooth, frees memory for distant cells)
