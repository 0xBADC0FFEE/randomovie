import type { EmbeddingsIndex, MovieEntry } from './embeddings.ts'
import { EMBED_DIM, findTopK } from './embeddings.ts'
import type { Grid, MovieCell } from './grid.ts'

const NOISE_FACTOR = 0.15
const RANDOM_CHANCE = 0.2
const NEIGHBOR_RADIUS = 3
const TOP_K = 10

export function generateMovie(
  col: number,
  row: number,
  grid: Grid,
  index: EmbeddingsIndex,
): MovieCell | null {
  // Collect filled neighbors within radius
  const neighbors: { cell: MovieCell; weight: number }[] = []
  for (let dr = -NEIGHBOR_RADIUS; dr <= NEIGHBOR_RADIUS; dr++) {
    for (let dc = -NEIGHBOR_RADIUS; dc <= NEIGHBOR_RADIUS; dc++) {
      if (dc === 0 && dr === 0) continue
      const cell = grid.cells.get(`${col + dc}:${row + dr}`)
      if (!cell) continue
      const d = Math.sqrt(dc * dc + dr * dr)
      neighbors.push({ cell, weight: 1 / d })
    }
  }

  // Random injection
  if (neighbors.length === 0 || Math.random() < RANDOM_CHANCE) {
    return pickRandom(index, grid.onScreen)
  }

  // Weighted average embedding
  const target = new Float32Array(EMBED_DIM)
  let totalW = 0
  for (const { cell, weight } of neighbors) {
    for (let j = 0; j < EMBED_DIM; j++) {
      target[j] += cell.embedding[j] * weight
    }
    totalW += weight
  }
  for (let j = 0; j < EMBED_DIM; j++) {
    target[j] /= totalW
  }

  // Add noise
  for (let j = 0; j < EMBED_DIM; j++) {
    target[j] += (Math.random() - 0.5) * 255 * NOISE_FACTOR
    target[j] = Math.max(0, Math.min(255, target[j]))
  }

  const candidates = findTopK(index, target, TOP_K, grid.onScreen)
  if (candidates.length === 0) return null

  // Weighted random pick: favor closer matches
  return movieEntryToCell(weightedPick(candidates))
}

function pickRandom(index: EmbeddingsIndex, exclude: Set<number>): MovieCell | null {
  for (let attempt = 0; attempt < 20; attempt++) {
    const entry = index.movies[Math.floor(Math.random() * index.movies.length)]
    if (!exclude.has(entry.tmdbId)) return movieEntryToCell(entry)
  }
  // Fallback: just pick anything
  const entry = index.movies[Math.floor(Math.random() * index.movies.length)]
  return movieEntryToCell(entry)
}

function weightedPick(candidates: MovieEntry[]): MovieEntry {
  // Inverse rank weighting: first gets weight K, last gets weight 1
  const weights = candidates.map((_, i) => candidates.length - i)
  const total = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]
    if (r <= 0) return candidates[i]
  }
  return candidates[0]
}

function movieEntryToCell(entry: MovieEntry): MovieCell {
  return {
    tmdbId: entry.tmdbId,
    posterPath: entry.posterPath,
    embedding: entry.embedding,
  }
}
