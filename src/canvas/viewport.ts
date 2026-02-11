export const CELL_W = 120
export const CELL_H = 180

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

/** Center viewport on cell (0,0) */
export function centerOn(vp: Viewport, col: number, row: number): void {
  vp.offsetX = vp.width / 2 - (col + 0.5) * CELL_W * vp.scale
  vp.offsetY = vp.height / 2 - (row + 0.5) * CELL_H * vp.scale
}
