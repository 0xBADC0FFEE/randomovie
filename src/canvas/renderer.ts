import type { Viewport } from './viewport.ts'
import { CELL_W, CELL_H, PRELOAD_BUFFER, getVisibleRange, getDirectionalRange, worldToScreen } from './viewport.ts'
import type { Grid } from '../engine/grid.ts'
import * as Posters from './poster-loader.ts'

export function render(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  grid: Grid,
) {
  ctx.clearRect(0, 0, vp.width, vp.height)

  const range = getVisibleRange(vp)
  const cellScreenW = CELL_W * vp.scale
  const cellScreenH = CELL_H * vp.scale

  const dpr = window.devicePixelRatio || 1
  const size = Posters.pickSize(vp.scale, dpr)

  for (let row = range.minRow; row <= range.maxRow; row++) {
    for (let col = range.minCol; col <= range.maxCol; col++) {
      const cellKey = `${col}:${row}`
      const cell = grid.cells.get(cellKey)
      if (!cell) continue

      const [sx, sy] = worldToScreen(vp, col * CELL_W, row * CELL_H)

      // Skip if fully off-screen
      if (sx + cellScreenW < 0 || sy + cellScreenH < 0 || sx > vp.width || sy > vp.height) continue

      const img = Posters.getBestAvailable(cellKey, size)
      if (img) {
        ctx.drawImage(img, sx, sy, cellScreenW, cellScreenH)
        // If best available isn't the ideal size, request upgrade
        if (!Posters.get(cellKey, size)) {
          Posters.load(cellKey, cell.posterPath, size)
        }
      } else {
        // Placeholder: hue derived from embedding
        const hue = (cell.embedding[0] / 255) * 360
        ctx.fillStyle = `hsl(${hue}, 40%, 20%)`
        ctx.fillRect(sx, sy, cellScreenW, cellScreenH)
        Posters.load(cellKey, cell.posterPath, size)
      }
    }
  }

}

export function preloadPosters(
  vp: Viewport, grid: Grid, vx: number, vy: number,
) {
  const range = getVisibleRange(vp)
  const preloadRange = getDirectionalRange(vp, PRELOAD_BUFFER, vx, vy)
  const dpr = window.devicePixelRatio || 1
  const size = Posters.pickSize(vp.scale, dpr)
  for (let row = preloadRange.minRow; row <= preloadRange.maxRow; row++) {
    for (let col = preloadRange.minCol; col <= preloadRange.maxCol; col++) {
      if (row >= range.minRow && row <= range.maxRow
        && col >= range.minCol && col <= range.maxCol) continue
      const cellKey = `${col}:${row}`
      const cell = grid.cells.get(cellKey)
      if (!cell) continue
      Posters.load(cellKey, cell.posterPath, size)
    }
  }
}
