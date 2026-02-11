import type { Viewport } from './viewport.ts'

const PAN_DECEL = 0.95
const MIN_SCALE = 0.3
const MAX_SCALE = 3

export interface GestureState {
  panning: boolean
  pinching: boolean
  lastX: number
  lastY: number
  velocityX: number
  velocityY: number
  pinchDist: number
  pinchCenterX: number
  pinchCenterY: number
  animId: number
}

export function createGestureState(): GestureState {
  return {
    panning: false, pinching: false,
    lastX: 0, lastY: 0,
    velocityX: 0, velocityY: 0,
    pinchDist: 0, pinchCenterX: 0, pinchCenterY: 0,
    animId: 0,
  }
}

function dist(t: TouchList): number {
  const dx = t[0].clientX - t[1].clientX
  const dy = t[0].clientY - t[1].clientY
  return Math.sqrt(dx * dx + dy * dy)
}

function center(t: TouchList): [number, number] {
  return [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2]
}

export function setupGestures(
  el: HTMLCanvasElement,
  vp: Viewport,
  gs: GestureState,
  onUpdate: () => void,
) {
  el.addEventListener('touchstart', (e) => {
    e.preventDefault()
    cancelAnimationFrame(gs.animId)
    gs.velocityX = gs.velocityY = 0

    if (e.touches.length === 1) {
      gs.panning = true
      gs.lastX = e.touches[0].clientX
      gs.lastY = e.touches[0].clientY
    } else if (e.touches.length === 2) {
      gs.panning = false
      gs.pinching = true
      gs.pinchDist = dist(e.touches)
      ;[gs.pinchCenterX, gs.pinchCenterY] = center(e.touches)
    }
  }, { passive: false })

  el.addEventListener('touchmove', (e) => {
    e.preventDefault()

    if (gs.pinching && e.touches.length === 2) {
      const newDist = dist(e.touches)
      const [cx, cy] = center(e.touches)
      const ratio = newDist / gs.pinchDist

      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, vp.scale * ratio))
      const scaleChange = newScale / vp.scale

      vp.offsetX = cx - (cx - vp.offsetX) * scaleChange + (cx - gs.pinchCenterX)
      vp.offsetY = cy - (cy - vp.offsetY) * scaleChange + (cy - gs.pinchCenterY)
      vp.scale = newScale

      gs.pinchDist = newDist
      ;[gs.pinchCenterX, gs.pinchCenterY] = [cx, cy]
      onUpdate()
    } else if (gs.panning && e.touches.length === 1) {
      const x = e.touches[0].clientX
      const y = e.touches[0].clientY
      const dx = x - gs.lastX
      const dy = y - gs.lastY

      vp.offsetX += dx
      vp.offsetY += dy
      gs.velocityX = dx
      gs.velocityY = dy
      gs.lastX = x
      gs.lastY = y
      onUpdate()
    }
  }, { passive: false })

  el.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      gs.panning = false
      gs.pinching = false
      startInertia(vp, gs, onUpdate)
    } else if (e.touches.length === 1) {
      gs.pinching = false
      gs.panning = true
      gs.lastX = e.touches[0].clientX
      gs.lastY = e.touches[0].clientY
    }
  })

  // Mouse support for desktop
  let mouseDown = false
  el.addEventListener('mousedown', (e) => {
    mouseDown = true
    cancelAnimationFrame(gs.animId)
    gs.velocityX = gs.velocityY = 0
    gs.lastX = e.clientX
    gs.lastY = e.clientY
  })

  el.addEventListener('mousemove', (e) => {
    if (!mouseDown) return
    const dx = e.clientX - gs.lastX
    const dy = e.clientY - gs.lastY
    vp.offsetX += dx
    vp.offsetY += dy
    gs.velocityX = dx
    gs.velocityY = dy
    gs.lastX = e.clientX
    gs.lastY = e.clientY
    onUpdate()
  })

  el.addEventListener('mouseup', () => {
    mouseDown = false
    startInertia(vp, gs, onUpdate)
  })

  el.addEventListener('mouseleave', () => {
    if (mouseDown) {
      mouseDown = false
      startInertia(vp, gs, onUpdate)
    }
  })

  el.addEventListener('wheel', (e) => {
    e.preventDefault()
    const zoomFactor = e.deltaY > 0 ? 0.95 : 1.05
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, vp.scale * zoomFactor))
    const scaleChange = newScale / vp.scale

    vp.offsetX = e.clientX - (e.clientX - vp.offsetX) * scaleChange
    vp.offsetY = e.clientY - (e.clientY - vp.offsetY) * scaleChange
    vp.scale = newScale
    onUpdate()
  }, { passive: false })
}

function startInertia(vp: Viewport, gs: GestureState, onUpdate: () => void) {
  function tick() {
    gs.velocityX *= PAN_DECEL
    gs.velocityY *= PAN_DECEL
    if (Math.abs(gs.velocityX) < 0.5 && Math.abs(gs.velocityY) < 0.5) return
    vp.offsetX += gs.velocityX
    vp.offsetY += gs.velocityY
    onUpdate()
    gs.animId = requestAnimationFrame(tick)
  }
  gs.animId = requestAnimationFrame(tick)
}
