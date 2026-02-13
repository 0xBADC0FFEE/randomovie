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

const CENTER_OUT_CACHE_MAX = 64
const centerOutCache = new Map<string, [number, number][]>()

function rangeKey(range: CellRange): string {
  return `${range.minCol}:${range.maxCol}:${range.minRow}:${range.maxRow}`
}

/** Stable center-out coordinate order for a range (cached, reused in hot paths). */
export function getCenterOutCoords(range: CellRange): [number, number][] {
  const key = rangeKey(range)
  const cached = centerOutCache.get(key)
  if (cached) {
    // Refresh LRU order.
    centerOutCache.delete(key)
    centerOutCache.set(key, cached)
    return cached
  }

  const cx = (range.minCol + range.maxCol) / 2
  const cy = (range.minRow + range.maxRow) / 2
  const coords: [number, number][] = []
  for (let row = range.minRow; row <= range.maxRow; row++) {
    for (let col = range.minCol; col <= range.maxCol; col++) {
      coords.push([col, row])
    }
  }
  coords.sort((a, b) =>
    (a[0] - cx) ** 2 + (a[1] - cy) ** 2 - (b[0] - cx) ** 2 - (b[1] - cy) ** 2
  )

  centerOutCache.set(key, coords)
  if (centerOutCache.size > CENTER_OUT_CACHE_MAX) {
    const oldest = centerOutCache.keys().next().value
    if (oldest) centerOutCache.delete(oldest)
  }
  return coords
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
