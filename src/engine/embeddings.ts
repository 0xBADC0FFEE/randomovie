export const EMBED_DIM = 16

export interface MovieEntry {
  tmdbId: number
  posterPath: string
  embedding: Uint8Array
}

export interface EmbeddingsIndex {
  movies: MovieEntry[]
}

/** Parse binary embeddings file */
export function parseEmbeddings(buffer: ArrayBuffer): EmbeddingsIndex {
  const view = new DataView(buffer)
  const count = view.getUint32(0, true)
  const movies: MovieEntry[] = []
  let offset = 4

  for (let i = 0; i < count; i++) {
    const tmdbId = view.getUint32(offset, true)
    offset += 4

    const pathLen = view.getUint8(offset)
    offset += 1

    const pathBytes = new Uint8Array(buffer, offset, pathLen)
    const posterPath = new TextDecoder().decode(pathBytes)
    offset += pathLen

    const embedding = new Uint8Array(buffer, offset, EMBED_DIM)
    // Copy so it's not a view into the original buffer (allows GC)
    const embCopy = new Uint8Array(EMBED_DIM)
    embCopy.set(embedding)
    offset += EMBED_DIM

    movies.push({ tmdbId, posterPath, embedding: embCopy })
  }

  return { movies }
}

/** Brute-force find top-K closest movies to target vector.
 *  Single-pass selection: O(n) scan + O(K) updates per candidate. */
export function findTopK(
  index: EmbeddingsIndex,
  target: Float32Array,
  k: number,
  exclude: Set<number>,
  isAllowed?: (tmdbId: number) => boolean,
): MovieEntry[] {
  const topMovies: (MovieEntry | null)[] = new Array(k).fill(null)
  const topDist: Float64Array = new Float64Array(k).fill(Infinity)
  let worstIdx = 0
  let worstDist = Infinity

  for (const movie of index.movies) {
    if (exclude.has(movie.tmdbId)) continue
    if (isAllowed && !isAllowed(movie.tmdbId)) continue
    let d = 0
    for (let j = 0; j < EMBED_DIM; j++) {
      const diff = target[j] - movie.embedding[j]
      d += diff * diff
    }
    if (d >= worstDist) continue

    topMovies[worstIdx] = movie
    topDist[worstIdx] = d

    // find new worst in K-best
    worstIdx = 0
    worstDist = topDist[0]
    for (let i = 1; i < k; i++) {
      if (topDist[i] > worstDist) {
        worstDist = topDist[i]
        worstIdx = i
      }
    }
  }

  // collect non-null results, sort by distance
  const results: { movie: MovieEntry; dist: number }[] = []
  for (let i = 0; i < k; i++) {
    if (topMovies[i]) results.push({ movie: topMovies[i]!, dist: topDist[i] })
  }
  results.sort((a, b) => a.dist - b.dist)
  return results.map(r => r.movie)
}

/** Generate mock data for development */
export function generateMockIndex(count: number): EmbeddingsIndex {
  const movies: MovieEntry[] = []
  for (let i = 0; i < count; i++) {
    const embedding = new Uint8Array(EMBED_DIM)
    for (let j = 0; j < EMBED_DIM; j++) {
      embedding[j] = Math.floor(Math.random() * 256)
    }
    movies.push({
      tmdbId: i + 1,
      posterPath: '',  // no poster in mock mode
      embedding,
    })
  }
  return { movies }
}
