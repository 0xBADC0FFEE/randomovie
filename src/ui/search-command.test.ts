import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSearchCommand } from './search-command.ts'

test('parses /trackpad exact', () => {
  assert.equal(parseSearchCommand('/trackpad'), 'trackpad')
})

test('parses /trackpad with spaces and case', () => {
  assert.equal(parseSearchCommand('  /TRACKPAD  '), 'trackpad')
})

test('does not parse /trackpad with args', () => {
  assert.equal(parseSearchCommand('/trackpad on'), null)
})

test('does not parse unknown slash command', () => {
  assert.equal(parseSearchCommand('/abc'), null)
})
