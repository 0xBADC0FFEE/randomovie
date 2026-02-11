import type { CellRange } from '../canvas/viewport.ts'
import type { EmbeddingsIndex } from './embeddings.ts'
import { generateMovie } from './generator.ts'

export interface MovieCell {
  tmdbId: number
  posterPath: string
  embedding: Uint8Array
}

export interface Grid {
  cells: Map<string, MovieCell>
  onScreen: Set<number>  // tmdbIds currently placed
  filledRange: CellRange
}

export function createGrid(): Grid {
  return {
    cells: new Map(),
    onScreen: new Set(),
    filledRange: { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 },
  }
}

export function clearGrid(grid: Grid, onEvict?: (keys: string[]) => void) {
  if (onEvict) onEvict([...grid.cells.keys()])
  grid.cells.clear()
  grid.onScreen.clear()
  grid.filledRange = { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 }
}

function key(col: number, row: number): string {
  return `${col}:${row}`
}

export function setCell(grid: Grid, col: number, row: number, cell: MovieCell) {
  grid.cells.set(key(col, row), cell)
  grid.onScreen.add(cell.tmdbId)
  grid.filledRange.minCol = Math.min(grid.filledRange.minCol, col)
  grid.filledRange.maxCol = Math.max(grid.filledRange.maxCol, col)
  grid.filledRange.minRow = Math.min(grid.filledRange.minRow, row)
  grid.filledRange.maxRow = Math.max(grid.filledRange.maxRow, row)
}

/** Fill empty cells within range. Returns number of cells generated. */
export function fillRange(
  grid: Grid, range: CellRange, index: EmbeddingsIndex,
  coherent = false, maxNew = Infinity,
): number {
  let generated = 0
  for (let row = range.minRow; row <= range.maxRow; row++) {
    for (let col = range.minCol; col <= range.maxCol; col++) {
      if (grid.cells.has(key(col, row))) continue
      if (generated >= maxNew) return generated
      const cell = generateMovie(col, row, grid, index, coherent)
      if (cell) setCell(grid, col, row, cell)
      generated++
    }
  }
  return generated
}

/** Evict cells outside viewport + buffer. Frees memory for distant cells. */
export function evictOutside(grid: Grid, keep: CellRange, onEvict?: (keys: string[]) => void) {
  const evicted: string[] = []
  for (const [k, cell] of grid.cells) {
    const [cs, rs] = k.split(':')
    const col = parseInt(cs)
    const row = parseInt(rs)
    if (col < keep.minCol || col > keep.maxCol || row < keep.minRow || row > keep.maxRow) {
      grid.cells.delete(k)
      grid.onScreen.delete(cell.tmdbId)
      evicted.push(k)
    }
  }
  if (evicted.length && onEvict) onEvict(evicted)
}
