import type { EmbeddingsIndex, MovieEntry } from './embeddings.ts'
import { EMBED_DIM, findTopK } from './embeddings.ts'
import type { Grid, MovieCell } from './grid.ts'

const NOISE_FACTOR = 0.08
const RANDOM_CHANCE = 0.05
const NEIGHBOR_RADIUS = 3
const TOP_K = 10
const MOMENTUM = 0.5

export const lastGenStats = { neighborCount: 0, noise: 0, diversityMode: false }

export function generateMovie(
  col: number,
  row: number,
  grid: Grid,
  index: EmbeddingsIndex,
  coherent = false,
  noiseFactor?: number,
  randomChance?: number,
): MovieCell | null {
  // Collect filled neighbors within radius
  const neighbors: { cell: MovieCell; weight: number; dc: number; dr: number }[] = []
  for (let dr = -NEIGHBOR_RADIUS; dr <= NEIGHBOR_RADIUS; dr++) {
    for (let dc = -NEIGHBOR_RADIUS; dc <= NEIGHBOR_RADIUS; dc++) {
      if (dc === 0 && dr === 0) continue
      const cell = grid.cells.get(`${col + dc}:${row + dr}`)
      if (!cell) continue
      const d = Math.sqrt(dc * dc + dr * dr)
      neighbors.push({ cell, weight: 1 / d, dc, dr })
    }
  }

  // No neighbors — pick random
  if (neighbors.length === 0) {
    lastGenStats.neighborCount = 0
    lastGenStats.noise = 0
    lastGenStats.diversityMode = false
    return pickRandom(index, grid.onScreen)
  }

  // Diversity injection: use neighbor blend with high noise instead of pure random
  const diversityMode = !coherent && Math.random() < (randomChance ?? RANDOM_CHANCE)

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

  // Gradient extrapolation — continue genre trends along scroll direction
  let centDc = 0, centDr = 0
  for (const { weight, dc, dr } of neighbors) {
    centDc += dc * weight
    centDr += dr * weight
  }
  centDc /= totalW
  centDr /= totalW

  let dirDc = -centDc, dirDr = -centDr
  const dirLen = Math.sqrt(dirDc * dirDc + dirDr * dirDr)
  if (dirLen > 0.01) {
    dirDc /= dirLen
    dirDr /= dirLen

    let varC = 0, varR = 0
    for (const { weight, dc, dr } of neighbors) {
      varC += weight * (dc - centDc) ** 2
      varR += weight * (dr - centDr) ** 2
    }

    for (let j = 0; j < EMBED_DIM; j++) {
      let gC = 0, gR = 0
      for (const { cell, weight, dc, dr } of neighbors) {
        const delta = cell.embedding[j] - target[j]
        gC += weight * (dc - centDc) * delta
        gR += weight * (dr - centDr) * delta
      }
      if (varC > 0) gC /= varC
      if (varR > 0) gR /= varR
      target[j] += (gC * dirDc + gR * dirDr) * MOMENTUM
    }

    for (let j = 0; j < EMBED_DIM; j++) {
      target[j] = Math.max(0, Math.min(255, target[j]))
    }
  }

  // Add noise (reduced in coherent mode, amplified in diversity mode)
  const baseNoise = noiseFactor ?? NOISE_FACTOR
  const noise = coherent ? 0.15 : diversityMode ? baseNoise * 4 : baseNoise
  lastGenStats.neighborCount = neighbors.length
  lastGenStats.noise = noise
  lastGenStats.diversityMode = diversityMode
  for (let j = 0; j < EMBED_DIM; j++) {
    target[j] += (Math.random() - 0.5) * 255 * noise
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
  // Linear rank weighting: favors closer matches but allows diversity
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
