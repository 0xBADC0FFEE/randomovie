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
  triangleConcavity?: number
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

function centerPointsY(points: MorphPoint[], cy: number): MorphPoint[] {
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of points) {
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const dy = cy - (minY + maxY) / 2
  if (Math.abs(dy) > 0) {
    for (const p of points) p.y += dy
  }
  return points
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

function buildConcaveTrianglePoints(
  cx: number,
  cy: number,
  radius: number,
  triangleConcavity = 0.24,
): MorphPoint[] {
  const concavity = clamp(triangleConcavity, 0, 0.45)
  // 0.5 is the edge midpoint radius for an equilateral triangle (flat face).
  // To make faces concave, inner points must be strictly inside 0.5 * R.
  const innerRatio = clamp(0.5 - concavity * 0.5, 0.15, 0.5)
  const points = buildStarPoints(cx, cy, radius, radius * innerRatio, 3)
  return centerPointsY(points, cy)
}

/** Builds a closed polygon path for a dot->triangle->star rating morph. */
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
    return {
      points: buildConcaveTrianglePoints(
        params.cx,
        params.cy,
        r * 1,
        params.triangleConcavity ?? 0.30,
      ),
      t,
    }
  }
  if (idx === 3) {
    return { points: buildStarPoints(params.cx, params.cy, r, r * 0.38, 4), t }
  }

  return { points: buildStarPoints(params.cx, params.cy, r, r * 0.48, 5), t }
}
