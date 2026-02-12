import type { Grid } from '../engine/grid.ts'
import * as Posters from './poster-loader.ts'
import type { TmdbSize } from './poster-loader.ts'

const RING_STAGGER = 80   // ms between ring reveals
const RING_FADE = 200      // ms for opacity 0→1
const WAVE_TIMEOUT = 500   // ms max wait for image preloads

export interface WaveState {
  col: number
  row: number
  startTime: number
  maxRing: number
  ringRevealTime: Float64Array  // 0 = not yet revealed
}

export function startWave(col: number, row: number, maxRing: number): WaveState {
  const rt = new Float64Array(maxRing + 1)
  rt[0] = performance.now()
  return { col, row, startTime: rt[0], maxRing, ringRevealTime: rt }
}

function chebyshev(c: number, r: number, cx: number, cy: number): number {
  return Math.max(Math.abs(c - cx), Math.abs(r - cy))
}

/** Check if all cells in a ring have loaded poster images */
function ringReady(wave: WaveState, ring: number, grid: Grid, size: TmdbSize): boolean {
  const { col: cx, row: cy } = wave
  // Top and bottom rows
  for (let c = cx - ring; c <= cx + ring; c++) {
    for (const r of [cy - ring, cy + ring]) {
      const key = `${c}:${r}`
      if (grid.cells.has(key) && !Posters.getBestAvailable(key, size)) return false
    }
  }
  // Left and right columns (excluding corners)
  for (let r = cy - ring + 1; r < cy + ring; r++) {
    for (const c of [cx - ring, cx + ring]) {
      const key = `${c}:${r}`
      if (grid.cells.has(key) && !Posters.getBestAvailable(key, size)) return false
    }
  }
  return true
}

/** Advance ring reveal states. Call once per frame before cellOpacity. */
export function updateWave(wave: WaveState, now: number, grid: Grid, size: TmdbSize): void {
  const timeoutHit = now >= wave.startTime + WAVE_TIMEOUT
  for (let ring = 1; ring <= wave.maxRing; ring++) {
    if (wave.ringRevealTime[ring] > 0) continue
    if (wave.ringRevealTime[ring - 1] === 0) break  // prev not revealed
    if (now < wave.startTime + ring * RING_STAGGER) break
    if (timeoutHit || ringReady(wave, ring, grid, size)) {
      wave.ringRevealTime[ring] = now
    } else {
      break
    }
  }
}

/** Get opacity (0..1) for a cell during wave animation */
export function cellOpacity(wave: WaveState, col: number, row: number, now: number): number {
  const ring = chebyshev(col, row, wave.col, wave.row)
  if (ring === 0 || ring > wave.maxRing) return 1
  const t = wave.ringRevealTime[ring]
  if (t === 0) return 0
  const elapsed = now - t
  return elapsed >= RING_FADE ? 1 : elapsed / RING_FADE
}

export function isWaveDone(wave: WaveState, now: number): boolean {
  const t = wave.ringRevealTime[wave.maxRing]
  return t > 0 && now >= t + RING_FADE
}
