// Run with: npm test  (Node's built-in runner; TypeScript sources are loaded with type stripping).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  describeResolution,
  redactDetail,
  resolutionFailureMessage,
  resolveInstagramAccount,
} from './instagramAccount.ts'

const IG = { id: '1784', username: 'manoconsultora' }

// Builds a fake Graph API from a table of "path" -> response or Error.
function fakeGraph(routes) {
  const calls = []
  const graph = async (path, params) => {
    calls.push({ path, params })
    const route = routes[path]
    if (route === undefined) throw new Error(`(#100) Unsupported get request: ${path}`)
    if (route instanceof Error) throw route
    return typeof route === 'function' ? route(params) : route
  }
  return { graph, calls }
}

const base = { accessToken: 'USER_TOKEN', appToken: 'APPID|APPSECRET' }

test('uses the user_id from the token exchange when it is an Instagram account', async () => {
  const { graph } = fakeGraph({ '/1784': IG, '/debug_token': { data: {} }, '/me/accounts': { data: [] }, '/me/assigned_instagram_accounts': { data: [] } })
  const result = await resolveInstagramAccount({ ...base, graph, tokenUserId: '1784' })
  assert.deepEqual(result.account, IG)
})

test('ignores a Facebook user id: it has no username so it is not an Instagram account', async () => {
  const { graph } = fakeGraph({ '/999': { id: '999' }, '/debug_token': { data: {} }, '/me/accounts': { data: [] }, '/me/assigned_instagram_accounts': { data: [] } })
  const result = await resolveInstagramAccount({ ...base, graph, tokenUserId: 999 })
  assert.equal(result.account, undefined)
  assert.equal(result.candidates.length, 0)
})

test('finds the account the user selected through granular_scopes target_ids', async () => {
  const { graph, calls } = fakeGraph({
    '/debug_token': { data: { granular_scopes: [
      { scope: 'business_management', target_ids: ['555'] },
      { scope: 'instagram_basic', target_ids: ['1784'] },
      { scope: 'instagram_manage_comments', target_ids: ['1784'] },
    ] } },
    '/1784': IG,
    '/me/accounts': { data: [] },
    '/me/assigned_instagram_accounts': { data: [] },
  })
  const result = await resolveInstagramAccount({ ...base, graph })
  assert.deepEqual(result.account, IG)
  // The debug call must use the app token to inspect the user token.
  const debug = calls.find((call) => call.path === '/debug_token')
  assert.equal(debug.params.input_token, 'USER_TOKEN')
  assert.equal(debug.params.access_token, 'APPID|APPSECRET')
  // Business ids are not Instagram scopes and must not be looked up.
  assert.equal(calls.some((call) => call.path === '/555'), false)
})

test('finds the Instagram account linked to a Page through /me/accounts', async () => {
  const { graph } = fakeGraph({
    '/debug_token': { data: { granular_scopes: [] } },
    '/me/accounts': { data: [{ id: 'p1', name: 'Sin Instagram' }, { id: 'p2', name: 'MANO', instagram_business_account: IG }] },
    '/me/assigned_instagram_accounts': { data: [] },
  })
  const result = await resolveInstagramAccount({ ...base, graph })
  assert.deepEqual(result.account, IG)
})

test('accepts the assigned account list for system user tokens', async () => {
  const { graph } = fakeGraph({
    '/debug_token': { data: {} },
    '/me/accounts': { data: [] },
    '/me/assigned_instagram_accounts': { data: [IG] },
  })
  const result = await resolveInstagramAccount({ ...base, graph })
  assert.deepEqual(result.account, IG)
})

test('the same account reported by several strategies counts once', async () => {
  const { graph } = fakeGraph({
    '/debug_token': { data: { granular_scopes: [{ scope: 'instagram_basic', target_ids: ['1784'] }] } },
    '/1784': IG,
    '/me/accounts': { data: [{ id: 'p2', instagram_business_account: IG }] },
    '/me/assigned_instagram_accounts': { data: [IG] },
  })
  const result = await resolveInstagramAccount({ ...base, graph })
  assert.equal(result.candidates.length, 1)
  assert.deepEqual(result.account, IG)
})

test('with several accounts, the granular scopes decide which one the user picked', async () => {
  const other = { id: '2222', username: 'otra_cuenta' }
  const { graph } = fakeGraph({
    '/debug_token': { data: { granular_scopes: [{ scope: 'instagram_basic', target_ids: ['1784'] }] } },
    '/1784': IG,
    '/me/accounts': { data: [{ id: 'p', instagram_business_account: other }] },
    '/me/assigned_instagram_accounts': { data: [IG, other] },
  })
  const result = await resolveInstagramAccount({ ...base, graph })
  assert.deepEqual(result.account, IG)
})

test('with several accounts and no way to choose, it refuses and names them', async () => {
  const other = { id: '2222', username: 'otra_cuenta' }
  const { graph } = fakeGraph({
    '/debug_token': { data: {} },
    '/me/accounts': { data: [] },
    '/me/assigned_instagram_accounts': { data: [IG, other] },
  })
  const result = await resolveInstagramAccount({ ...base, graph })
  assert.equal(result.account, undefined)
  const message = resolutionFailureMessage(result)
  assert.match(message, /2 cuentas/)
  assert.match(message, /@manoconsultora/)
  assert.match(message, /@otra_cuenta/)
})

test('zero accounts: the message states facts and does not blame the user selection', async () => {
  const { graph } = fakeGraph({
    '/debug_token': { data: { granular_scopes: [{ scope: 'instagram_basic' }] } },
    '/me/accounts': { data: [{ id: 'p1', name: 'Página sin Instagram' }] },
    '/me/assigned_instagram_accounts': { data: [] },
  })
  const result = await resolveInstagramAccount({ ...base, graph })
  const message = resolutionFailureMessage(result)
  assert.equal(result.account, undefined)
  assert.match(message, /no devolvió ninguna cuenta/)
  assert.doesNotMatch(message, /Seleccioná exactamente/)
  assert.match(message, /me_accounts=ok\(0; páginas: 1\)/)
})

test('a failing strategy does not stop the others and its error is reported without secrets', async () => {
  const longToken = 'EAAB'.padEnd(120, 'x')
  const { graph } = fakeGraph({
    '/debug_token': new Error(`Invalid OAuth access token ${longToken} at ?access_token=SECRET123&x=1`),
    '/me/accounts': { data: [{ id: 'p2', instagram_business_account: IG }] },
    '/me/assigned_instagram_accounts': new Error('(#200) Requires business_management permission'),
  })
  const result = await resolveInstagramAccount({ ...base, graph })
  assert.deepEqual(result.account, IG)
  const text = describeResolution(result)
  assert.match(text, /granular_scopes=error/)
  assert.match(text, /assigned_instagram_accounts=error/)
  assert.doesNotMatch(text, /SECRET123/)
  assert.doesNotMatch(text, /xxxxxxxxxx/)
})

test('redactDetail hides query secrets and long token-like strings and caps the length', () => {
  const redacted = redactDetail(`failed https://x/y?client_secret=abc&code=def ${'A'.repeat(80)} ${'z'.repeat(300)}`)
  assert.doesNotMatch(redacted, /abc|def|AAAAAAAA/)
  assert.ok(redacted.length <= 140)
})
