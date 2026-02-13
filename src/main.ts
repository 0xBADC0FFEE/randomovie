import { createViewport, centerOn, getVisibleRange, PRELOAD_BUFFER, CELL_W, CELL_H, screenToWorld } from './canvas/viewport.ts'
import { createGestureState, setupGestures } from './canvas/gestures.ts'
import { render, preloadPosters } from './canvas/renderer.ts'
import type { FilterSwapFxEntry } from './canvas/renderer.ts'
import { createGrid, fillRange, evictOutside, clearGrid, setCell } from './engine/grid.ts'
import { generateMockIndex, parseEmbeddings } from './engine/embeddings.ts'
import type { EmbeddingsIndex, MovieEntry } from './engine/embeddings.ts'
import { setOnLoad, evictImages, clearAllImages, stash, restore, pickSize, load as loadPoster } from './canvas/poster-loader.ts'
import { startWave, isWaveDone } from './canvas/wave.ts'
import type { WaveState, OldCellData } from './canvas/wave.ts'
import { createAnimation, animateViewport } from './canvas/animation.ts'
import { createDebugOverlay, type DebugOverlay } from './debug/overlay.ts'
import type { TitlesIndex } from './engine/titles.ts'
import { generateMovie } from './engine/generator.ts'
import { buildRatingMorphPath, clampRatingX10 } from './ui/rating-morph.ts'

function getSafeAreaTop(): number {
  const el = document.createElement('div')
  el.style.height = 'env(safe-area-inset-top, 0px)'
  document.body.appendChild(el)
  const h = el.getBoundingClientRect().height
  document.body.removeChild(el)
  return h
}

function key(col: number, row: number): string {
  return `${col}:${row}`
}

function parseKey(cellKey: string): [number, number] {
  const [cs, rs] = cellKey.split(':')
  return [parseInt(cs), parseInt(rs)]
}

function formatRating(ratingX10: number): string {
  return (ratingX10 / 10).toFixed(1)
}

let safeTop = 0

const EVICT_BUFFER = 8
const GESTURE_BUFFER = 4
const GESTURE_FILL = 8
const FILL_PER_FRAME = 6
const IDLE_FILL_MAX = 16
const SEARCH_DEBOUNCE = 150
const FILL_DELAY = 300

const RATING_MIN_X10 = 50
const RATING_MAX_X10 = 80
const RATING_STEP_X10 = 5
const ICON_RATINGS_X10 = [50, 60, 65, 75, 80]
const RATING_DRAG_THRESHOLD_PX = 8
const FILTER_REPLACE_BATCH = 14
const FILTER_SWAP_TIMEOUT = 500
const HINT_DURATION_MS = 1200

const rIC: typeof requestIdleCallback = window.requestIdleCallback
  ?? ((cb) => setTimeout(() => cb({
    timeRemaining: () => 1, didTimeout: false,
  } as IdleDeadline), 1) as any)
const cIC: typeof cancelIdleCallback = window.cancelIdleCallback ?? clearTimeout

const canvas = document.getElementById('canvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const searchPanel = document.getElementById('search-panel') as HTMLDivElement
const searchInput = document.getElementById('search') as HTMLInputElement
const ratingStrip = document.getElementById('rating-strip') as HTMLDivElement
const ratingStars = Array.from(
  ratingStrip.querySelectorAll<HTMLButtonElement>('.rating-star'),
)
const searchHint = document.getElementById('search-hint') as HTMLDivElement

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
let suppressNextTap = false
let lpTimer = 0
let lpInterval = 0
let activeWave: WaveState | null = null
let debugOverlay: DebugOverlay | null =
  new URLSearchParams(location.search).has('debug') ? createDebugOverlay() : null

let minRatingX10 = RATING_MIN_X10
let ratingFilterSeq = 0
let ratingReplaceRaf = 0
let ratingReplaceQueue: string[] = []
let hintTimer = 0
let isDraggingFilter = false
const filterSwapFx = new Map<string, FilterSwapFxEntry>()

function clampMinRatingX10(v: number): number {
  const clamped = Math.max(RATING_MIN_X10, Math.min(RATING_MAX_X10, clampRatingX10(v)))
  return Math.round(clamped / RATING_STEP_X10) * RATING_STEP_X10
}

function ratingForTmdb(tmdbId: number): number | null {
  if (!titlesIndex) return null
  const idx = titlesIndex.idToIdx.get(tmdbId)
  return idx === undefined ? null : titlesIndex.ratings[idx]
}

function isTmdbAllowed(tmdbId: number): boolean {
  const rating = ratingForTmdb(tmdbId)
  return rating == null || rating >= minRatingX10
}

function hasVisibleSwapFx(): boolean {
  if (filterSwapFx.size === 0) return false
  const range = getVisibleRange(vp)
  for (const cellKey of filterSwapFx.keys()) {
    const [col, row] = parseKey(cellKey)
    if (
      col >= range.minCol && col <= range.maxCol
      && row >= range.minRow && row <= range.maxRow
    ) return true
  }
  return false
}

function updateRatingUI() {
  for (let i = 0; i < ratingStars.length; i++) {
    const star = ratingStars[i]
    const iconRatingX10 = Number(star.dataset.ratingX10 || ICON_RATINGS_X10[i] || RATING_MIN_X10)
    const active = Number.isFinite(iconRatingX10) && iconRatingX10 >= minRatingX10
    star.classList.toggle('active', active)
    star.classList.toggle('inactive', !active)
  }
}

function showHint(text: string) {
  searchHint.textContent = text
  searchHint.classList.add('show')
  clearTimeout(hintTimer)
  hintTimer = window.setTimeout(() => {
    searchHint.classList.remove('show')
  }, HINT_DURATION_MS)
}

function pointsToPathD(points: Array<{ x: number, y: number }>): string {
  if (points.length === 0) return ''
  let d = `M ${points[0].x.toFixed(3)} ${points[0].y.toFixed(3)}`
  for (let i = 1; i < points.length; i++) {
    const pt = points[i]
    d += ` L ${pt.x.toFixed(3)} ${pt.y.toFixed(3)}`
  }
  d += ' Z'
  return d
}

function initRatingStripIcons() {
  for (let i = 0; i < ratingStars.length; i++) {
    const star = ratingStars[i]
    const ratingX10 = Number(star.dataset.ratingX10 || ICON_RATINGS_X10[i] || RATING_MIN_X10)
    const path = star.querySelector('path')
    if (!path) continue
    const { points } = buildRatingMorphPath({ ratingX10, cx: 8, cy: 8, radius: 4.4 })
    path.setAttribute('d', pointsToPathD(points))
  }
  updateRatingUI()
}

function setMinRating(next: number) {
  const clamped = clampMinRatingX10(next)
  if (clamped === minRatingX10) return
  minRatingX10 = clamped
  updateRatingUI()
  enforceMinRating()

  const q = searchInput.value.trim()
  if (q) handleSearch(q)
}

function enforceMinRating() {
  ratingFilterSeq++
  const seq = ratingFilterSeq
  ratingReplaceQueue = [...grid.cells.keys()]

  const [cc, cr] = findCenterCell()
  const centerKey = key(cc, cr)
  const centerIdx = ratingReplaceQueue.indexOf(centerKey)
  if (centerIdx > 0) {
    ratingReplaceQueue.splice(centerIdx, 1)
    ratingReplaceQueue.unshift(centerKey)
  }

  if (ratingReplaceRaf) {
    cancelAnimationFrame(ratingReplaceRaf)
    ratingReplaceRaf = 0
  }

  const runBatch = () => {
    if (seq !== ratingFilterSeq) return

    const now = performance.now()
    const visible = getVisibleRange(vp)
    const targetSize = pickSize(vp.scale, window.devicePixelRatio || 1)
    let changed = 0
    let processed = 0
    while (processed < FILTER_REPLACE_BATCH && ratingReplaceQueue.length > 0) {
      const cellKey = ratingReplaceQueue.shift()!
      processed++

      const existing = grid.cells.get(cellKey)
      if (!existing || isTmdbAllowed(existing.tmdbId)) continue

      const oldImgs = stash(cellKey)
      evictImages([cellKey])

      const [col, row] = parseKey(cellKey)
      grid.cells.delete(cellKey)
      grid.onScreen.delete(existing.tmdbId)

      const replacement = generateMovie(col, row, grid, index, isTmdbAllowed, fillCoherent)
      if (replacement) {
        setCell(grid, col, row, replacement)
        if (
          col >= visible.minCol && col <= visible.maxCol
          && row >= visible.minRow && row <= visible.maxRow
        ) {
          filterSwapFx.set(cellKey, {
            oldCell: existing,
            oldImgs,
            createdAt: now,
            startAt: 0,
            timeoutMs: FILTER_SWAP_TIMEOUT,
          })
          loadPoster(cellKey, replacement.posterPath, targetSize)
        } else {
          filterSwapFx.delete(cellKey)
        }
        changed++
      } else {
        filterSwapFx.delete(cellKey)
      }
    }

    if (changed > 0) {
      activeWave = null
      scheduleRepaint()
      preloadPosters(vp, grid)
    }

    if (ratingReplaceQueue.length > 0) {
      ratingReplaceRaf = requestAnimationFrame(runBatch)
    } else {
      ratingReplaceRaf = 0
      scheduleRender()
    }
  }

  ratingReplaceRaf = requestAnimationFrame(runBatch)
}

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
      if (fillRange(grid, range, index, isTmdbAllowed, false, 1) === 0) return
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
    render(ctx, vp, grid, titlesIndex, activeWave, filterSwapFx)
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
  if (gs.active) {
    cancelIdleFill()
    const speed = Math.sqrt(gs.velocityX ** 2 + gs.velocityY ** 2)
    if (activeWave && speed > 1 && !lpInterval) activeWave = null
  }

  let n = 0
  if (!fillPending) {
    if (gs.active) {
      const speed = Math.sqrt(gs.velocityX ** 2 + gs.velocityY ** 2)
      const t = Math.min(speed / 25, 1)
      const noiseFactor = 0.08 + t * 0.72    // 0.08 -> 0.8
      const randomChance = 0.05 + t * 0.55   // 0.05 -> 0.6

      // Pass 1: fill entire render range (no budget - cells show as empty otherwise)
      n = fillRange(grid, getVisibleRange(vp), index, isTmdbAllowed, false, undefined, noiseFactor, randomChance)
      // Pass 2: budget-limited buffer cells for preloading
      // visible cells already exist from pass 1 -> skipped -> budget only for buffer
      n += fillRange(grid, getVisibleRange(vp, GESTURE_BUFFER), index, isTmdbAllowed, false, GESTURE_FILL, noiseFactor, randomChance)
    } else {
      n = fillRange(grid, getVisibleRange(vp, PRELOAD_BUFFER), index, isTmdbAllowed, fillCoherent, FILL_PER_FRAME)
    }
  }

  render(ctx, vp, grid, titlesIndex, activeWave, filterSwapFx)

  if (activeWave) {
    if (isWaveDone(activeWave, performance.now())) {
      activeWave = null
    } else {
      scheduleRender()
    }
  }
  if (hasVisibleSwapFx()) scheduleRender()

  if (n > 0) scheduleRender()
  evictOutside(grid, getVisibleRange(vp, EVICT_BUFFER), (keys) => {
    evictImages(keys)
    for (const k of keys) filterSwapFx.delete(k)
  })
  preloadPosters(vp, grid)
  scheduleIdleFill()
  debugOverlay?.update(vp, gs, grid)
}

/** Find cell col,row closest to screen center */
function findCenterCell(): [number, number] {
  const [wx, wy] = screenToWorld(vp, vp.width / 2, vp.height / 2)
  return [Math.round(wx / CELL_W - 0.5), Math.round(wy / CELL_H - 0.5)]
}

function focusOn(col: number, row: number, seed?: MovieEntry, delay = 0, center = true) {
  activeWave = null
  filterSwapFx.clear()
  clearGrid(grid, clearAllImages)

  const validSeed = seed && isTmdbAllowed(seed.tmdbId) ? seed : undefined
  if (validSeed) {
    setCell(grid, col, row, {
      tmdbId: validSeed.tmdbId,
      posterPath: validSeed.posterPath,
      embedding: validSeed.embedding,
    })
    fillCoherent = true
  } else {
    fillCoherent = false
  }
  if (center) centerOn(vp, col, row)

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

/** Center+fit one card in visible area above search panel */
function centerCardForSearch(col: number, row: number, viewTop: number, viewH: number, animate = true) {
  const panelH = Math.max(60, searchPanel.getBoundingClientRect().height)
  const pad = 24
  const availH = viewH - safeTop - panelH - pad * 2
  const availW = vp.width - pad * 2
  const scaleH = availH / CELL_H
  const scaleW = availW / CELL_W
  const targetScale = Math.min(scaleH, scaleW)

  const centerY = viewTop + (viewH - panelH + safeTop) / 2
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
  searchPanel.classList.add('active')

  searchCell = findCenterCell()
  centerCardForSearch(searchCell[0], searchCell[1], 0, vp.height)
}

/** Exit search mode */
function exitSearchMode() {
  if (!searchMode) return
  if (isDraggingFilter) return

  searchMode = false
  gs.disabled = false
  fillCoherent = false
  searchPanel.classList.remove('active')
  searchInput.blur()
  searchInput.value = ''
  searchHint.classList.remove('show')
  scheduleRender()
}

/** Handle search input: post query to worker */
function handleSearch(query: string) {
  if (!searchReady || !query.trim()) return
  searchWorker.postMessage({ type: 'search', seq: ++searchSeq, query: query.trim(), minRatingX10 })
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
    if (tmdbId == null) {
      showHint(`No matches for >= ${formatRating(minRatingX10)}`)
      return
    }

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
    searchHint.classList.remove('show')
    searchDebounceId = window.setTimeout(() => {
      handleSearch(searchInput.value)
    }, SEARCH_DEBOUNCE)
  })
}

function setupRatingFilter() {
  let pointerId = -1
  let dragStartX = 0
  let dragStartY = 0
  let dragging = false
  let tappedRatingX10: number | null = null
  let prevGsDisabled = false

  function ratingFromClientX(clientX: number): number {
    const rect = ratingStrip.getBoundingClientRect()
    if (rect.width <= 0) return minRatingX10
    const left = rect.left
    const right = rect.right
    const x = Math.max(left, Math.min(right, clientX))
    const t = (x - left) / Math.max(1, right - left)
    return RATING_MIN_X10 + t * (RATING_MAX_X10 - RATING_MIN_X10)
  }

  for (const star of ratingStars) {
    star.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const ratingX10 = Number(star.dataset.ratingX10)
      if (Number.isFinite(ratingX10)) setMinRating(ratingX10)
    })
  }

  searchPanel.addEventListener('pointerdown', (e) => {
    const target = e.target as Element | null
    if (!target?.closest('#rating-filter')) return
    if (e.button !== 0 || pointerId !== -1) return
    const star = target.closest<HTMLButtonElement>('.rating-star')
    const ratingX10 = Number(star?.dataset.ratingX10)
    tappedRatingX10 = star && Number.isFinite(ratingX10) ? ratingX10 : null
    pointerId = e.pointerId
    dragStartX = e.clientX
    dragStartY = e.clientY
    dragging = false
    searchPanel.setPointerCapture(pointerId)
  })

  searchPanel.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return

    const dx = e.clientX - dragStartX
    const dy = e.clientY - dragStartY

    if (!dragging) {
      if (Math.abs(dx) <= RATING_DRAG_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) return
      dragging = true
      isDraggingFilter = true
      searchPanel.classList.add('dragging')
      searchInput.readOnly = true
      searchInput.blur()
      prevGsDisabled = gs.disabled
      gs.disabled = true
      setMinRating(ratingFromClientX(e.clientX))
    }

    e.preventDefault()
    setMinRating(ratingFromClientX(e.clientX))
  })

  function finishDrag(e: PointerEvent) {
    if (e.pointerId !== pointerId) return
    if (searchPanel.hasPointerCapture(pointerId)) searchPanel.releasePointerCapture(pointerId)
    pointerId = -1
    if (!dragging) {
      if (tappedRatingX10 != null) setMinRating(tappedRatingX10)
      tappedRatingX10 = null
      return
    }
    tappedRatingX10 = null

    dragging = false
    isDraggingFilter = false
    searchPanel.classList.remove('dragging')
    searchInput.readOnly = false
    gs.disabled = prevGsDisabled
  }

  searchPanel.addEventListener('pointerup', finishDrag)
  searchPanel.addEventListener('pointercancel', finishDrag)
}

function openMovieLink(sx: number, sy: number) {
  if (suppressNextTap) { suppressNextTap = false; return }
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

function handleLongPress(col: number, row: number) {
  if (searchMode) return
  const cell = grid.cells.get(`${col}:${row}`)
  if (!cell) return
  suppressNextTap = true

  // Stash ALL old cells + images before clearing
  const old = new Map<string, OldCellData>()
  for (const [cellKey, c] of grid.cells) {
    old.set(cellKey, { cell: c, imgs: stash(cellKey) })
  }

  const seedKey = `${col}:${row}`
  const savedImgs = old.get(seedKey)?.imgs
  const seedCell = isTmdbAllowed(cell.tmdbId)
    ? cell
    : generateMovie(col, row, grid, index, isTmdbAllowed, true)

  // Clear and regenerate
  filterSwapFx.clear()
  clearGrid(grid, clearAllImages)
  if (seedCell) {
    setCell(grid, col, row, {
      tmdbId: seedCell.tmdbId,
      posterPath: seedCell.posterPath,
      embedding: seedCell.embedding,
    })
    if (savedImgs && seedCell.tmdbId === cell.tmdbId) restore(seedKey, savedImgs)
  }
  fillCoherent = true
  fillPending = false
  clearTimeout(fillDebounceId)

  // Fill entire visible range NOW (no budget limit)
  fillRange(grid, getVisibleRange(vp, PRELOAD_BUFFER), index, isTmdbAllowed, true)

  // Start seismic wave animation
  const range = getVisibleRange(vp)
  const maxRing = Math.max(
    col - range.minCol, range.maxCol - col,
    row - range.minRow, range.maxRow - row,
  )
  activeWave = startWave(col, row, maxRing, old)

  scheduleRender()
}

async function init() {
  safeTop = getSafeAreaTop()
  initRatingStripIcons()
  resize()
  window.addEventListener('resize', () => { resize(); scheduleRender() })
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onVisualViewportChange)
    window.visualViewport.addEventListener('scroll', onVisualViewportChange)
  }

  index = await loadEmbeddings()
  const titlesLoaded = await loadTitles()

  if (!titlesLoaded) {
    searchPanel.style.display = 'none'
  } else {
    updateRatingUI()
  }

  focusOn(0, 0)
  setupGestures(canvas, vp, gs, scheduleRender, openMovieLink)

  // Long-press (500ms) -> refresh grid around pressed card
  lpTimer = 0
  lpInterval = 0
  let lpStartX = 0
  let lpStartY = 0

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { clearTimeout(lpTimer); lpTimer = 0; clearInterval(lpInterval); lpInterval = 0; return }
    const t = e.touches[0]
    lpStartX = t.clientX
    lpStartY = t.clientY
    lpTimer = window.setTimeout(() => {
      lpTimer = 0
      gs.panning = false; gs.velocityX = gs.velocityY = 0; cancelAnimationFrame(gs.animId)
      const [wx, wy] = screenToWorld(vp, lpStartX, lpStartY)
      const c = Math.floor(wx / CELL_W), r = Math.floor(wy / CELL_H)
      handleLongPress(c, r)
      lpInterval = window.setInterval(() => handleLongPress(c, r), 3000)
      gs.panning = true
    }, 1000)
  }, { passive: true })

  canvas.addEventListener('touchmove', (e) => {
    if (!lpTimer && !lpInterval) return
    const t = e.touches[0]
    const dx = t.clientX - lpStartX
    const dy = t.clientY - lpStartY
    if (lpTimer && dx * dx + dy * dy > 100) { clearTimeout(lpTimer); lpTimer = 0 }
  }, { passive: true })

  canvas.addEventListener('touchend', () => { clearTimeout(lpTimer); lpTimer = 0; clearInterval(lpInterval); lpInterval = 0 })

  canvas.addEventListener('mousedown', (e) => {
    lpStartX = e.clientX
    lpStartY = e.clientY
    lpTimer = window.setTimeout(() => {
      lpTimer = 0
      gs.panning = false; gs.velocityX = gs.velocityY = 0; cancelAnimationFrame(gs.animId)
      const [wx, wy] = screenToWorld(vp, lpStartX, lpStartY)
      const c = Math.floor(wx / CELL_W), r = Math.floor(wy / CELL_H)
      handleLongPress(c, r)
      lpInterval = window.setInterval(() => handleLongPress(c, r), 3000)
    }, 1000)
  })

  canvas.addEventListener('mousemove', (e) => {
    if (!lpTimer && !lpInterval) return
    const dx = e.clientX - lpStartX
    const dy = e.clientY - lpStartY
    if (lpTimer && dx * dx + dy * dy > 100) { clearTimeout(lpTimer); lpTimer = 0 }
  })

  canvas.addEventListener('mouseup', () => { clearTimeout(lpTimer); lpTimer = 0; clearInterval(lpInterval); lpInterval = 0 })

  // 2-finger double-tap toggles debug overlay
  let lastDblTouchTime = 0
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return
    const now = performance.now()
    if (now - lastDblTouchTime < 400) {
      if (!debugOverlay) {
        debugOverlay = createDebugOverlay()
      } else {
        debugOverlay.toggle()
      }
      scheduleRender()
      lastDblTouchTime = 0
    } else {
      lastDblTouchTime = now
    }
  })

  setupSearch()
  setupRatingFilter()
  scheduleRender()
}

init()
