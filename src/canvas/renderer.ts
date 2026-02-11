import type { Viewport } from './viewport.ts'
import { CELL_W, CELL_H, getVisibleRange, worldToScreen } from './viewport.ts'
import type { Grid } from '../engine/grid.ts'
import type { PosterCache } from '../data/poster-cache.ts'

export function render(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  grid: Grid,
  posterCache: PosterCache,
) {
  ctx.clearRect(0, 0, vp.width, vp.height)

  const range = getVisibleRange(vp)
  const cellScreenW = CELL_W * vp.scale
  const cellScreenH = CELL_H * vp.scale

  for (let row = range.minRow; row <= range.maxRow; row++) {
    for (let col = range.minCol; col <= range.maxCol; col++) {
      const cell = grid.cells.get(`${col}:${row}`)
      if (!cell) continue

      const [sx, sy] = worldToScreen(vp, col * CELL_W, row * CELL_H)

      // Skip if fully off-screen
      if (sx + cellScreenW < 0 || sy + cellScreenH < 0 || sx > vp.width || sy > vp.height) continue

      const img = posterCache.get(cell.posterPath)
      if (img?.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, sx, sy, cellScreenW, cellScreenH)
      } else {
        // Placeholder: hue derived from embedding
        const hue = (cell.embedding[0] / 255) * 360
        ctx.fillStyle = `hsl(${hue}, 40%, 20%)`
        ctx.fillRect(sx, sy, cellScreenW, cellScreenH)
        posterCache.load(cell.posterPath)
      }
    }
  }
}
