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

/** Builds a closed polygon path for a dot->diamond->star rating morph. */
export function buildRatingMorphPath(params: BuildRatingMorphPathParams): MorphPathData {
  const t = ratingToMorphT(params.ratingX10)
  const detail = Math.max(8, Math.round(params.detail ?? 32))
  const outerR = params.radius
  const starness = Math.min(1, t * 1.5)
  const innerR = outerR * (1 - starness * 0.55)
  const points: MorphPoint[] = []

  if (t < 0.5) {
    const circleR = outerR * (0.4 + t * 0.6)
    for (let i = 0; i < detail; i++) {
      const a = (i / detail) * Math.PI * 2 - Math.PI / 2
      points.push({
        x: params.cx + Math.cos(a) * circleR,
        y: params.cy + Math.sin(a) * circleR,
      })
    }
    return { points, t }
  }

  const spikes = t < 0.8 ? 4 : 5
  const totalPoints = spikes * 2
  for (let i = 0; i < totalPoints; i++) {
    const a = (i * Math.PI) / spikes - Math.PI / 2
    const r = i % 2 === 0 ? outerR : innerR
    points.push({
      x: params.cx + Math.cos(a) * r,
      y: params.cy + Math.sin(a) * r,
    })
  }
  return { points, t }
}

