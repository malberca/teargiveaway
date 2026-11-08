// Renders the real component to HTML (no browser) and checks what the user would see.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

let tmp
let render

before(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'history-'))
  const outfile = join(tmp, 'render.mjs')
  const component = resolve('src/components/RaffleHistory.tsx')
  await build({
    stdin: {
      contents: `import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import RaffleHistory from ${JSON.stringify(component)}
const noop = () => {}
export const render = (raffles, initiallyExpanded) => renderToStaticMarkup(createElement(RaffleHistory, { raffles, onNew: noop, onExport: noop, onCopy: noop, onDelete: noop, initiallyExpanded }))`,
      resolveDir: process.cwd(),
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    outfile,
    logLevel: 'silent',
  })
  render = (await import(pathToFileURL(outfile).href)).render
})

after(async () => { await rm(tmp, { recursive: true, force: true }) })

const raffle = (id, overrides = {}) => ({
  id,
  finishedAt: '2026-11-08T03:30:00.000Z',
  title: 'Shooky de noviembre',
  postUrl: 'https://www.instagram.com/p/ABC/',
  prizesRequested: 3,
  rules: { duplicates: 'limit', maxPerAccount: 10, minMentions: 1, requirements: [] },
  stats: { comments: 7000, tickets: 11668, uniqueAccounts: 2540, excludedDuplicates: 12, excludedByMentions: 3 },
  winners: [{ position: 1, username: '@paumolina_23', ticketNumber: 40, prize: 'Merch' }, { position: 2, username: '@beto', ticketNumber: 99, prize: null }],
  fingerprint: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  ...overrides,
})

test('with no raffles it shows the empty state and the NEW button', () => {
  const html = render([])
  assert.match(html, /Sin sorteos/)
  assert.match(html, /NEW/)
  assert.doesNotMatch(html, /raffle-item/)
})

test('each finished raffle shows title, how many winners and the numbers', () => {
  const html = render([raffle('a')])
  assert.match(html, /Shooky de noviembre/)
  assert.match(html, /2 de 3 ganadores/)
  assert.match(html, /7\.000 comentarios/)
  assert.match(html, /2\.540 cuentas únicas/)
  assert.match(html, /Ver ganadores/)
  assert.match(html, /Acta JSON/)
  assert.match(html, /Copiar ganadores/)
  assert.match(html, /Eliminar/)
})

test('winners and the fingerprint stay hidden until the raffle is opened', () => {
  const html = render([raffle('a')])
  assert.doesNotMatch(html, /@paumolina_23/)
  assert.doesNotMatch(html, /ba7816bf/)
})

test('an opened raffle lists the winners with their prize, and the SHA-256 fingerprint', () => {
  const html = render([raffle('a')], 'a')
  assert.match(html, /PREMIO 01/)
  assert.match(html, /@paumolina_23/)
  assert.match(html, /Merch/)
  assert.match(html, /@beto/)
  assert.match(html, /Huella SHA-256/)
  assert.match(html, /ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad/)
  assert.match(html, /Ocultar ganadores/)
})

test('a raffle without title is shown with a readable name, and one prize reads in singular', () => {
  const html = render([raffle('a', { title: '', prizesRequested: 1, winners: [{ position: 1, username: '@x', ticketNumber: 1, prize: null }] })])
  assert.match(html, /Sorteo sin título/)
  assert.match(html, /1 de 1 ganador /)
})

test('several raffles are listed in the given order', () => {
  const html = render([raffle('nuevo', { title: 'Segundo' }), raffle('viejo', { title: 'Primero' })])
  assert.ok(html.indexOf('Segundo') < html.indexOf('Primero'))
})
