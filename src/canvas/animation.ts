import type { Viewport } from './viewport.ts'

const DURATION = 300

export interface Animation {
  id: number
  running: boolean
}

export function createAnimation(): Animation {
  return { id: 0, running: false }
}

/** Animate viewport from current state to target. Calls onFrame each rAF. */
export function animateViewport(
  anim: Animation,
  vp: Viewport,
  targetOffsetX: number,
  targetOffsetY: number,
  targetScale: number,
  onFrame: () => void,
) {
  cancelAnimationFrame(anim.id)
  anim.running = true

  const startX = vp.offsetX
  const startY = vp.offsetY
  const startScale = vp.scale
  const startTime = performance.now()

  function tick(now: number) {
    const elapsed = now - startTime
    const t = Math.min(1, elapsed / DURATION)
    const ease = 1 - (1 - t) * (1 - t)  // ease-out quadratic

    vp.offsetX = startX + (targetOffsetX - startX) * ease
    vp.offsetY = startY + (targetOffsetY - startY) * ease
    vp.scale = startScale + (targetScale - startScale) * ease

    onFrame()

    if (t < 1) {
      anim.id = requestAnimationFrame(tick)
    } else {
      anim.running = false
    }
  }

  anim.id = requestAnimationFrame(tick)
}
