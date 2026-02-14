export interface MotionDiversityMetrics {
  speed: number
  t: number
  noiseFactor: number
  randomChance: number
  diversityEligible: boolean
}

export function calcMotionDiversityMetrics(
  velocityX: number,
  velocityY: number,
  active: boolean,
): MotionDiversityMetrics {
  const speed = Math.hypot(velocityX, velocityY)
  const t = Math.min(speed / 25, 1)
  const noiseFactor = 0.08 + t * 0.72
  const randomChance = 0.05 + t * 0.55
  return { speed, t, noiseFactor, randomChance, diversityEligible: active }
}
