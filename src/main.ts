import { createViewport, centerOn, getVisibleRange, PRELOAD_BUFFER, CELL_W, CELL_H, screenToWorld } from './canvas/viewport.ts'
import { createGestureState, setupGestures } from './canvas/gestures.ts'
import { render, preloadPosters } from './canvas/renderer.ts'
import { createGrid, fillRange, evictOutside, clearGrid, setCell } from './engine/grid.ts'
import { generateMockIndex, parseEmbeddings } from './engine/embeddings.ts'
import type { EmbeddingsIndex, MovieEntry } from './engine/embeddings.ts'
import { setOnLoad, evictImages, clearAllImages } from './canvas/poster-loader.ts'
import { createAnimation, animateViewport } from './canvas/animation.ts'
import { createDebugOverlay, type DebugOverlay } from './debug/overlay.ts'
import type { TitlesIndex } from './engine/titles.ts'

function getSafeAreaTop(): number {
  const el = document.createElement('div')
  el.style.height = 'env(safe-area-inset-top, 0px)'
  document.body.appendChild(el)
  const h = el.getBoundingClientRect().height
  document.body.removeChild(el)
  return h
}

let safeTop = 0

const EVICT_BUFFER = 12
const GESTURE_BUFFER = 5
const GESTURE_FILL = 10
const FILL_PER_FRAME = 6
const IDLE_FILL_MAX = 20
const SEARCH_DEBOUNCE = 150
const FILL_DELAY = 300

const rIC: typeof requestIdleCallback = window.requestIdleCallback
  ?? ((cb) => setTimeout(() => cb({
    timeRemaining: () => 1, didTimeout: false,
  } as IdleDeadline), 1) as any)
const cIC: typeof cancelIdleCallback = window.cancelIdleCallback ?? clearTimeout

const canvas = document.getElementById('canvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const searchInput = document.getElementById('search') as HTMLInputElement

function resize() {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  const w = rect.width
  const h = rect.height
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  vp.width = w
  vp.height = h
}

function onVisualViewportChange() {
  if (!searchMode) return
  const vvp = window.visualViewport!

  // Cancel any running enterSearchMode animation so tick() can't overwrite
  cancelAnimationFrame(anim.id)
  anim.running = false

  centerCardForSearch(searchCell[0], searchCell[1], vvp.offsetTop, vvp.height, false)
}

const vp = createViewport(window.innerWidth, window.innerHeight)
const gs = createGestureState()
const grid = createGrid()
const anim = createAnimation()

const searchWorker = new Worker(new URL('./engine/search.worker.ts', import.meta.url), { type: 'module' })
let searchSeq = 0
let searchReady = false

let index: EmbeddingsIndex
let titlesIndex: TitlesIndex | null = null
let searchMode = false
let searchCell: [number, number] = [0, 0]
let searchDebounceId = 0
let fillCoherent = false
let fillDebounceId = 0
let fillPending = false
let idleId = 0
let debugOverlay: DebugOverlay | null =
  new URLSearchParams(location.search).has('debug') ? createDebugOverlay() : null

function cancelIdleFill() {
  if (idleId) { cIC(idleId); idleId = 0 }
}

function scheduleIdleFill() {
  if (idleId || fillPending) return
  idleId = rIC((deadline) => {
    idleId = 0
    if (gs.active) return
    const range = getVisibleRange(vp, PRELOAD_BUFFER)
    let n = 0
    while (deadline.timeRemaining() > 1 && n < IDLE_FILL_MAX) {
      if (fillRange(grid, range, index, false, 1) === 0) return
      n++
    }
    if (n > 0) {
      scheduleRepaint()
      preloadPosters(vp, grid)
    }
    scheduleIdleFill()
  })
}

let repaintScheduled = false
function scheduleRepaint() {
  if (repaintScheduled || renderScheduled) return
  repaintScheduled = true
  requestAnimationFrame(() => {
    repaintScheduled = false
    render(ctx, vp, grid)
  })
}

setOnLoad(() => scheduleRepaint())

let renderScheduled = false
function scheduleRender(immediate?: boolean) {
  if (immediate) {
    renderScheduled = false
    update()
    return
  }
  if (renderScheduled) return
  renderScheduled = true
  requestAnimationFrame(() => {
    renderScheduled = false
    update()
  })
}

function update() {
  if (gs.active) cancelIdleFill()

  let n = 0
  if (!fillPending) {
    if (gs.active) {
      const speed = Math.sqrt(gs.velocityX ** 2 + gs.velocityY ** 2)
      const t = Math.min(speed / 25, 1)
      const noiseFactor = 0.08 + t * 0.42    // 0.08 → 0.5
      const randomChance = 0.05 + t * 0.35   // 0.05 → 0.4

      // Pass 1: fill entire render range (no budget — cells show as empty otherwise)
      n = fillRange(grid, getVisibleRange(vp), index, false, undefined, noiseFactor, randomChance)
      // Pass 2: budget-limited buffer cells for preloading
      // visible cells already exist from pass 1 → skipped → budget only for buffer
      n += fillRange(grid, getVisibleRange(vp, GESTURE_BUFFER), index, false, GESTURE_FILL, noiseFactor, randomChance)
    } else {
      n = fillRange(grid, getVisibleRange(vp, PRELOAD_BUFFER), index, fillCoherent, FILL_PER_FRAME)
    }
  }

  render(ctx, vp, grid)

  if (n > 0) scheduleRender()
  evictOutside(grid, getVisibleRange(vp, EVICT_BUFFER), evictImages)
  preloadPosters(vp, grid)
  scheduleIdleFill()
  debugOverlay?.update(vp, gs, grid)
}

/** Find cell col,row closest to screen center */
function findCenterCell(): [number, number] {
  const [wx, wy] = screenToWorld(vp, vp.width / 2, vp.height / 2)
  return [Math.round(wx / CELL_W - 0.5), Math.round(wy / CELL_H - 0.5)]
}

function focusOn(col: number, row: number, seed?: MovieEntry, delay = 0) {
  clearGrid(grid, clearAllImages)
  if (seed) {
    setCell(grid, col, row, {
      tmdbId: seed.tmdbId,
      posterPath: seed.posterPath,
      embedding: seed.embedding,
    })
    fillCoherent = true
  } else {
    fillCoherent = false
  }
  centerOn(vp, col, row)

  if (delay > 0) {
    fillPending = true
    clearTimeout(fillDebounceId)
    fillDebounceId = window.setTimeout(() => {
      fillPending = false
      scheduleRender()
    }, delay)
  }

  scheduleRender()
}

/** Center+fit one card in visible area above search input */
function centerCardForSearch(col: number, row: number, viewTop: number, viewH: number, animate = true) {
  const inputH = 60
  const pad = 24
  const availH = viewH - safeTop - inputH - pad * 2
  const availW = vp.width - pad * 2
  const scaleH = availH / CELL_H
  const scaleW = availW / CELL_W
  const targetScale = Math.min(scaleH, scaleW)

  const centerY = viewTop + (viewH - inputH + safeTop) / 2
  const targetOffsetX = vp.width / 2 - (col + 0.5) * CELL_W * targetScale
  const targetOffsetY = centerY - (row + 0.5) * CELL_H * targetScale

  if (animate) {
    animateViewport(anim, vp, targetOffsetX, targetOffsetY, targetScale, scheduleRender)
  } else {
    vp.offsetX = targetOffsetX
    vp.offsetY = targetOffsetY
    vp.scale = targetScale
    scheduleRender()
  }
}

/** Enter search mode: animate viewport to center+fit one card above input */
function enterSearchMode() {
  if (searchMode) return
  searchMode = true
  gs.disabled = true

  searchCell = findCenterCell()
  centerCardForSearch(searchCell[0], searchCell[1], 0, vp.height)
}

/** Exit search mode */
function exitSearchMode() {
  if (!searchMode) return
  searchMode = false
  gs.disabled = false
  fillCoherent = false
  searchInput.blur()
  searchInput.value = ''
  scheduleRender()
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
    focusOn(col, row, entry, FILL_DELAY)
  }
}

async function loadEmbeddings(): Promise<EmbeddingsIndex> {
  try {
    const resp = await fetch(`${import.meta.env.BASE_URL}data/embeddings.bin`)
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
    const resp = await fetch(`${import.meta.env.BASE_URL}data/metadata.bin`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const buffer = await resp.arrayBuffer()

    // Parse in main thread (keeps imdbNums/ratings accessible)
    const { parseTitles } = await import('./engine/titles.ts')
    titlesIndex = parseTitles(buffer)

    // Transfer a copy to the worker (original backing data stays with main thread)
    const workerBuffer = buffer.slice(0)
    return new Promise<boolean>((resolve) => {
      searchWorker.onmessage = (e) => {
        if (e.data.type === 'ready') {
          searchReady = true
          searchWorker.onmessage = handleWorkerMessage
          resolve(true)
        }
      }
      searchWorker.postMessage({ type: 'init', buffer: workerBuffer }, [workerBuffer])
    })
  } catch {
    console.warn('No metadata.bin found, search disabled')
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

function openMovieLink(sx: number, sy: number) {
  if (searchMode || !titlesIndex) return
  const [wx, wy] = screenToWorld(vp, sx, sy)
  const col = Math.floor(wx / CELL_W)
  const row = Math.floor(wy / CELL_H)
  const cell = grid.cells.get(`${col}:${row}`)
  if (!cell) return
  const idx = titlesIndex.idToIdx.get(cell.tmdbId)
  if (idx === undefined) return
  const imdbNum = titlesIndex.imdbNums[idx]
  if (!imdbNum) return
  window.open(`https://www.imdb.com/title/tt${String(imdbNum).padStart(7, '0')}/`, '_blank')
}

async function init() {
  safeTop = getSafeAreaTop()
  resize()
  window.addEventListener('resize', () => { resize(); scheduleRender() })
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onVisualViewportChange)
    window.visualViewport.addEventListener('scroll', onVisualViewportChange)
  }

  index = await loadEmbeddings()
  const titlesLoaded = await loadTitles()

  if (!titlesLoaded) {
    searchInput.style.display = 'none'
  }

  focusOn(0, 0)
  setupGestures(canvas, vp, gs, scheduleRender, openMovieLink)

  // 2-finger double-tap toggles debug overlay
  let lastDblTouchTime = 0
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return
    const now = performance.now()
    if (now - lastDblTouchTime < 400) {
      if (!debugOverlay) debugOverlay = createDebugOverlay()
      debugOverlay.toggle()
      scheduleRender()
      lastDblTouchTime = 0
    } else {
      lastDblTouchTime = now
    }
  })

  setupSearch()
  scheduleRender()
}

init()
