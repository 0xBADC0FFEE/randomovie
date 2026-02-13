export interface MorphPoint {
  x: number
  y: number
}

export interface BuildRatingMorphPathParams {
  ratingX10: number
  cx: number
  cy: number
  radius: number
  detail?: number
}

export interface MorphPathData {
  points: MorphPoint[]
  t: number
}

const ICON_LEVELS_X10 = [50, 60, 65, 75, 80] as const

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export function clampRatingX10(ratingX10: number): number {
  return clamp(Math.round(ratingX10), 0, 100)
}

/** rating 5.0 -> 0, rating 8.0+ -> 1 */
export function ratingToMorphT(ratingX10: number): number {
  return clamp((clampRatingX10(ratingX10) - 50) / 30, 0, 1)
}

function quantizeToIconIndex(ratingX10: number): number {
  const r = clamp(clampRatingX10(ratingX10), ICON_LEVELS_X10[0], ICON_LEVELS_X10[ICON_LEVELS_X10.length - 1])
  let bestIdx = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < ICON_LEVELS_X10.length; i++) {
    const d = Math.abs(r - ICON_LEVELS_X10[i])
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  return bestIdx
}

function buildCirclePoints(cx: number, cy: number, radius: number, detail: number): MorphPoint[] {
  const points: MorphPoint[] = []
  for (let i = 0; i < detail; i++) {
    const a = (i / detail) * Math.PI * 2 - Math.PI / 2
    points.push({
      x: cx + Math.cos(a) * radius,
      y: cy + Math.sin(a) * radius,
    })
  }
  return points
}

function buildDiamondPoints(cx: number, cy: number, radius: number): MorphPoint[] {
  return [
    { x: cx, y: cy - radius },
    { x: cx + radius, y: cy },
    { x: cx, y: cy + radius },
    { x: cx - radius, y: cy },
  ]
}

function buildStarPoints(cx: number, cy: number, outerR: number, innerR: number, spikes: number): MorphPoint[] {
  const points: MorphPoint[] = []
  const totalPoints = spikes * 2
  for (let i = 0; i < totalPoints; i++) {
    const a = (i * Math.PI) / spikes - Math.PI / 2
    const r = i % 2 === 0 ? outerR : innerR
    points.push({
      x: cx + Math.cos(a) * r,
      y: cy + Math.sin(a) * r,
    })
  }
  return points
}

/** Builds a closed polygon path for a dot->diamond->star rating morph. */
export function buildRatingMorphPath(params: BuildRatingMorphPathParams): MorphPathData {
  const idx = quantizeToIconIndex(params.ratingX10)
  const t = idx / (ICON_LEVELS_X10.length - 1)
  const detail = Math.max(8, Math.round(params.detail ?? 32))
  const r = params.radius

  if (idx === 0) {
    return { points: buildCirclePoints(params.cx, params.cy, r * 0.48, detail), t }
  }
  if (idx === 1) {
    return { points: buildCirclePoints(params.cx, params.cy, r * 0.76, detail), t }
  }
  if (idx === 2) {
    return { points: buildDiamondPoints(params.cx, params.cy, r * 0.94), t }
  }
  if (idx === 3) {
    return { points: buildStarPoints(params.cx, params.cy, r, r * 0.38, 4), t }
  }

  return { points: buildStarPoints(params.cx, params.cy, r, r * 0.48, 5), t }
}
