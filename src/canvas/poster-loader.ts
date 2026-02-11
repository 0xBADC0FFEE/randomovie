import { CELL_W } from './viewport.ts'

const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p/'
const MAX_CONCURRENT = 8
const TMDB_SIZES = [92, 154, 185, 342, 500, 780] as const

export type TmdbSize = (typeof TMDB_SIZES)[number]

/** Map<cellKey, Map<TmdbSize, HTMLImageElement>> */
const store = new Map<string, Map<TmdbSize, HTMLImageElement>>()
let inFlight = 0
let onLoad: (() => void) | undefined

export function setOnLoad(cb: () => void) {
  onLoad = cb
}

export function pickSize(scale: number, dpr: number): TmdbSize {
  const needed = CELL_W * scale * dpr
  for (const s of TMDB_SIZES) {
    if (s >= needed) return s
  }
  return TMDB_SIZES[TMDB_SIZES.length - 1]
}

export function get(cellKey: string, size: TmdbSize): HTMLImageElement | undefined {
  return store.get(cellKey)?.get(size)
}

export function getBestAvailable(cellKey: string, size: TmdbSize): HTMLImageElement | undefined {
  const cell = store.get(cellKey)
  if (!cell) return undefined
  // Walk sizes downward from requested
  for (let i = TMDB_SIZES.indexOf(size); i >= 0; i--) {
    const img = cell.get(TMDB_SIZES[i])
    if (img?.complete && img.naturalWidth > 0) return img
  }
  // Check sizes above requested
  for (let i = TMDB_SIZES.indexOf(size) + 1; i < TMDB_SIZES.length; i++) {
    const img = cell.get(TMDB_SIZES[i])
    if (img?.complete && img.naturalWidth > 0) return img
  }
  return undefined
}

export function load(cellKey: string, posterPath: string, size: TmdbSize): void {
  if (!posterPath) return
  let cell = store.get(cellKey)
  if (cell?.has(size)) return
  if (inFlight >= MAX_CONCURRENT) return

  if (!cell) {
    cell = new Map()
    store.set(cellKey, cell)
  }

  inFlight++
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = `${TMDB_IMG_BASE}w${size}${posterPath}`
  img.onload = () => { inFlight--; onLoad?.() }
  img.onerror = () => { inFlight--; cell!.delete(size) }
  cell.set(size, img)
}

export function evictImages(keys: string[]) {
  for (const k of keys) store.delete(k)
}

export function clearAllImages() {
  store.clear()
}
