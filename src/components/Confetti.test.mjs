// Renders the real component to HTML (no browser needed) and checks what the user would get.
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
  tmp = await mkdtemp(join(tmpdir(), 'confetti-'))
  const outfile = join(tmp, 'render.mjs')
  const component = resolve('src/components/Confetti.tsx')
  await build({
    stdin: {
      contents: `import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import Confetti from ${JSON.stringify(component)}
export const render = (reduceMotion) => renderToStaticMarkup(createElement(Confetti, { reduceMotion }))`,
      resolveDir: process.cwd(),
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    // react-dom/server is CommonJS and needs `require` when bundled into an ES module.
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    outfile,
    logLevel: 'silent',
  })
  render = (await import(pathToFileURL(outfile).href)).render
})

after(async () => { await rm(tmp, { recursive: true, force: true }) })

const count = (html, pattern) => (html.match(pattern) ?? []).length

test('the celebration has 90 confetti pieces and 30 party emojis, hidden from screen readers', () => {
  const html = render(false)
  assert.match(html, /class="confetti"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*class="confetti"/)
  assert.equal(count(html, /class="confetti-piece/g), 90)
  assert.equal(count(html, /class="confetti-emoji"/g), 30)
})

test('the emojis are the party ones and every piece carries its own motion variables', () => {
  const html = render(false)
  for (const emoji of ['🎉', '🎊', '🥳']) assert.ok(html.includes(emoji), `missing ${emoji}`)
  for (const variable of ['--x', '--drift', '--rot', '--size', '--delay', '--dur', '--color']) assert.ok(html.includes(variable), `missing ${variable}`)
})

test('confetti comes in three shapes so it does not look uniform', () => {
  const html = render(false)
  assert.ok(count(html, /confetti-piece dot/g) > 0)
  assert.ok(count(html, /confetti-piece ribbon/g) > 0)
  assert.ok(count(html, /confetti-piece rect/g) > 0)
})

test('with reduced motion nothing animates: only a still row of emojis', () => {
  const html = render(true)
  assert.match(html, /confetti-static/)
  assert.equal(count(html, /confetti-piece/g), 0)
  assert.ok(html.includes('🎉') && html.includes('🥳'))
})
