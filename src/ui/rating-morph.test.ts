import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRatingMorphPath } from './rating-morph.ts'

test('idx=2 returns a 3-spike star shape (6 points)', () => {
  const out = buildRatingMorphPath({
    ratingX10: 65,
    cx: 8,
    cy: 8,
    radius: 4.4,
    detail: 48,
  })
  assert.equal(out.points.length, 6)
})

test('concave triangle is vertically centered by bbox midpoint', () => {
  const cy = 20
  const out = buildRatingMorphPath({
    ratingX10: 65,
    cx: 20,
    cy,
    radius: 10,
    detail: 48,
  })
  const ys = out.points.map((p) => p.y)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const bboxCenterY = (minY + maxY) / 2
  assert.ok(Math.abs(bboxCenterY - cy) < 1e-9)
})

test('concavity pulls inner points inward vs non-concave variant', () => {
  const cx = 20
  const cy = 20
  const base = {
    ratingX10: 65,
    cx,
    cy,
    radius: 10,
  }
  const flat = buildRatingMorphPath({ ...base, triangleConcavity: 0 })
  const concave = buildRatingMorphPath({ ...base, triangleConcavity: 0.16 })
  for (let i = 1; i < concave.points.length; i += 2) {
    const dFlat = Math.hypot(flat.points[i].x - cx, flat.points[i].y - cy)
    const dConcave = Math.hypot(concave.points[i].x - cx, concave.points[i].y - cy)
    assert.ok(dConcave < dFlat)
  }
})

test('shape points are finite and deterministic', () => {
  const params = {
    ratingX10: 65,
    cx: 12,
    cy: 18,
    radius: 7,
    detail: 54,
    triangleConcavity: 0.16,
  }
  const a = buildRatingMorphPath(params)
  const b = buildRatingMorphPath(params)
  assert.deepEqual(a, b)
  for (const p of a.points) {
    assert.ok(Number.isFinite(p.x))
    assert.ok(Number.isFinite(p.y))
  }
})
