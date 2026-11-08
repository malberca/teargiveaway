import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addRaffle, buildFinishedRaffle, formatWinnersText, makeId, MAX_HISTORY, parseHistory, removeRaffle, sha256Hex } from './raffles.ts'

const CONFIG = { title: '  Shooky de noviembre ', postUrl: ' https://www.instagram.com/p/ABC/ ', prizes: 'Merch\nPoster', winnerCount: 3, duplicates: 'limit', maxPerAccount: 10, minMentions: 2, requirements: ['mention', 'like'] }
const PARSED = { commentsCount: 7000, tickets: new Array(11668).fill('x'), entries: new Array(2540).fill(null), excludedDuplicates: 12, excludedByMentions: 3 }
const WINNERS = [{ username: '@ana', ticketNumber: 40 }, { username: '@beto', ticketNumber: 99 }]
const NOW = new Date('2026-11-08T03:30:00.000Z')

const build = (overrides = {}) => buildFinishedRaffle({ id: 'r1', now: NOW, config: CONFIG, parsed: PARSED, winners: WINNERS, prizes: ['Merch', 'Poster', 'Sticker'], fingerprint: 'abc', ...overrides })

test('a finished raffle summarizes rules, stats and winners with their prizes', () => {
  const raffle = build()
  assert.equal(raffle.id, 'r1')
  assert.equal(raffle.finishedAt, '2026-11-08T03:30:00.000Z')
  assert.equal(raffle.title, 'Shooky de noviembre')
  assert.equal(raffle.postUrl, 'https://www.instagram.com/p/ABC/')
  assert.equal(raffle.prizesRequested, 3)
  assert.deepEqual(raffle.rules, { duplicates: 'limit', maxPerAccount: 10, minMentions: 2, requirements: ['mention', 'like'] })
  assert.deepEqual(raffle.stats, { comments: 7000, tickets: 11668, uniqueAccounts: 2540, excludedDuplicates: 12, excludedByMentions: 3 })
  assert.deepEqual(raffle.winners, [
    { position: 1, username: '@ana', ticketNumber: 40, prize: 'Merch' },
    { position: 2, username: '@beto', ticketNumber: 99, prize: 'Poster' },
  ])
  assert.equal(raffle.fingerprint, 'abc')
})

test('it keeps no comments at all: a 7,000-comment import must not fill the storage', () => {
  const text = JSON.stringify(build())
  assert.ok(text.length < 2000, `summary should be tiny, was ${text.length} bytes`)
  assert.doesNotMatch(text, /quiero ganar/)
})

test('a winner without a matching prize line has no prize', () => {
  const raffle = build({ prizes: [] })
  assert.deepEqual(raffle.winners.map((winner) => winner.prize), [null, null])
})

test('the rules are copied, so editing the draft afterwards does not change the saved raffle', () => {
  const config = { ...CONFIG, requirements: ['mention'] }
  const raffle = build({ config })
  config.requirements.push('like')
  assert.deepEqual(raffle.rules.requirements, ['mention'])
})

test('the fingerprint is the real SHA-256 and changes with a single character', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.notEqual(await sha256Hex('@ana: hola'), await sha256Hex('@ana: hola!'))
  assert.equal((await sha256Hex('')).length, 64)
})

test('ids are unique', () => {
  assert.equal(new Set(Array.from({ length: 200 }, makeId)).size, 200)
})

test('adding puts the newest first, replaces the same id and never exceeds the limit', () => {
  const a = build({ id: 'a' }); const b = build({ id: 'b' })
  assert.deepEqual(addRaffle(addRaffle([], a), b).map((raffle) => raffle.id), ['b', 'a'])
  assert.deepEqual(addRaffle([a, b], build({ id: 'a', fingerprint: 'nuevo' })).map((raffle) => raffle.id), ['a', 'b'])
  const full = Array.from({ length: MAX_HISTORY }, (_, i) => build({ id: `old${i}` }))
  const next = addRaffle(full, build({ id: 'nuevo' }))
  assert.equal(next.length, MAX_HISTORY)
  assert.equal(next[0].id, 'nuevo')
  assert.equal(next.at(-1).id, `old${MAX_HISTORY - 2}`)
})

test('removing drops only that raffle', () => {
  const history = [build({ id: 'a' }), build({ id: 'b' })]
  assert.deepEqual(removeRaffle(history, 'a').map((raffle) => raffle.id), ['b'])
  assert.equal(removeRaffle(history, 'zzz').length, 2)
})

test('the winners text lists each prize and the item won', () => {
  assert.equal(formatWinnersText(build()), 'Premio 1: @ana — Merch\nPremio 2: @beto — Poster')
  assert.equal(formatWinnersText(build({ prizes: [] })), 'Premio 1: @ana\nPremio 2: @beto')
})

test('what is saved restores identically', () => {
  const history = [build({ id: 'a' }), build({ id: 'b', prizes: [] })]
  assert.deepEqual(parseHistory(JSON.stringify(history)), history)
})

test('nothing saved, broken JSON or the wrong shape gives an empty list, never an error', () => {
  for (const value of [null, '', '{roto', '{"a":1}', '"texto"', '42']) assert.deepEqual(parseHistory(value), [])
})

test('an invalid raffle is dropped but the valid ones around it survive', () => {
  const good = build({ id: 'good' })
  const parsed = parseHistory(JSON.stringify([
    good,
    { ...good, id: '' },
    { ...good, id: 'sin-fecha', finishedAt: 'no es fecha' },
    { ...good, id: 'sin-reglas', rules: null },
    { ...good, id: 'stats-malas', stats: { ...good.stats, comments: -5 } },
    { ...good, id: 'premios-0', prizesRequested: 0 },
    'texto', null, 7,
  ]))
  assert.deepEqual(parsed.map((raffle) => raffle.id), ['good'])
})

test('malformed winners are dropped and a raffle never lists more winners than prizes', () => {
  const good = build({ id: 'x' })
  const [raffle] = parseHistory(JSON.stringify([{ ...good, prizesRequested: 1, winners: [
    { position: 1, username: '@a', ticketNumber: 3, prize: 'Merch' }, { position: 2, username: '@b', ticketNumber: 4, prize: null }, { username: 5 }, null,
  ] }]))
  assert.deepEqual(raffle.winners, [{ position: 1, username: '@a', ticketNumber: 3, prize: 'Merch' }])
})

test('an unknown requirement or a missing fingerprint falls back safely', () => {
  const good = build({ id: 'x' })
  const [raffle] = parseHistory(JSON.stringify([{ ...good, fingerprint: undefined, rules: { ...good.rules, requirements: ['mention', 'hackear'] } }]))
  assert.deepEqual(raffle.rules.requirements, ['mention'])
  assert.equal(raffle.fingerprint, '')
})
