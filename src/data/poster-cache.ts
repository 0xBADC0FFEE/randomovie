import { CELL_W } from '../canvas/viewport.ts'

const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p/'
const MAX_CACHED = 400
const TMDB_SIZES = [92, 154, 185, 342, 500, 780] as const

export type TmdbSize = (typeof TMDB_SIZES)[number]

export function pickSize(scale: number, dpr: number): TmdbSize {
  const needed = CELL_W * scale * dpr
  for (const s of TMDB_SIZES) {
    if (s >= needed) return s
  }
  return TMDB_SIZES[TMDB_SIZES.length - 1]
}

export interface PosterCache {
  cache: Map<string, HTMLImageElement>
  order: string[]
  onLoad: () => void
  pickSize: typeof pickSize
  get(posterPath: string, size: TmdbSize): HTMLImageElement | undefined
  getBestAvailable(posterPath: string, size: TmdbSize): HTMLImageElement | undefined
  load(posterPath: string, size: TmdbSize): void
}

export function createPosterCache(onLoad: () => void): PosterCache {
  const cache = new Map<string, HTMLImageElement>()
  const order: string[] = []

  function cacheKey(posterPath: string, size: TmdbSize): string {
    return `w${size}:${posterPath}`
  }

  return {
    cache,
    order,
    onLoad,
    pickSize,

    get(posterPath: string, size: TmdbSize): HTMLImageElement | undefined {
      if (!posterPath) return undefined
      return cache.get(cacheKey(posterPath, size))
    },

    getBestAvailable(posterPath: string, size: TmdbSize): HTMLImageElement | undefined {
      if (!posterPath) return undefined
      // Walk sizes downward from requested, return first complete image
      for (let i = TMDB_SIZES.indexOf(size); i >= 0; i--) {
        const img = cache.get(cacheKey(posterPath, TMDB_SIZES[i]))
        if (img?.complete && img.naturalWidth > 0) return img
      }
      // Also check sizes above requested (in case a larger one is cached)
      for (let i = TMDB_SIZES.indexOf(size) + 1; i < TMDB_SIZES.length; i++) {
        const img = cache.get(cacheKey(posterPath, TMDB_SIZES[i]))
        if (img?.complete && img.naturalWidth > 0) return img
      }
      return undefined
    },

    load(posterPath: string, size: TmdbSize): void {
      const key = cacheKey(posterPath, size)
      if (!posterPath || cache.has(key)) return

      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = `${TMDB_IMG_BASE}w${size}${posterPath}`
      img.onload = onLoad
      cache.set(key, img)
      order.push(key)

      // LRU eviction
      while (order.length > MAX_CACHED) {
        const old = order.shift()!
        cache.delete(old)
      }
    },
  }
}
