const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p/w185'
const MAX_CACHED = 200

export interface PosterCache {
  cache: Map<string, HTMLImageElement>
  order: string[]
  onLoad: () => void
  get(posterPath: string): HTMLImageElement | undefined
  load(posterPath: string): void
}

export function createPosterCache(onLoad: () => void): PosterCache {
  const cache = new Map<string, HTMLImageElement>()
  const order: string[] = []

  return {
    cache,
    order,
    onLoad,

    get(posterPath: string): HTMLImageElement | undefined {
      if (!posterPath) return undefined
      return cache.get(posterPath)
    },

    load(posterPath: string): void {
      if (!posterPath || cache.has(posterPath)) return

      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = `${TMDB_IMG_BASE}${posterPath}`
      img.onload = onLoad
      cache.set(posterPath, img)
      order.push(posterPath)

      // LRU eviction
      while (order.length > MAX_CACHED) {
        const old = order.shift()!
        cache.delete(old)
      }
    },
  }
}
