import assert from 'node:assert/strict'
import test from 'node:test'
import { isBackgroundOpen } from './link-open-intent.ts'

test('metaKey requests background open', () => {
  assert.equal(isBackgroundOpen({
    source: 'mouse',
    button: 0,
    metaKey: true,
    ctrlKey: false,
  }), true)
})

test('ctrlKey requests background open', () => {
  assert.equal(isBackgroundOpen({
    source: 'mouse',
    button: 0,
    metaKey: false,
    ctrlKey: true,
  }), true)
})

test('middle button requests background open', () => {
  assert.equal(isBackgroundOpen({
    source: 'aux',
    button: 1,
    metaKey: false,
    ctrlKey: false,
  }), true)
})

test('plain left click stays default open mode', () => {
  assert.equal(isBackgroundOpen({
    source: 'mouse',
    button: 0,
    metaKey: false,
    ctrlKey: false,
  }), false)
})
