import type { Viewport } from './viewport.ts'
import { CELL_W, CELL_H, PRELOAD_BUFFER, getVisibleRange, worldToScreen } from './viewport.ts'
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

  const toLoad: { col: number; row: number; cellKey: string; posterPath: string }[] = []
  const cx = (range.minCol + range.maxCol) / 2
  const cy = (range.minRow + range.maxRow) / 2

  for (let row = range.minRow; row <= range.maxRow; row++) {
    for (let col = range.minCol; col <= range.maxCol; col++) {
      const cellKey = `${col}:${row}`
      const cell = grid.cells.get(cellKey)
      if (!cell) continue

      const [sx, sy] = worldToScreen(vp, col * CELL_W, row * CELL_H)

      // Off-screen but in buffer: still queue poster load, skip drawing
      if (sx + cellScreenW < 0 || sy + cellScreenH < 0 || sx > vp.width || sy > vp.height) {
        if (!Posters.get(cellKey, size)) {
          toLoad.push({ col, row, cellKey, posterPath: cell.posterPath })
        }
        continue
      }

      const img = Posters.getBestAvailable(cellKey, size)
      if (img) {
        ctx.drawImage(img, sx, sy, cellScreenW, cellScreenH)
        // If best available isn't the ideal size, request upgrade
        if (!Posters.get(cellKey, size)) {
          toLoad.push({ col, row, cellKey, posterPath: cell.posterPath })
        }
      } else {
        // Placeholder: hue derived from embedding
        const hue = (cell.embedding[0] / 255) * 360
        ctx.fillStyle = `hsl(${hue}, 40%, 20%)`
        ctx.fillRect(sx, sy, cellScreenW, cellScreenH)
        toLoad.push({ col, row, cellKey, posterPath: cell.posterPath })
      }
    }
  }

  // Load posters center-outward
  toLoad.sort((a, b) =>
    (a.col - cx) ** 2 + (a.row - cy) ** 2 - (b.col - cx) ** 2 - (b.row - cy) ** 2
  )
  for (const { cellKey, posterPath } of toLoad) {
    Posters.load(cellKey, posterPath, size)
  }

}

export function preloadPosters(vp: Viewport, grid: Grid) {
  const range = getVisibleRange(vp)
  const preloadRange = getVisibleRange(vp, PRELOAD_BUFFER)
  const dpr = window.devicePixelRatio || 1
  const size = Posters.pickSize(vp.scale, dpr)
  const toLoad: { col: number; row: number; cellKey: string; posterPath: string }[] = []
  const cx = (preloadRange.minCol + preloadRange.maxCol) / 2
  const cy = (preloadRange.minRow + preloadRange.maxRow) / 2

  for (let row = preloadRange.minRow; row <= preloadRange.maxRow; row++) {
    for (let col = preloadRange.minCol; col <= preloadRange.maxCol; col++) {
      if (row >= range.minRow && row <= range.maxRow
        && col >= range.minCol && col <= range.maxCol) continue
      const cellKey = `${col}:${row}`
      const cell = grid.cells.get(cellKey)
      if (!cell) continue
      toLoad.push({ col, row, cellKey, posterPath: cell.posterPath })
    }
  }

  toLoad.sort((a, b) =>
    (a.col - cx) ** 2 + (a.row - cy) ** 2 - (b.col - cx) ** 2 - (b.row - cy) ** 2
  )
  for (const { cellKey, posterPath } of toLoad) {
    Posters.load(cellKey, posterPath, size)
  }
}
