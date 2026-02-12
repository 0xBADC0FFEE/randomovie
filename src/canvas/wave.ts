import type { Grid } from '../engine/grid.ts'
import type { MovieCell } from '../engine/grid.ts'
import * as Posters from './poster-loader.ts'
import type { TmdbSize } from './poster-loader.ts'

function easeOutCubic(x: number): number { return 1 - (1 - x) ** 3 }
function easeOutBack(x: number): number {
  const c1 = 1.70158, c3 = c1 + 1
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2
}

const RING_STAGGER = 80   // ms between ring bumps
const BUMP_UP_MIN = 100    // ms ring 1 rise — snappy
const BUMP_UP_MAX = 160    // ms outermost ring rise — gentle
const BUMP_DOWN = 200      // ms scale peak→1
const BUMP_PEAK = 1.40     // max scale (attenuated per ring)
const WAVE_TIMEOUT = 500   // ms max wait for image preloads

export interface OldCellData {
  cell: MovieCell
  imgs: Map<TmdbSize, HTMLImageElement> | undefined
}

export interface WaveState {
  col: number
  row: number
  startTime: number
  maxRing: number
  ringStartTime: Float64Array  // 0 = not yet started
  old: Map<string, OldCellData>
}

export function startWave(
  col: number, row: number, maxRing: number,
  old: Map<string, OldCellData>,
): WaveState {
  const rt = new Float64Array(maxRing + 1)
  rt[0] = performance.now()
  return { col, row, startTime: rt[0], maxRing, ringStartTime: rt, old }
}

function chebyshev(c: number, r: number, cx: number, cy: number): number {
  return Math.max(Math.abs(c - cx), Math.abs(r - cy))
}

/** Check if all cells in a ring have loaded poster images */
function ringReady(wave: WaveState, ring: number, grid: Grid, size: TmdbSize): boolean {
  const { col: cx, row: cy } = wave
  for (let c = cx - ring; c <= cx + ring; c++) {
    for (const r of [cy - ring, cy + ring]) {
      const key = `${c}:${r}`
      if (grid.cells.has(key) && !Posters.getBestAvailable(key, size)) return false
    }
  }
  for (let r = cy - ring + 1; r < cy + ring; r++) {
    for (const c of [cx - ring, cx + ring]) {
      const key = `${c}:${r}`
      if (grid.cells.has(key) && !Posters.getBestAvailable(key, size)) return false
    }
  }
  return true
}

/** Advance ring states. Call once per frame before cellBump. */
export function updateWave(wave: WaveState, now: number, grid: Grid, size: TmdbSize): void {
  const timeoutHit = now >= wave.startTime + WAVE_TIMEOUT
  for (let ring = 1; ring <= wave.maxRing; ring++) {
    if (wave.ringStartTime[ring] > 0) continue
    if (wave.ringStartTime[ring - 1] === 0) break
    if (now < wave.startTime + ring * RING_STAGGER) break
    if (timeoutHit || ringReady(wave, ring, grid, size)) {
      wave.ringStartTime[ring] = now
    } else {
      break
    }
  }
}

/** Get scale and whether to show old poster for a cell during wave */
export function cellBump(
  wave: WaveState, col: number, row: number, now: number,
): { scale: number; useOld: boolean } {
  const ring = chebyshev(col, row, wave.col, wave.row)
  if (ring === 0 || ring > wave.maxRing) return { scale: 1, useOld: false }
  const t = wave.ringStartTime[ring]
  if (t === 0) return { scale: 1, useOld: true }  // not started yet, show old
  const amplitude = (BUMP_PEAK - 1) / ring  // inverse-distance attenuation
  const riseMs = BUMP_UP_MIN + (BUMP_UP_MAX - BUMP_UP_MIN) * ((ring - 1) / (wave.maxRing - 1))
  const elapsed = now - t
  if (elapsed < riseMs) {
    const p = easeOutCubic(elapsed / riseMs)
    return { scale: 1 + amplitude * p, useOld: true }
  }
  const downElapsed = elapsed - riseMs
  if (downElapsed < BUMP_DOWN) {
    const p = easeOutBack(downElapsed / BUMP_DOWN)
    return { scale: (1 + amplitude) - amplitude * p, useOld: false }
  }
  // Done
  return { scale: 1, useOld: false }
}

export function isWaveDone(wave: WaveState, now: number): boolean {
  const t = wave.ringStartTime[wave.maxRing]
  return t > 0 && now >= t + BUMP_UP_MAX + BUMP_DOWN
}
