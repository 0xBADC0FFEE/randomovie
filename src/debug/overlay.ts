import type { Viewport } from '../canvas/viewport.ts'
import { getVisibleRange, screenToWorld, CELL_W, CELL_H } from '../canvas/viewport.ts'
import type { GestureState } from '../canvas/gestures.ts'
import type { Grid } from '../engine/grid.ts'

const CELL_PX = 6
const BUFFER = 12
const FPS_WINDOW_MS = 5000
const STATS_UPDATE_MS = 250
const IDLE_GAP_MS = 300

interface FpsSample {
  ts: number
  fps: number
}

function embeddingToCSS(e: Uint8Array): string {
  return `hsl(${(e[0] / 255 * 360) | 0}, ${40 + (e[5] / 255 * 50) | 0}%, ${30 + (e[10] / 255 * 35) | 0}%)`
}

export interface DebugOverlay {
  visible: boolean
  toggle(): void
  update(vp: Viewport, gs: GestureState, grid: Grid): void
}

export function createDebugOverlay(): DebugOverlay {
  const el = document.createElement('div')
  Object.assign(el.style, {
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
    left: '8px',
    zIndex: '9999',
    background: 'rgba(0,0,0,0.7)',
    padding: '3px',
    pointerEvents: 'none',
    borderBottomRightRadius: '5px',
  })
  document.body.appendChild(el)

  const canvas = document.createElement('canvas')
  canvas.style.display = 'block'
  const ctx = canvas.getContext('2d')!
  el.appendChild(canvas)

  const statsEl = document.createElement('div')
  Object.assign(statsEl.style, {
    marginTop: '2px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
    fontSize: '12px',
    lineHeight: '1.2',
    color: 'rgba(220, 240, 255, 0.95)',
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
  })
  statsEl.textContent = 'FPS -- | p50 -- | p95 --'
  el.appendChild(statsEl)

  let lastFrameTs = 0
  let lastStatsPaintTs = 0
  const samples: FpsSample[] = []

  function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v))
  }

  function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return NaN
    const n = sorted.length
    const rank = clamp((n - 1) * p, 0, n - 1)
    const lo = Math.floor(rank)
    const hi = Math.ceil(rank)
    if (lo === hi) return sorted[lo]
    const t = rank - lo
    return sorted[lo] + (sorted[hi] - sorted[lo]) * t
  }

  function pruneSamples(now: number) {
    const cutoff = now - FPS_WINDOW_MS
    while (samples.length > 0 && samples[0].ts < cutoff) {
      samples.shift()
    }
  }

  function paintStats(now: number) {
    if (now - lastStatsPaintTs < STATS_UPDATE_MS) return
    lastStatsPaintTs = now
    pruneSamples(now)

    const stale = lastFrameTs > 0 && now - lastFrameTs > IDLE_GAP_MS
    if (samples.length < 2) {
      statsEl.textContent = stale ? 'FPS 0 | p50 -- | p95 --' : 'FPS -- | p50 -- | p95 --'
      return
    }

    const sorted = samples.map((s) => s.fps).sort((a, b) => a - b)
    const p50 = percentile(sorted, 0.5)
    const p95 = percentile(sorted, 0.95)
    if (stale) {
      statsEl.textContent = `FPS 0 | p50 ${Math.round(p50)} | p95 ${Math.round(p95)}`
      return
    }
    const current = samples[samples.length - 1].fps
    statsEl.textContent = `FPS ${Math.round(current)} | p50 ${Math.round(p50)} | p95 ${Math.round(p95)}`
  }
  const api: DebugOverlay = {
    visible: true,
    toggle() {
      this.visible = !this.visible
      el.style.display = this.visible ? '' : 'none'
    },
    update(vp, _gs, grid) {
      if (!this.visible) return
      const now = performance.now()

      if (lastFrameTs > 0) {
        const dt = now - lastFrameTs
        // Ignore idle gaps, otherwise the first frame after pause looks like a fake FPS drop.
        if (dt > 0 && dt <= IDLE_GAP_MS) {
          const fps = clamp(1000 / dt, 1, 240)
          samples.push({ ts: now, fps })
        }
      }
      lastFrameTs = now

      paintStats(now)

      // Center cell from viewport center
      const [wcx, wcy] = screenToWorld(vp, vp.width / 2, vp.height / 2)
      const cc = Math.round(wcx / CELL_W)
      const cr = Math.round(wcy / CELL_H)

      // Half-span: constant for given viewport size + scale (stable during pan)
      const hc = Math.ceil(vp.width / (CELL_W * vp.scale * 2)) + 1 + BUFFER
      const hr = Math.ceil(vp.height / (CELL_H * vp.scale * 2)) + 1 + BUFFER

      const totalCols = 2 * hc + 1
      const totalRows = 2 * hr + 1
      const w = totalCols * CELL_PX
      const h = totalRows * CELL_PX

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }

      ctx.clearRect(0, 0, w, h)

      const minCol = cc - hc
      const minRow = cr - hr

      // Draw cells
      for (let r = cr - hr; r <= cr + hr; r++) {
        for (let c = cc - hc; c <= cc + hc; c++) {
          const cell = grid.cells.get(`${c}:${r}`)
          if (!cell) continue
          ctx.fillStyle = embeddingToCSS(cell.embedding)
          ctx.fillRect(
            (c - minCol) * CELL_PX,
            (r - minRow) * CELL_PX,
            CELL_PX, CELL_PX,
          )
        }
      }

      // Viewport indicator
      const vis = getVisibleRange(vp, 0)
      const vx = (vis.minCol - minCol) * CELL_PX
      const vy = (vis.minRow - minRow) * CELL_PX
      const vw = (vis.maxCol - vis.minCol + 1) * CELL_PX
      const vh = (vis.maxRow - vis.minRow + 1) * CELL_PX
      ctx.strokeStyle = 'cyan'
      ctx.lineWidth = 1
      ctx.strokeRect(vx + 0.5, vy + 0.5, vw, vh)
    },
  }

  window.setInterval(() => {
    if (!api.visible) return
    paintStats(performance.now())
  }, STATS_UPDATE_MS)

  return api
}
