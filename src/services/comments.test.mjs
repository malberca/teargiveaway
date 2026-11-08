import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseComments } from './comments.ts'

const ALL = { maxPerAccount: Number.POSITIVE_INFINITY, requireMentions: false, minMentions: 1 }
const lines = (...items) => items.join('\n')

test('accepting repeats counts every comment and every mention as a chance', () => {
  const parsed = parseComments(lines('@ana: hola', '@ana: otra vez @beto', '@beto: yo'), ALL)
  assert.equal(parsed.commentsCount, 3)
  assert.equal(parsed.entries.length, 2)
  assert.equal(parsed.tickets.length, 4)
  assert.equal(parsed.excludedDuplicates, 0)
})

test('rejecting repeats (max 1) keeps only the first comment of each account', () => {
  const parsed = parseComments(lines('@ana: primero', '@ana: segundo @beto', '@beto: yo'), { ...ALL, maxPerAccount: 1 })
  assert.equal(parsed.commentsCount, 2)
  assert.equal(parsed.excludedDuplicates, 1)
  assert.deepEqual(parsed.tickets, ['@ana', '@beto'])
})

test('a per-account limit keeps the first N comments and discards the rest', () => {
  const input = lines(...Array.from({ length: 15 }, () => '@fan: quiero ganar'), '@otra: hola')
  const parsed = parseComments(input, { ...ALL, maxPerAccount: 10 })
  assert.equal(parsed.commentsCount, 11)
  assert.equal(parsed.entries.find((entry) => entry.username === '@fan').chances, 10)
  assert.equal(parsed.excludedDuplicates, 5)
})

test('the limit applies per account and ignores case', () => {
  const parsed = parseComments(lines('@Ana: 1', '@ana: 2', '@ANA: 3'), { ...ALL, maxPerAccount: 2 })
  assert.equal(parsed.commentsCount, 2)
  assert.equal(parsed.excludedDuplicates, 1)
  assert.equal(parsed.entries.length, 1)
})

test('mentions are checked before the limit, so a comment without mentions does not use a slot', () => {
  const parsed = parseComments(lines('@ana: sin mención', '@ana: con @beto', '@ana: otra @carla'), { maxPerAccount: 1, requireMentions: true, minMentions: 1 })
  assert.equal(parsed.excludedByMentions, 1)
  assert.equal(parsed.commentsCount, 1)
  assert.equal(parsed.excludedDuplicates, 1)
  assert.deepEqual(parsed.tickets, ['@ana', '@ana'])
})

test('lines that are not comments are reported as errors and do not count', () => {
  const parsed = parseComments(lines('texto suelto', '@ana: ok'), ALL)
  assert.deepEqual(parsed.errors, ['texto suelto'])
  assert.equal(parsed.commentsCount, 1)
})

test('7,000 comments are processed fast in every mode and the discarded count is reported', () => {
  const input = Array.from({ length: 7000 }, (_, i) => `@${i % 7 === 0 ? `fan${i % 40}` : `cuenta${i % 2500}`}: quiero ganar`).join('\n')
  const started = performance.now()
  const all = parseComments(input, ALL)
  const capped = parseComments(input, { ...ALL, maxPerAccount: 10 })
  const one = parseComments(input, { ...ALL, maxPerAccount: 1 })
  assert.ok(performance.now() - started < 1000, 'must stay well below a second')
  assert.equal(all.commentsCount, 7000)
  assert.equal(one.commentsCount, one.entries.length)
  assert.ok(capped.commentsCount > one.commentsCount && capped.commentsCount < all.commentsCount)
  assert.equal(capped.commentsCount + capped.excludedDuplicates, 7000)
  assert.equal(one.commentsCount + one.excludedDuplicates, 7000)
})

test('every account keeps at least one chance when a limit is set, so nobody is dropped entirely', () => {
  const input = lines('@a: x', '@a: x', '@b: x')
  const capped = parseComments(input, { ...ALL, maxPerAccount: 1 })
  assert.deepEqual(capped.entries.map((entry) => entry.username).sort(), ['@a', '@b'])
})

test('a cap of 25 per account keeps the first 25 comments and discards the rest', () => {
  const input = Array.from({ length: 40 }, () => '@insistente: quiero ganar').concat(['@otra: hola']).join('\n')
  const parsed = parseComments(input, { ...ALL, maxPerAccount: 25 })
  assert.equal(parsed.entries.find((entry) => entry.username === '@insistente').chances, 25)
  assert.equal(parsed.commentsCount, 26)
  assert.equal(parsed.excludedDuplicates, 15)
})

