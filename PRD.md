# Randomovie — PRD

## Problem

Choosing a movie is painful. Streaming UIs show ranked lists or categories — you scroll endlessly, read descriptions, and still can't decide. There's no way to *feel* what's nearby in taste-space.

## Solution

Infinite 2D canvas of movie posters. No lists, no categories. You pan around, and the canvas fills with movies similar to what's already on screen. Swipe toward something you like — more of that appears. Random movies are mixed in so you never hit a dead end.

## Core Experience

1. Open the app → wall of posters, random seed
2. Pan in any direction → new posters appear at edges, similar to visible neighbors
3. Keep swiping toward what catches your eye → the canvas adapts
4. Random posters sprinkled in → create new exploration paths
5. Type to search → center poster swaps, neighbors regenerate
6. Tap a poster → see details (title, year, rating, description)
7. That's it. No accounts, no ratings, no watchlists (for now)

## How Similarity Works

- Each movie has a 16-dimensional embedding vector (UMAP-reduced from text embeddings of plot + genres + cast)
- When a new cell needs filling: average the embeddings of visible neighbors (weighted by proximity), add noise, find closest match
- Scroll direction is extrapolated to continue genre trends (gradient extrapolation)
- 5% of new cells are fully random — prevents similarity bubbles, seeds new directions
- Already-placed movies never change

## Constraints

- **No backend**: all data precomputed, served as static files from CDN
- **Client-side only**: similarity search runs in-browser (~1ms per query)
- **Initial download**: ~5MB (embeddings + titles + app shell), cached by Service Worker
- **Poster images**: loaded on demand from TMDB CDN
- **Catalog**: ~80k movies (filtered from TMDB: has poster, >100 votes, rating >5.0)

## Platform

PWA. Works on any phone or desktop browser. Installable to home screen.

## Stack

- Vanilla TypeScript + Vite (no framework)
- HTML5 Canvas 2D rendering
- TMDB for posters and metadata
- Kaggle dataset ([alanvourch/tmdb-movies-daily-updates](https://www.kaggle.com/datasets/alanvourch/tmdb-movies-daily-updates)) + Ollama embeddings

## MVP Scope (v0.1) — done

- [x] Infinite canvas with pan, pinch-zoom, inertia
- [x] Similarity-driven cell generation with random mixing
- [x] Hue-based placeholders while posters load
- [x] LRU poster cache (400 entries, adaptive resolution by zoom)
- [x] Cell eviction outside viewport + buffer
- [x] Mock data fallback (works without embeddings.bin)
- [x] Data pipeline script (Kaggle → Ollama embeddings → UMAP → quantize → .bin)
- [x] Ship real embeddings.bin + titles.bin
- [x] Fuzzy title search (Web Worker)

## v0.2 — next

- [ ] Tap → movie detail card (overlay with title, year, rating, plot, links to streaming)
- [ ] Service Worker for offline / instant reload
- [ ] Loading state on first visit (while embeddings download)

## v0.3 — polish

- [ ] Smooth poster fade-in (instead of instant pop)
- [ ] Subtle grid lines or shadow between posters for depth
- [ ] "Where am I" minimap or breadcrumb (how far from center)
- [ ] Share position link (encode viewport state in URL)

## Future (maybe)

- [ ] Tap-and-hold to "anchor" a movie — nearby tiles recalculate to be even more similar
- [ ] Genre/decade/country filters that bias the random injection
- [ ] Personal watchlist (localStorage)
- [ ] "Surprise me" button — teleport to random canvas region
- [ ] Collaborative mode — see other people's cursors exploring the same canvas

## Non-Goals

- User accounts / auth
- Server-side recommendation engine
- Social features (reviews, ratings)
- Monetization
- Offline poster caching (posters always need network)

## Metrics (when relevant)

- Time spent exploring (session duration)
- Tap rate (% of visible posters tapped)
- Return visits
- Scroll distance / velocity patterns
