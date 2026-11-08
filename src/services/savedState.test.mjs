import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSavedState } from './savedState.ts'

const DEFAULTS = { title: '', postUrl: '', prizes: '', winnerCount: 5, duplicates: 'all', maxPerAccount: 10, minMentions: 1, requirements: [] }
const saved = (overrides = {}) => JSON.stringify({
  view: 'entries',
  config: { title: 'Shooky', postUrl: 'https://www.instagram.com/p/ABC/', prizes: 'Merch', winnerCount: 3, duplicates: 'limit', maxPerAccount: 5, minMentions: 2, requirements: ['mention', 'like'] },
  raw: '@ana: hola\n@beto: yo',
  winners: [{ username: '@ana', ticketNumber: 4 }],
  ...overrides,
})

test('a saved raffle is restored exactly: screen, rules, comments and winners', () => {
  const state = parseSavedState(saved(), DEFAULTS)
  assert.equal(state.view, 'entries')
  assert.equal(state.config.duplicates, 'limit')
  assert.equal(state.config.maxPerAccount, 5)
  assert.deepEqual(state.config.requirements, ['mention', 'like'])
  assert.equal(state.raw, '@ana: hola\n@beto: yo')
  assert.deepEqual(state.winners, [{ username: '@ana', ticketNumber: 4 }])
})

test('nothing saved, or text that is not JSON, gives no state instead of an error', () => {
  assert.equal(parseSavedState(null, DEFAULTS), null)
  assert.equal(parseSavedState('', DEFAULTS), null)
  assert.equal(parseSavedState('{no es json', DEFAULTS), null)
  assert.equal(parseSavedState('[1,2,3]', DEFAULTS), null)
  assert.equal(parseSavedState('"texto"', DEFAULTS), null)
})

test('invalid fields fall back to the defaults without discarding the valid ones', () => {
  const state = parseSavedState(saved({
    view: 'otra-pantalla',
    config: { title: 'Sigue valido', winnerCount: 99, duplicates: 'raro', maxPerAccount: 0, minMentions: 'x', requirements: ['mention', 'hackear'] },
  }), DEFAULTS)
  assert.equal(state.view, 'home')
  assert.equal(state.config.title, 'Sigue valido')
  assert.equal(state.config.winnerCount, 5)
  assert.equal(state.config.duplicates, 'all')
  assert.equal(state.config.maxPerAccount, 10)
  assert.equal(state.config.minMentions, 1)
  assert.deepEqual(state.config.requirements, ['mention'])
})

test('malformed winners are dropped and there are never more winners than prizes', () => {
  const state = parseSavedState(saved({
    config: { winnerCount: 2 },
    winners: [{ username: '@a', ticketNumber: 1 }, { username: 7 }, { username: '@b', ticketNumber: 0 }, { username: '@c', ticketNumber: 9 }, { username: '@d', ticketNumber: 3 }],
  }), DEFAULTS)
  assert.deepEqual(state.winners, [{ username: '@a', ticketNumber: 1 }, { username: '@c', ticketNumber: 9 }])
})

test('a large import survives the round trip intact', () => {
  const raw = Array.from({ length: 10000 }, (_, i) => `@cuenta${i}: quiero ganar @amiga${i}`).join('\n')
  const state = parseSavedState(saved({ raw }), DEFAULTS)
  assert.equal(state.raw.length, raw.length)
  assert.ok(JSON.stringify({ raw }).length < 1_500_000, 'must stay far below the ~5 MB localStorage quota')
})

test('an old save without the new fields still restores, using the defaults for them', () => {
  const state = parseSavedState(JSON.stringify({ view: 'setup', config: { title: 'Viejo', winnerCount: 4 }, raw: '@a: x' }), DEFAULTS)
  assert.equal(state.config.title, 'Viejo')
  assert.equal(state.config.duplicates, 'all')
  assert.deepEqual(state.winners, [])
})

test('a cap of 25 per account is restored as saved', () => {
  const state = parseSavedState(saved({ config: { duplicates: 'limit', maxPerAccount: 25 } }), DEFAULTS)
  assert.equal(state.config.duplicates, 'limit')
  assert.equal(state.config.maxPerAccount, 25)
})

