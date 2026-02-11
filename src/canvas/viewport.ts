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

const DIR_THRESHOLD = 0.5

/** Asymmetric buffer: more cells ahead of movement, fewer behind. */
export function getDirectionalRange(vp: Viewport, buffer: number, vx: number, vy: number): CellRange {
  const sym = getVisibleRange(vp, buffer)
  if (Math.abs(vx) < DIR_THRESHOLD && Math.abs(vy) < DIR_THRESHOLD) return sym

  const base = getVisibleRange(vp, 0)
  const ahead = Math.round(buffer * 0.8)
  const behind = buffer - ahead

  let minCol: number, maxCol: number, minRow: number, maxRow: number

  if (Math.abs(vx) >= DIR_THRESHOLD) {
    // vx > 0 (drag right) → world left → ahead = lower cols
    minCol = base.minCol - (vx > 0 ? ahead : behind)
    maxCol = base.maxCol + (vx > 0 ? behind : ahead)
  } else {
    minCol = sym.minCol
    maxCol = sym.maxCol
  }

  if (Math.abs(vy) >= DIR_THRESHOLD) {
    minRow = base.minRow - (vy > 0 ? ahead : behind)
    maxRow = base.maxRow + (vy > 0 ? behind : ahead)
  } else {
    minRow = sym.minRow
    maxRow = sym.maxRow
  }

  return { minCol, maxCol, minRow, maxRow }
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
