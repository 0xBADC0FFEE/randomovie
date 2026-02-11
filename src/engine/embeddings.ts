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

/** Brute-force find top-K closest movies to target vector */
export function findTopK(
  index: EmbeddingsIndex,
  target: Float32Array,
  k: number,
  exclude: Set<number>,
): MovieEntry[] {
  const scored: { movie: MovieEntry; dist: number }[] = []

  for (const movie of index.movies) {
    if (exclude.has(movie.tmdbId)) continue
    let d = 0
    for (let j = 0; j < EMBED_DIM; j++) {
      const diff = target[j] - movie.embedding[j]
      d += diff * diff
    }
    scored.push({ movie, dist: d })
  }

  scored.sort((a, b) => a.dist - b.dist)
  return scored.slice(0, k).map((s) => s.movie)
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
