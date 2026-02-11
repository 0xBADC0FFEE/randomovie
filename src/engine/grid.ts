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

/** Fill all empty cells within the given range */
export function fillRange(grid: Grid, range: CellRange, index: EmbeddingsIndex) {
  for (let row = range.minRow; row <= range.maxRow; row++) {
    for (let col = range.minCol; col <= range.maxCol; col++) {
      if (grid.cells.has(key(col, row))) continue
      const cell = generateMovie(col, row, grid, index)
      if (cell) setCell(grid, col, row, cell)
    }
  }
}

/** Evict cells outside viewport + buffer. Frees memory for distant cells. */
export function evictOutside(grid: Grid, keep: CellRange) {
  for (const [k, cell] of grid.cells) {
    const [cs, rs] = k.split(':')
    const col = parseInt(cs)
    const row = parseInt(rs)
    if (col < keep.minCol || col > keep.maxCol || row < keep.minRow || row > keep.maxRow) {
      grid.cells.delete(k)
      grid.onScreen.delete(cell.tmdbId)
    }
  }
}
