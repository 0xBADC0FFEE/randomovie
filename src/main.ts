import { createViewport, centerOn, getVisibleRange } from './canvas/viewport.ts'
import { createGestureState, setupGestures } from './canvas/gestures.ts'
import { render } from './canvas/renderer.ts'
import { createGrid, fillRange, evictOutside } from './engine/grid.ts'
import { generateMockIndex, parseEmbeddings } from './engine/embeddings.ts'
import type { EmbeddingsIndex } from './engine/embeddings.ts'
import { createPosterCache } from './data/poster-cache.ts'

const EVICT_BUFFER = 5

const canvas = document.getElementById('canvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

function resize() {
  const dpr = window.devicePixelRatio || 1
  canvas.width = window.innerWidth * dpr
  canvas.height = window.innerHeight * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  vp.width = window.innerWidth
  vp.height = window.innerHeight
}

const vp = createViewport(window.innerWidth, window.innerHeight)
const gs = createGestureState()
const grid = createGrid()

let index: EmbeddingsIndex

const posterCache = createPosterCache(() => scheduleRender())

let renderScheduled = false
function scheduleRender() {
  if (renderScheduled) return
  renderScheduled = true
  requestAnimationFrame(() => {
    renderScheduled = false
    update()
  })
}

function update() {
  // Fill visible range + buffer
  const range = getVisibleRange(vp)
  fillRange(grid, range, index)

  // Evict far cells
  const evictRange = getVisibleRange(vp, EVICT_BUFFER)
  evictOutside(grid, evictRange)

  render(ctx, vp, grid, posterCache)
}

async function loadEmbeddings(): Promise<EmbeddingsIndex> {
  try {
    const resp = await fetch('/data/embeddings.bin')
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const buffer = await resp.arrayBuffer()
    return parseEmbeddings(buffer)
  } catch {
    console.warn('No embeddings.bin found, using mock data')
    return generateMockIndex(5000)
  }
}

async function init() {
  resize()
  window.addEventListener('resize', () => { resize(); scheduleRender() })

  index = await loadEmbeddings()

  centerOn(vp, 0, 0)
  setupGestures(canvas, vp, gs, scheduleRender)
  scheduleRender()
}

init()
