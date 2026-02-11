import type { Viewport } from '../canvas/viewport.ts'
import { getVisibleRange, screenToWorld, CELL_W, CELL_H } from '../canvas/viewport.ts'
import type { GestureState } from '../canvas/gestures.ts'
import type { Grid } from '../engine/grid.ts'

const CELL_PX = 6
const BUFFER = 12

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
    position: 'fixed', top: '0', left: '0', zIndex: '9999',
    background: 'rgba(0,0,0,0.7)',
    padding: '6px', pointerEvents: 'none',
    borderBottomRightRadius: '6px',
  })
  document.body.appendChild(el)

  const canvas = document.createElement('canvas')
  canvas.style.display = 'block'
  const ctx = canvas.getContext('2d')!
  el.appendChild(canvas)

  return {
    visible: true,
    toggle() {
      this.visible = !this.visible
      el.style.display = this.visible ? '' : 'none'
    },
    update(vp, _gs, grid) {
      if (!this.visible) return

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
}
