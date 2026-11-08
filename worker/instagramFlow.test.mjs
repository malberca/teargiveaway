// End-to-end of the Instagram Login mode with a fake Instagram: connect -> callback -> status -> comments.
// The worker is bundled with esbuild (already a Vite dependency) so its TypeScript imports resolve as in the real build.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const TUNNEL = 'https://fake-tunnel.trycloudflare.com'
const ENV = {
  INSTAGRAM_LOGIN_APP_ID: '999000111',
  INSTAGRAM_LOGIN_APP_SECRET: 'fake-login-secret',
  INSTAGRAM_SESSION_KEY: 'a'.repeat(64),
  ASSETS: { fetch: async () => new Response('assets') },
}
// 17-digit ids: JSON numbers would be rounded, strings are not.
const IG_ID = '17841400000000001'

let tmp
let handle
const realFetch = globalThis.fetch

before(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'ig-flow-'))
  const outfile = join(tmp, 'worker.mjs')
  await build({ entryPoints: ['worker/index.ts'], bundle: true, format: 'esm', platform: 'neutral', outfile, logLevel: 'silent' })
  handle = (await import(pathToFileURL(outfile).href)).default.fetch
})

after(async () => {
  globalThis.fetch = realFetch
  await rm(tmp, { recursive: true, force: true })
})

function cookiesFrom(response) {
  const jar = {}
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';')
    const index = pair.indexOf('=')
    jar[pair.slice(0, index)] = pair.slice(index + 1)
  }
  return jar
}

const cookieHeader = (jar) => Object.entries(jar).map(([key, value]) => `${key}=${value}`).join('; ')

// Fake Instagram: records every call so the test can assert what the worker sent.
function installFakeInstagram(calls, options = {}) {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input.toString())
    calls.push({ method: init.method ?? 'GET', url, body: init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null })
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.origin === 'https://api.instagram.com' && url.pathname === '/oauth/access_token') {
      if (options.rejectCode) return json({ error_type: 'OAuthException', code: 400, error_message: 'Invalid authorization code' }, 400)
      return json({ data: [{ access_token: 'SHORT_TOKEN', user_id: 17841400000000001, permissions: 'instagram_business_basic' }] })
    }
    if (url.origin === 'https://graph.instagram.com' && url.pathname === '/access_token') return json({ access_token: 'LONG_TOKEN', token_type: 'bearer', expires_in: 5183944 })
    if (url.origin === 'https://graph.instagram.com' && url.pathname.endsWith('/me')) return json({ user_id: IG_ID, username: 'manoconsultora' })
    if (url.origin === 'https://graph.instagram.com' && url.pathname.endsWith(`/${IG_ID}/media`)) {
      return json({ data: [{ id: 'm1', permalink: 'https://www.instagram.com/p/OTHER/' }, { id: 'm2', permalink: 'https://www.instagram.com/p/ABC123/' }] })
    }
    if (url.origin === 'https://graph.instagram.com' && url.pathname.endsWith('/m2/comments')) {
      return json({ data: [{ id: 'c1', username: 'ana', text: 'quiero ganar' }, { id: 'c2', username: 'beto', text: 'yo también' }] })
    }
    return json({ error: { message: `unexpected call ${url.href}` } }, 404)
  }
}

async function login(calls, options) {
  installFakeInstagram(calls, options)
  const connect = await handle(new Request(`${TUNNEL}/api/instagram/connect`), ENV)
  const jar = cookiesFrom(connect)
  const authorize = new URL(connect.headers.get('Location'))
  const callback = await handle(new Request(`${TUNNEL}/api/instagram/callback?state=${authorize.searchParams.get('state')}&code=THE_CODE`, { headers: { Cookie: cookieHeader(jar) } }), ENV)
  return { connect, authorize, callback }
}

test('connect redirects to Instagram with the Instagram app id, scopes and an https callback', async () => {
  const calls = []
  installFakeInstagram(calls)
  const connect = await handle(new Request(`${TUNNEL}/api/instagram/connect`), ENV)
  assert.equal(connect.status, 302)
  const authorize = new URL(connect.headers.get('Location'))
  assert.equal(authorize.origin + authorize.pathname, 'https://www.instagram.com/oauth/authorize')
  assert.equal(authorize.searchParams.get('client_id'), ENV.INSTAGRAM_LOGIN_APP_ID)
  assert.equal(authorize.searchParams.get('redirect_uri'), `${TUNNEL}/api/instagram/callback`)
  assert.equal(authorize.searchParams.get('scope'), 'instagram_business_basic,instagram_business_manage_comments')
  assert.equal(authorize.searchParams.has('config_id'), false)
  assert.match(connect.headers.get('Set-Cookie'), /tear_ig_state=.*HttpOnly.*Secure/)
})

test('a full login creates the session, identifies the account by the string id and never leaks the token', async () => {
  const calls = []
  const { callback } = await login(calls)
  assert.equal(callback.status, 200)
  const html = await callback.text()
  assert.match(html, /Cuenta conectada/)
  assert.doesNotMatch(html, /SHORT_TOKEN|LONG_TOKEN|fake-login-secret/)

  const exchange = calls.find((call) => call.url.pathname === '/oauth/access_token')
  assert.equal(exchange.method, 'POST')
  assert.equal(exchange.body.grant_type, 'authorization_code')
  assert.equal(exchange.body.code, 'THE_CODE')
  assert.equal(exchange.body.redirect_uri, `${TUNNEL}/api/instagram/callback`)
  assert.equal(exchange.body.client_id, ENV.INSTAGRAM_LOGIN_APP_ID)

  const long = calls.find((call) => call.url.pathname === '/access_token')
  assert.equal(long.url.searchParams.get('grant_type'), 'ig_exchange_token')
  const me = calls.find((call) => call.url.pathname.endsWith('/me'))
  assert.equal(me.url.searchParams.get('access_token'), 'LONG_TOKEN')

  const cookies = cookiesFrom(callback)
  assert.ok(cookies.tear_ig_session, 'session cookie must be set')
  assert.doesNotMatch(cookies.tear_ig_session, /LONG_TOKEN/, 'the cookie must be encrypted')
  assert.equal(cookies.tear_ig_state, '', 'the state cookie must be cleared')
})

test('status shows the connected account and comments are read through graph.instagram.com', async () => {
  const calls = []
  const { callback } = await login(calls)
  const jar = cookiesFrom(callback)

  const status = await (await handle(new Request(`${TUNNEL}/api/instagram/status`, { headers: { Cookie: cookieHeader(jar) } }), ENV)).json()
  assert.equal(status.connected, true)
  assert.equal(status.username, 'manoconsultora')

  const response = await handle(new Request(`${TUNNEL}/api/instagram/comments`, {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar), 'Content-Type': 'application/json' },
    body: JSON.stringify({ postUrl: 'https://www.instagram.com/p/ABC123/?img_index=1' }),
  }), ENV)
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.deepEqual(result.comments.map((comment) => comment.username), ['ana', 'beto'])
  assert.equal(result.username, 'manoconsultora')
  const commentsCall = calls.find((call) => call.url.pathname.endsWith('/m2/comments'))
  assert.equal(commentsCall.url.origin, 'https://graph.instagram.com')
  assert.equal(commentsCall.url.searchParams.get('access_token'), 'LONG_TOKEN')
})

test('a rejected code shows Instagram\'s own reason and answers 424, which Cloudflare does not replace', async () => {
  const calls = []
  const { callback } = await login(calls, { rejectCode: true })
  assert.equal(callback.status, 424)
  const html = await callback.text()
  assert.match(html, /Invalid authorization code/)
  assert.equal(Boolean(cookiesFrom(callback).tear_ig_session), false)
})

test('the callback refuses a missing or different state cookie with a specific message', async () => {
  const calls = []
  installFakeInstagram(calls)
  const noCookie = await handle(new Request(`${TUNNEL}/api/instagram/callback?state=x&code=c`), ENV)
  assert.equal(noCookie.status, 400)
  assert.match(await noCookie.text(), /No llegó la cookie/)
  const wrong = await handle(new Request(`${TUNNEL}/api/instagram/callback?state=x&code=c`, { headers: { Cookie: 'tear_ig_state=y' } }), ENV)
  assert.match(await wrong.text(), /el estado no coincide/)
  assert.equal(calls.length, 0, 'no call to Instagram without a valid state')
})

test('opening the app from 127.0.0.1 is refused before reaching Instagram', async () => {
  const calls = []
  installFakeInstagram(calls)
  const response = await handle(new Request('http://127.0.0.1:7001/api/instagram/connect'), ENV)
  assert.equal(response.status, 400)
  assert.match(await response.text(), /callback HTTPS/)
})

test('without the Instagram Login credentials the Facebook mode is still used', async () => {
  const response = await handle(new Request(`${TUNNEL}/api/instagram/connect`), { ...ENV, INSTAGRAM_LOGIN_APP_ID: undefined, INSTAGRAM_LOGIN_APP_SECRET: undefined, INSTAGRAM_APP_ID: '1', INSTAGRAM_APP_SECRET: 's', INSTAGRAM_CONFIG_ID: 'cfg' })
  assert.equal(response.status, 302)
  const location = new URL(response.headers.get('Location'))
  assert.equal(location.hostname, 'www.facebook.com')
  assert.equal(location.searchParams.get('config_id'), 'cfg')
})

// A fake Instagram whose comments come in several pages, to exercise the progress stream.
function installPagedInstagram({ pages, endless = false }) {
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input.toString())
    if (url.pathname.endsWith('/me')) return json({ user_id: IG_ID, username: 'manoconsultora' })
    if (url.pathname.endsWith(`/${IG_ID}/media`)) return json({ data: [{ id: 'm2', permalink: 'https://www.instagram.com/p/ABC123/' }] })
    if (url.pathname.endsWith('/m2/comments')) {
      const page = Number(url.searchParams.get('page') ?? 1)
      const next = endless || page < pages
        ? `https://graph.instagram.com/v27.0/m2/comments?page=${page + 1}&access_token=${url.searchParams.get('access_token')}`
        : undefined
      return json({ data: [{ id: `c${page}`, username: `u${page}`, text: 'hola' }], ...(next ? { paging: { next } } : {}) })
    }
    return new Response(JSON.stringify({ error: { message: `unexpected call ${url.href}` } }), { status: 404 })
  }
}

async function streamComments(jar, postUrl) {
  return handle(new Request(`${TUNNEL}/api/instagram/comments`, {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar), 'Content-Type': 'application/json' },
    body: JSON.stringify({ postUrl, stream: true }),
  }), ENV)
}

const eventsOf = async (response) => (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line))

test('stream mode reports the search and a live comment counter, then the full result', async () => {
  const { callback } = await login([])
  const jar = cookiesFrom(callback)
  installPagedInstagram({ pages: 3 })
  const response = await streamComments(jar, 'https://www.instagram.com/p/ABC123/')
  assert.equal(response.status, 200)
  assert.match(response.headers.get('Content-Type'), /application\/x-ndjson/)
  const events = await eventsOf(response)
  assert.deepEqual(events.filter((event) => event.type === 'progress').map((event) => [event.stage, event.count]), [['search', 1], ['comments', 1], ['comments', 2], ['comments', 3]])
  const done = events.at(-1)
  assert.equal(done.type, 'done')
  assert.equal(done.comments.length, 3)
  assert.equal(done.truncated, false)
  assert.equal(done.username, 'manoconsultora')
})

test('a post with more comments than the cap is flagged as truncated', async () => {
  const { callback } = await login([])
  const jar = cookiesFrom(callback)
  installPagedInstagram({ pages: 0, endless: true })
  const events = await eventsOf(await streamComments(jar, 'https://www.instagram.com/p/ABC123/'))
  const done = events.at(-1)
  assert.equal(done.type, 'done')
  assert.equal(done.comments.length, 100)
  assert.equal(done.truncated, true)
})

test('stream mode rejects an invalid post link before streaming anything', async () => {
  const { callback } = await login([])
  const jar = cookiesFrom(callback)
  const response = await streamComments(jar, 'https://example.com/no-es-instagram')
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /enlace válido/)
})

test('a failure in the middle of the stream arrives as an error event the app can show', async () => {
  const { callback } = await login([])
  const jar = cookiesFrom(callback)
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input.toString())
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.pathname.endsWith(`/${IG_ID}/media`)) return json({ data: [{ id: 'm2', permalink: 'https://www.instagram.com/p/ABC123/' }] })
    return json({ error: { message: '(#4) Application request limit reached' } }, 400)
  }
  const events = await eventsOf(await streamComments(jar, 'https://www.instagram.com/p/ABC123/'))
  const last = events.at(-1)
  assert.equal(last.type, 'error')
  assert.match(last.message, /request limit reached/)
})
