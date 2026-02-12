import type { Viewport } from './viewport.ts'
import { CELL_W, CELL_H, PRELOAD_BUFFER, getVisibleRange, worldToScreen } from './viewport.ts'
import type { Grid } from '../engine/grid.ts'
import type { TitlesIndex } from '../engine/titles.ts'
import * as Posters from './poster-loader.ts'

function drawRating(
  ctx: CanvasRenderingContext2D,
  rating: number | undefined,
  sx: number, sy: number,
  w: number, h: number,
) {
  const r = rating ?? -1
  const has = r >= 0
  const t = has ? Math.min(1, Math.max(0, (r - 50) / 30)) : 0
  const s = w / CELL_W
  const cx = sx + w * 0.85
  const cy = sy + h * 0.85
  const TAU = Math.PI * 2
  const R = 7 * s

  ctx.globalCompositeOperation = 'difference'
  ctx.fillStyle = '#fff'
  ctx.globalAlpha = has ? 0.4 : 0.08

  const numPts = t < 0.5 ? 32 : t < 0.8 ? 4 : 5
  const starness = Math.min(1, t * 1.5)
  const innerR = R * (1 - starness * 0.55)

  ctx.beginPath()
  if (numPts >= 32) {
    ctx.arc(cx, cy, R * (0.4 + t * 0.6), 0, TAU)
  } else {
    for (let i = 0; i < numPts * 2; i++) {
      const a = (i * Math.PI) / numPts - Math.PI / 2
      const rd = i % 2 === 0 ? R : innerR
      if (i === 0) ctx.moveTo(cx + Math.cos(a) * rd, cy + Math.sin(a) * rd)
      else ctx.lineTo(cx + Math.cos(a) * rd, cy + Math.sin(a) * rd)
    }
    ctx.closePath()
  }
  ctx.fill()

  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

export function render(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  grid: Grid,
  titlesIndex?: TitlesIndex | null,
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

      // Rating overlay
      if (titlesIndex) {
        const idx = titlesIndex.idToIdx.get(cell.tmdbId)
        const rating = idx !== undefined ? titlesIndex.ratings[idx] : undefined
        drawRating(ctx, rating, sx, sy, cellScreenW, cellScreenH)
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
