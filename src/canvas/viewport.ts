export const CELL_W = 120
export const CELL_H = 180
export const PRELOAD_BUFFER = 5

export interface Viewport {
  offsetX: number
  offsetY: number
  scale: number
  width: number
  height: number
}

export function createViewport(width: number, height: number): Viewport {
  return { offsetX: 0, offsetY: 0, scale: 1, width, height }
}

export function worldToScreen(vp: Viewport, wx: number, wy: number): [number, number] {
  return [wx * vp.scale + vp.offsetX, wy * vp.scale + vp.offsetY]
}

export function screenToWorld(vp: Viewport, sx: number, sy: number): [number, number] {
  return [(sx - vp.offsetX) / vp.scale, (sy - vp.offsetY) / vp.scale]
}

export interface CellRange {
  minCol: number
  maxCol: number
  minRow: number
  maxRow: number
}

const CENTER_OUT_CACHE_MAX = 32
const centerOutOffsetCache = new Map<string, [number, number][]>()

function sizeKey(cols: number, rows: number): string {
  return `${cols}:${rows}`
}

/** Stable center-out offset order for a range size (translation-invariant cache). */
export function getCenterOutOffsets(cols: number, rows: number): [number, number][] {
  const key = sizeKey(cols, rows)
  const cached = centerOutOffsetCache.get(key)
  if (cached) {
    // Refresh LRU order.
    centerOutOffsetCache.delete(key)
    centerOutOffsetCache.set(key, cached)
    return cached
  }

  const cx = (cols - 1) / 2
  const cy = (rows - 1) / 2
  const offsets: [number, number][] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      offsets.push([col, row])
    }
  }
  offsets.sort((a, b) =>
    (a[0] - cx) ** 2 + (a[1] - cy) ** 2 - (b[0] - cx) ** 2 - (b[1] - cy) ** 2
  )

  centerOutOffsetCache.set(key, offsets)
  if (centerOutOffsetCache.size > CENTER_OUT_CACHE_MAX) {
    const oldest = centerOutOffsetCache.keys().next().value
    if (oldest) centerOutOffsetCache.delete(oldest)
  }
  return offsets
}

/** Visible cell range + buffer rows around viewport */
export function getVisibleRange(vp: Viewport, buffer = 2): CellRange {
  const [wx0, wy0] = screenToWorld(vp, 0, 0)
  const [wx1, wy1] = screenToWorld(vp, vp.width, vp.height)
  return {
    minCol: Math.floor(wx0 / CELL_W) - buffer,
    maxCol: Math.ceil(wx1 / CELL_W) + buffer,
    minRow: Math.floor(wy0 / CELL_H) - buffer,
    maxRow: Math.ceil(wy1 / CELL_H) + buffer,
  }
}

/** Center viewport on cell (0,0) */
export const MAX_VISIBLE_CELLS = 78

export function getMinScale(vp: Viewport): number {
  return Math.sqrt((vp.width * vp.height) / (CELL_W * CELL_H * MAX_VISIBLE_CELLS))
}

/** Center viewport on cell (0,0) */
export function centerOn(vp: Viewport, col: number, row: number): void {
  vp.offsetX = vp.width / 2 - (col + 0.5) * CELL_W * vp.scale
  vp.offsetY = vp.height / 2 - (row + 0.5) * CELL_H * vp.scale
}
