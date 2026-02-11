import { createViewport, centerOn, getVisibleRange, CELL_W, CELL_H, screenToWorld } from './canvas/viewport.ts'
import { createGestureState, setupGestures } from './canvas/gestures.ts'
import { render } from './canvas/renderer.ts'
import { createGrid, fillRange, evictOutside, clearGrid, setCell } from './engine/grid.ts'
import { generateMockIndex, parseEmbeddings } from './engine/embeddings.ts'
import type { EmbeddingsIndex } from './engine/embeddings.ts'
import { createPosterCache } from './data/poster-cache.ts'
import { createAnimation, animateViewport } from './canvas/animation.ts'

const EVICT_BUFFER = 5
const SEARCH_DEBOUNCE = 150
const FILL_DELAY = 300

const canvas = document.getElementById('canvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const searchInput = document.getElementById('search') as HTMLInputElement

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
const anim = createAnimation()

const searchWorker = new Worker(new URL('./engine/search.worker.ts', import.meta.url), { type: 'module' })
let searchSeq = 0
let searchReady = false

let index: EmbeddingsIndex
let searchMode = false
let searchDebounceId = 0
let fillDebounceId = 0
let fillPending = false

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
  const range = getVisibleRange(vp)
  if (!fillPending) fillRange(grid, range, index)

  const evictRange = getVisibleRange(vp, EVICT_BUFFER)
  evictOutside(grid, evictRange)

  render(ctx, vp, grid, posterCache)
}

/** Find cell col,row closest to screen center */
function findCenterCell(): [number, number] {
  const [wx, wy] = screenToWorld(vp, vp.width / 2, vp.height / 2)
  return [Math.round(wx / CELL_W - 0.5), Math.round(wy / CELL_H - 0.5)]
}

/** Enter search mode: animate viewport to center+fit one card above input */
function enterSearchMode() {
  if (searchMode) return
  searchMode = true
  gs.disabled = true

  const [col, row] = findCenterCell()

  // Target scale: card fits in area above search input
  // Search input ~60px from bottom; leave some padding
  const inputH = 60
  const pad = 24
  const availH = vp.height - inputH - pad * 2
  const availW = vp.width - pad * 2
  const scaleH = availH / CELL_H
  const scaleW = availW / CELL_W
  const targetScale = Math.min(scaleH, scaleW)

  // Center cell in available area (shifted up by half inputH)
  const centerY = (vp.height - inputH) / 2
  const targetOffsetX = vp.width / 2 - (col + 0.5) * CELL_W * targetScale
  const targetOffsetY = centerY - (row + 0.5) * CELL_H * targetScale

  animateViewport(anim, vp, targetOffsetX, targetOffsetY, targetScale, scheduleRender)
}

/** Exit search mode */
function exitSearchMode() {
  if (!searchMode) return
  searchMode = false
  gs.disabled = false
  searchInput.blur()
  searchInput.value = ''
}

/** Handle search input: post query to worker */
function handleSearch(query: string) {
  if (!searchReady || !query.trim()) return
  searchWorker.postMessage({ type: 'search', seq: ++searchSeq, query: query.trim() })
}

/** Handle worker responses */
function handleWorkerMessage(e: MessageEvent) {
  const { type } = e.data
  if (type === 'ready') {
    searchReady = true
    return
  }
  if (type === 'result') {
    if (e.data.seq !== searchSeq) return // stale
    const tmdbId = e.data.tmdbId as number | null
    if (tmdbId == null) return

    const entry = index.movies.find(m => m.tmdbId === tmdbId)
    if (!entry) return

    const [col, row] = findCenterCell()
    clearGrid(grid)
    setCell(grid, col, row, {
      tmdbId: entry.tmdbId,
      posterPath: entry.posterPath,
      embedding: entry.embedding,
    })
    scheduleRender()

    clearTimeout(fillDebounceId)
    fillPending = true
    fillDebounceId = window.setTimeout(() => {
      const range = getVisibleRange(vp)
      fillRange(grid, range, index, true)
      fillPending = false
      scheduleRender()
    }, FILL_DELAY)
  }
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

async function loadTitles(): Promise<boolean> {
  try {
    const resp = await fetch('/data/titles.bin')
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const buffer = await resp.arrayBuffer()
    return new Promise<boolean>((resolve) => {
      searchWorker.onmessage = (e) => {
        if (e.data.type === 'ready') {
          searchReady = true
          searchWorker.onmessage = handleWorkerMessage
          resolve(true)
        }
      }
      searchWorker.postMessage({ type: 'init', buffer }, [buffer])
    })
  } catch {
    console.warn('No titles.bin found, search disabled')
    return false
  }
}

function setupSearch() {
  searchInput.addEventListener('focus', () => {
    enterSearchMode()
  })

  searchInput.addEventListener('blur', () => {
    // Small delay to allow Enter to fire first
    setTimeout(() => exitSearchMode(), 100)
  })

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      exitSearchMode()
    }
  })

  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceId)
    searchDebounceId = window.setTimeout(() => {
      handleSearch(searchInput.value)
    }, SEARCH_DEBOUNCE)
  })
}

async function init() {
  resize()
  window.addEventListener('resize', () => { resize(); scheduleRender() })

  index = await loadEmbeddings()
  const titlesLoaded = await loadTitles()

  if (!titlesLoaded) {
    searchInput.style.display = 'none'
  }

  centerOn(vp, 0, 0)
  setupGestures(canvas, vp, gs, scheduleRender)
  setupSearch()
  scheduleRender()
}

init()
