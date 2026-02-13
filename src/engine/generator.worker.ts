/// <reference lib="webworker" />
import { EMBED_DIM } from './embeddings.ts'

interface WorkerMovie {
  tmdbId: number
  embedding: Uint8Array
}

let movies: WorkerMovie[] = []
let activeEpoch = 0

function findTopKTmdbIds(
  target: Float32Array,
  k: number,
  exclude: Set<number>,
): number[] {
  const topIds: Int32Array = new Int32Array(k)
  const topDist: Float64Array = new Float64Array(k).fill(Infinity)
  let worstIdx = 0
  let worstDist = Infinity

  for (const movie of movies) {
    if (exclude.has(movie.tmdbId)) continue
    let d = 0
    for (let j = 0; j < EMBED_DIM; j++) {
      const diff = target[j] - movie.embedding[j]
      d += diff * diff
    }
    if (d >= worstDist) continue

    topIds[worstIdx] = movie.tmdbId
    topDist[worstIdx] = d

    worstIdx = 0
    worstDist = topDist[0]
    for (let i = 1; i < k; i++) {
      if (topDist[i] > worstDist) {
        worstDist = topDist[i]
        worstIdx = i
      }
    }
  }

  const result: { tmdbId: number; dist: number }[] = []
  for (let i = 0; i < k; i++) {
    const tmdbId = topIds[i]
    if (tmdbId > 0 && Number.isFinite(topDist[i])) {
      result.push({ tmdbId, dist: topDist[i] })
    }
  }
  result.sort((a, b) => a.dist - b.dist)
  return result.map((x) => x.tmdbId)
}

self.onmessage = (e: MessageEvent) => {
  const { type } = e.data

  if (type === 'init') {
    activeEpoch = e.data.epoch as number
    const input = e.data.movies as WorkerMovie[]
    movies = input.map((m) => ({
      tmdbId: m.tmdbId,
      embedding: m.embedding,
    }))
    self.postMessage({ type: 'ready', epoch: activeEpoch })
    return
  }

  if (type === 'topk') {
    const reqId = e.data.reqId as number
    const epoch = e.data.epoch as number
    if (epoch !== activeEpoch || movies.length === 0) {
      self.postMessage({ type: 'result', reqId, epoch, tmdbIds: [] })
      return
    }
    const target = e.data.target as Float32Array
    const k = e.data.k as number
    const exclude = new Set<number>(e.data.exclude as number[])
    const tmdbIds = findTopKTmdbIds(target, k, exclude)
    self.postMessage({ type: 'result', reqId, epoch, tmdbIds })
  }
}

