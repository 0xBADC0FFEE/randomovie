import type { Viewport } from './viewport.ts'
import { CELL_W, CELL_H, PRELOAD_BUFFER, getVisibleRange, worldToScreen } from './viewport.ts'
import type { Grid, MovieCell } from '../engine/grid.ts'
import type { TitlesIndex } from '../engine/titles.ts'
import * as Posters from './poster-loader.ts'
import type { WaveState } from './wave.ts'
import { updateWave, cellBump, computeBumpPhase, BUMP_UP_MIN } from './wave.ts'
import { buildRatingMorphPath } from '../ui/rating-morph.ts'

const FILTER_SWAP_TIMEOUT = 500

function drawRating(
  ctx: CanvasRenderingContext2D,
  rating: number | undefined,
  sx: number, sy: number,
  w: number, h: number,
  baseAlpha = 1,
) {
  const r = rating ?? -1
  const has = r >= 0
  const s = w / CELL_W
  const cx = sx + w * 0.85
  const cy = sy + h * 0.85
  const R = 7 * s

  ctx.globalCompositeOperation = 'difference'
  ctx.fillStyle = '#fff'
  ctx.globalAlpha = (has ? 0.4 : 0.08) * baseAlpha

  const { points } = buildRatingMorphPath({
    ratingX10: has ? r : 50,
    cx,
    cy,
    radius: R,
  })
  ctx.beginPath()
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  }
  ctx.closePath()
  ctx.fill()

  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = baseAlpha
}

export interface FilterSwapFxEntry {
  oldCell: MovieCell
  oldImgs: Map<Posters.TmdbSize, HTMLImageElement> | undefined
  createdAt: number
  startAt: number
  timeoutMs?: number
}

export function render(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  grid: Grid,
  titlesIndex?: TitlesIndex | null,
  wave?: WaveState | null,
  swapFx?: Map<string, FilterSwapFxEntry>,
  renderDpr?: number,
) {
  ctx.clearRect(0, 0, vp.width, vp.height)

  const range = getVisibleRange(vp)
  const cellScreenW = CELL_W * vp.scale
  const cellScreenH = CELL_H * vp.scale

  const dpr = (renderDpr ?? window.devicePixelRatio) || 1
  const size = Posters.pickSize(vp.scale, dpr)

  const now = performance.now()
  if (wave) updateWave(wave, now, grid, size)

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

      // Wave: determine bump scale + which poster to show
      let scale = 1
      let useOld = false
      let waveOldData: { cell: MovieCell; imgs: Map<Posters.TmdbSize, HTMLImageElement> | undefined } | undefined
      if (wave) {
        const b = cellBump(wave, col, row, now)
        scale = b.scale
        useOld = b.useOld
        if (useOld) waveOldData = wave.old.get(cellKey)
      }

      // Local filter-swap effect (same bump curve as long-tap), unless wave already controls this cell.
      let swapEntry: FilterSwapFxEntry | undefined
      let swapUseOld = false
      if (swapFx && !(useOld || scale !== 1)) {
        swapEntry = swapFx.get(cellKey)
        if (swapEntry) {
          const timeoutMs = swapEntry.timeoutMs ?? FILTER_SWAP_TIMEOUT
          const newReady = !!Posters.getBestAvailable(cellKey, size)
          if (swapEntry.startAt === 0 && (newReady || now - swapEntry.createdAt >= timeoutMs)) {
            swapEntry.startAt = now
          }
          if (swapEntry.startAt === 0) {
            swapUseOld = true
          } else {
            const phase = computeBumpPhase(now - swapEntry.startAt, BUMP_UP_MIN)
            scale = phase.scale
            swapUseOld = phase.useOld
            if (phase.done) {
              swapFx.delete(cellKey)
              swapEntry = undefined
              swapUseOld = false
              scale = 1
            }
          }
        }
      }

      // Always queue new poster for loading (ringReady needs them)
      if (!Posters.get(cellKey, size)) {
        toLoad.push({ col, row, cellKey, posterPath: cell.posterPath })
      }

      // Pick image source: old (stashed) or new (grid)
      let img: HTMLImageElement | undefined
      let placeholderHue: number = (cell.embedding[0] / 255) * 360
      let drawCell: MovieCell = cell
      if (useOld && wave) {
        const oldData = waveOldData ?? wave.old.get(cellKey)
        if (oldData) {
          img = findBestStashed(oldData.imgs, size)
          placeholderHue = (oldData.cell.embedding[0] / 255) * 360
          drawCell = oldData.cell
        } else {
          img = Posters.getBestAvailable(cellKey, size)
        }
      } else if (swapUseOld && swapEntry) {
        img = findBestStashed(swapEntry.oldImgs, size)
        placeholderHue = (swapEntry.oldCell.embedding[0] / 255) * 360
        drawCell = swapEntry.oldCell
      } else {
        img = Posters.getBestAvailable(cellKey, size)
      }

      // Apply scale transform (from cell center)
      const needScale = scale !== 1
      if (needScale) {
        const centerX = sx + cellScreenW / 2
        const centerY = sy + cellScreenH / 2
        ctx.save()
        ctx.translate(centerX, centerY)
        ctx.scale(scale, scale)
        ctx.translate(-centerX, -centerY)
      }

      if (img) {
        ctx.drawImage(img, sx, sy, cellScreenW, cellScreenH)
      } else {
        ctx.fillStyle = `hsl(${placeholderHue}, 40%, 20%)`
        ctx.fillRect(sx, sy, cellScreenW, cellScreenH)
      }

      // Rating overlay
      if (titlesIndex) {
        const idx = titlesIndex.idToIdx.get(drawCell.tmdbId)
        const rating = idx !== undefined ? titlesIndex.ratings[idx] : undefined
        drawRating(ctx, rating, sx, sy, cellScreenW, cellScreenH)
      }

      if (needScale) ctx.restore()
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

/** Find best available image from stashed image map */
function findBestStashed(
  imgs: Map<Posters.TmdbSize, HTMLImageElement> | undefined,
  size: Posters.TmdbSize,
): HTMLImageElement | undefined {
  if (!imgs) return undefined
  const TMDB_SIZES = [92, 154, 185, 342, 500, 780] as const
  // Walk sizes downward from requested
  for (let i = TMDB_SIZES.indexOf(size); i >= 0; i--) {
    const img = imgs.get(TMDB_SIZES[i])
    if (img?.complete && img.naturalWidth > 0) return img
  }
  // Check above
  for (let i = TMDB_SIZES.indexOf(size) + 1; i < TMDB_SIZES.length; i++) {
    const img = imgs.get(TMDB_SIZES[i])
    if (img?.complete && img.naturalWidth > 0) return img
  }
  return undefined
}

export function preloadPosters(vp: Viewport, grid: Grid, renderDpr?: number) {
  const range = getVisibleRange(vp)
  const preloadRange = getVisibleRange(vp, PRELOAD_BUFFER)
  const dpr = (renderDpr ?? window.devicePixelRatio) || 1
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
