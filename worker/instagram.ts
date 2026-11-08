import type { Env } from './index'
import { describeResolution, redactDetail, resolutionFailureMessage, resolveInstagramAccount } from './instagramAccount'
import {
  buildAuthorizeUrl,
  cleanAuthorizationCode,
  describeTokenError,
  INSTAGRAM_GRAPH_ROOT,
  INSTAGRAM_TOKEN_URL,
  parseLongLivedToken,
  parseShortLivedToken,
} from './instagramLogin'

const GRAPH_ROOT = 'https://graph.facebook.com'
const OAUTH_ROOT = 'https://www.facebook.com/v27.0/dialog/oauth'
const SESSION_COOKIE = 'tear_ig_session'
const STATE_COOKIE = 'tear_ig_state'

interface InstagramSession {
  accessToken: string
  accountId: string
  username: string
  expiresAt: number
  // Sessions created before the Instagram Login mode existed have no mode and are Facebook sessions.
  mode?: 'instagram' | 'facebook'
}

interface MetaError {
  error?: { message?: string; type?: string; code?: number }
}

interface MetaToken {
  access_token?: string
  token_type?: string
  expires_in?: number
  user_id?: string | number
}

interface InstagramAccount {
  user_id?: string | number
  id?: string | number
  username?: string
}

interface InstagramMedia {
  id: string
  permalink?: string
}

interface InstagramComment {
  id: string
  username?: string
  text?: string
}

interface MetaPage<T> {
  data?: T[]
  paging?: { next?: string }
}

// Never answer a provider failure with 502/504: Cloudflare replaces those origin responses with its own error page, so the app would never see the message.
function responseError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status })
}

function cookieValue(request: Request, name: string): string | undefined {
  return request.headers.get('Cookie')?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1)
}

function cookie(name: string, value: string, request: Request, maxAge: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${name}=${value}; Path=/api/instagram; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function encryptionKey(env: Env): Promise<CryptoKey> {
  const value = env.INSTAGRAM_SESSION_KEY
  if (!value || !/^[\da-fA-F]{64}$/.test(value)) {
    throw new Error('INSTAGRAM_SESSION_KEY must be 64 hexadecimal characters.')
  }
  const bytes = Uint8Array.from(value.match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16))
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encryptSession(session: InstagramSession, env: Env): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(session))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(env), plaintext)
  const combined = new Uint8Array(iv.length + encrypted.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(encrypted), iv.length)
  return base64UrlEncode(combined)
}

async function decryptSession(value: string, env: Env): Promise<InstagramSession | null> {
  try {
    const packed = base64UrlDecode(value)
    const iv = packed.slice(0, 12)
    const encrypted = packed.slice(12)
    if (iv.length !== 12 || encrypted.length < 17) return null
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await encryptionKey(env), encrypted)
    const session = JSON.parse(new TextDecoder().decode(plaintext)) as InstagramSession
    return session.accessToken && session.accountId && session.expiresAt > Date.now() ? session : null
  } catch {
    return null
  }
}

function redirectUri(request: Request, env: Env): string {
  return env.INSTAGRAM_REDIRECT_URI || new URL('/api/instagram/callback', request.url).toString()
}

// "instagram" = Instagram API with Instagram Login (needs INSTAGRAM_LOGIN_APP_ID/SECRET). Otherwise Facebook Login for Business.
function loginMode(env: Env): 'instagram' | 'facebook' {
  return env.INSTAGRAM_LOGIN_APP_ID && env.INSTAGRAM_LOGIN_APP_SECRET ? 'instagram' : 'facebook'
}

function graphApiUrl(path: string, env: Env, root = GRAPH_ROOT): URL {
  const version = env.INSTAGRAM_GRAPH_VERSION || 'v27.0'
  if (!/^v\d+\.0$/.test(version)) throw new Error('INSTAGRAM_GRAPH_VERSION must look like v27.0.')
  return new URL(`${root}/${version}/${path.replace(/^\//, '')}`)
}

function popupResponse(request: Request, result: 'connected' | 'error', message = ''): Response {
  const origin = JSON.stringify(new URL(request.url).origin)
  const payload = JSON.stringify({ type: 'tear-instagram-oauth', result, message })
  const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // On errors the window stays open and shows the reason, so it can be read even if the opener misses the message.
  const body = result === 'connected'
    ? '<p>Cuenta conectada. Esta ventana se cerrará.</p>'
    : `<p>No se pudo conectar Instagram. Volvé a TEAR e intentá de nuevo.</p><pre style="white-space:pre-wrap;font:13px/1.4 ui-monospace,monospace">${escaped}</pre>`
  const closeScript = result === 'connected' ? 'window.close()' : ''
  const html = `<!doctype html><meta charset="utf-8"><title>Instagram · TEAR</title>${body}<script>if(window.opener){window.opener.postMessage(${payload},${origin});${closeScript}}</script>`
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}

// Last callback outcome, kept in memory only and readable from this machine (see /api/instagram/debug-last). Messages are already redacted.
let lastCallback: { at: string; result: string; status: number; message: string } | null = null

async function popupResult(request: Request, result: 'connected' | 'error', message: string, status = 200, cookies: string[] = []): Promise<Response> {
  if (new URL(request.url).pathname === '/api/instagram/callback') lastCallback = { at: new Date().toISOString(), result, status, message }
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
  for (const value of cookies) headers.append('Set-Cookie', value)
  return new Response(await popupResponse(request, result, message).text(), { status, headers })
}

async function readSession(request: Request, env: Env): Promise<InstagramSession | null> {
  const value = cookieValue(request, SESSION_COOKIE)
  return value ? decryptSession(value, env) : null
}

async function graphJson<T>(url: URL): Promise<T> {
  if (url.origin !== GRAPH_ROOT && url.origin !== INSTAGRAM_GRAPH_ROOT) throw new Error('Instagram returned an invalid pagination URL.')
  const response = await fetch(url)
  const body = await response.json() as T & MetaError
  if (!response.ok || body.error) {
    const meta = body.error
    throw new Error(meta?.message || 'Instagram API request failed.')
  }
  return body
}

async function graphRequest(path: string, params: Record<string, string>, env: Env): Promise<unknown> {
  const url = graphApiUrl(path, env)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return graphJson<unknown>(url)
}

function normalizeInstagramPostUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (!['instagram.com', 'www.instagram.com'].includes(url.hostname)) return null
    const match = url.pathname.match(/^\/(p|reel|tv)\/([^/]+)/)
    return match ? `/${match[1]}/${match[2]}/` : null
  } catch {
    return null
  }
}

export interface ImportProgress {
  stage: 'search' | 'comments'
  count: number
}

const MAX_MEDIA_PAGES = 20
const MAX_COMMENT_PAGES = 100

async function fetchPostComments(
  session: InstagramSession,
  postUrl: string,
  env: Env,
  onProgress?: (progress: ImportProgress) => void,
): Promise<{ comments: InstagramComment[]; username: string; permalink: string; truncated: boolean }> {
  const target = normalizeInstagramPostUrl(postUrl)
  if (!target) throw new Error('Ingresá un enlace válido de una publicación o reel de Instagram.')

  const root = session.mode === 'instagram' ? INSTAGRAM_GRAPH_ROOT : GRAPH_ROOT
  const mediaUrl = graphApiUrl(`/${session.accountId}/media`, env, root)
  mediaUrl.searchParams.set('fields', 'id,permalink')
  mediaUrl.searchParams.set('limit', '100')
  mediaUrl.searchParams.set('access_token', session.accessToken)
  let matchingMedia: InstagramMedia | undefined
  let pages = 0
  let next: string | undefined = mediaUrl.toString()

  while (next && pages < MAX_MEDIA_PAGES && !matchingMedia) {
    const page: MetaPage<InstagramMedia> = await graphJson<MetaPage<InstagramMedia>>(new URL(next))
    matchingMedia = page.data?.find((item) => normalizeInstagramPostUrl(item.permalink || '') === target)
    next = page.paging?.next
    pages += 1
    onProgress?.({ stage: 'search', count: pages })
  }
  if (!matchingMedia) throw new Error('No encontramos esa publicación entre las publicaciones accesibles de la cuenta conectada.')

  const comments: InstagramComment[] = []
  let commentsUrl: string | undefined
  const firstUrl = graphApiUrl(`/${encodeURIComponent(matchingMedia.id)}/comments`, env, root)
  firstUrl.searchParams.set('fields', 'id,text,username')
  firstUrl.searchParams.set('limit', '100')
  firstUrl.searchParams.set('access_token', session.accessToken)
  commentsUrl = firstUrl.toString()
  let commentPages = 0
  while (commentsUrl && commentPages < MAX_COMMENT_PAGES) {
    const page: MetaPage<InstagramComment> = await graphJson<MetaPage<InstagramComment>>(new URL(commentsUrl))
    comments.push(...(page.data || []))
    commentsUrl = page.paging?.next
    commentPages += 1
    onProgress?.({ stage: 'comments', count: comments.length })
  }
  // Still a next page after the cap: the post has more comments than were loaded.
  const truncated = Boolean(commentsUrl)

  const accountUrl = graphApiUrl(session.mode === 'instagram' ? '/me' : `/${session.accountId}`, env, root)
  accountUrl.searchParams.set('fields', session.mode === 'instagram' ? 'user_id,username' : 'id,username')
  accountUrl.searchParams.set('access_token', session.accessToken)
  const account = await graphJson<InstagramAccount>(accountUrl)
  return { comments, username: account.username || session.username, permalink: matchingMedia.permalink || postUrl, truncated }
}

// Instagram API with Instagram Login: the token exchange identifies the professional account, no Page or portfolio involved.
async function completeInstagramLogin(request: Request, env: Env, code: string, clearState: string): Promise<Response> {
  try {
    const clientSecret = env.INSTAGRAM_LOGIN_APP_SECRET!
    const exchange = await fetch(INSTAGRAM_TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: env.INSTAGRAM_LOGIN_APP_ID!,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri(request, env),
        code: cleanAuthorizationCode(code),
      }),
    })
    const exchangeBody: unknown = await exchange.json().catch(() => ({}))
    if (!exchange.ok) throw new Error(describeTokenError(exchangeBody))
    const short = parseShortLivedToken(exchangeBody)

    // Prefer the 60-day token; the browser session is still capped below.
    let accessToken = short.accessToken
    let expiresIn = short.expiresIn
    try {
      const longUrl = new URL(`${INSTAGRAM_GRAPH_ROOT}/access_token`)
      longUrl.searchParams.set('grant_type', 'ig_exchange_token')
      longUrl.searchParams.set('client_secret', clientSecret)
      longUrl.searchParams.set('access_token', short.accessToken)
      const long = parseLongLivedToken(await graphJson<unknown>(longUrl))
      if (long) { accessToken = long.accessToken; expiresIn = long.expiresIn }
    } catch (error) {
      console.error('Instagram long-lived token exchange failed:', redactDetail(error instanceof Error ? error.message : 'unknown error'))
    }

    const meUrl = graphApiUrl('/me', env, INSTAGRAM_GRAPH_ROOT)
    meUrl.searchParams.set('fields', 'user_id,username')
    meUrl.searchParams.set('access_token', accessToken)
    const me = await graphJson<InstagramAccount>(meUrl)
    // `/me` returns the id as a string; the exchange returns it as a number that JavaScript rounds.
    const accountId = String(me.user_id ?? short.userId)
    if (!accountId || accountId === 'undefined') throw new Error('Instagram no devolvió el identificador de la cuenta.')
    console.info('Instagram Login: account connected as', me.username || '(sin username)')

    const sessionMaxAge = Math.min(expiresIn, 86400)
    const session = await encryptSession({ accessToken, accountId, username: me.username || 'Instagram', expiresAt: Date.now() + sessionMaxAge * 1000, mode: 'instagram' }, env)
    return popupResult(request, 'connected', '', 200, [cookie(SESSION_COOKIE, session, request, sessionMaxAge), clearState])
  } catch (error) {
    const safeDetail = redactDetail(error instanceof Error ? error.message : 'Unknown error')
    console.error('Instagram Login callback failed:', safeDetail)
    return popupResult(request, 'error', `Instagram rechazó el inicio de sesión: ${safeDetail}`, 424, [clearState])
  }
}

export async function handleInstagramRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const method = request.method.toUpperCase()

  if (url.pathname === '/api/instagram/connect' && method === 'GET') {
    const mode = loginMode(env)
    if (mode === 'facebook' && (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET)) return popupResult(request, 'error', 'Falta configurar la app de Instagram en .dev.vars.', 503)
    try { await encryptionKey(env) } catch { return popupResult(request, 'error', 'Configurá INSTAGRAM_SESSION_KEY en .dev.vars antes de conectar.', 503) }
    if (mode === 'facebook' && !env.INSTAGRAM_CONFIG_ID) return popupResult(request, 'error', 'Falta configurar INSTAGRAM_CONFIG_ID.', 503)
    // Meta only accepts HTTPS callbacks; opening the app from 127.0.0.1 would end in Meta's generic "insecure connection" page.
    const callback = redirectUri(request, env)
    let callbackProtocol = ''
    try { callbackProtocol = new URL(callback).protocol } catch { /* Reported below. */ }
    if (callbackProtocol !== 'https:') {
      return popupResult(request, 'error', 'Meta exige un callback HTTPS. Abrí la app desde la URL https del túnel (no desde 127.0.0.1) o configurá INSTAGRAM_REDIRECT_URI.', 400)
    }
    const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
    let authorize: URL
    if (mode === 'instagram') {
      authorize = buildAuthorizeUrl({ clientId: env.INSTAGRAM_LOGIN_APP_ID!, redirectUri: callback, state })
    } else {
      authorize = new URL(OAUTH_ROOT)
      authorize.searchParams.set('client_id', env.INSTAGRAM_APP_ID!)
      authorize.searchParams.set('redirect_uri', callback)
      authorize.searchParams.set('response_type', 'code')
      authorize.searchParams.set('config_id', env.INSTAGRAM_CONFIG_ID!)
      authorize.searchParams.set('state', state)
    }
    return new Response(null, { status: 302, headers: {
      Location: authorize.toString(),
      'Cache-Control': 'no-store',
      'Set-Cookie': cookie(STATE_COOKIE, state, request, 1800),
    } })
  }

  if (url.pathname === '/api/instagram/callback' && method === 'GET') {
    const stateCookie = cookieValue(request, STATE_COOKIE)
    const state = url.searchParams.get('state')
    const code = url.searchParams.get('code')
    const providerError = url.searchParams.get('error_description') || url.searchParams.get('error')
    const clearState = cookie(STATE_COOKIE, '', request, 0)
    if (providerError) return popupResult(request, 'error', 'Autorización cancelada.', 200, [clearState])
    if (!code) return popupResult(request, 'error', 'Meta no devolvió el código de autorización.', 400, [clearState])
    if (!stateCookie) {
      return popupResult(request, 'error', 'No llegó la cookie de seguridad del login: venció (30 min), se abrió otra ventana de login o se recargó esta página. Cerrá esta ventana y tocá "Conectar Instagram" una sola vez.', 400, [clearState])
    }
    if (!state || state !== stateCookie) {
      return popupResult(request, 'error', 'Hay otro login de Instagram en curso: el estado no coincide. Cerrá las otras ventanas de login e intentá de nuevo.', 400, [clearState])
    }
    if (loginMode(env) === 'instagram') return completeInstagramLogin(request, env, code, clearState)
    if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET) return popupResult(request, 'error', 'Falta configurar la app de Instagram en .dev.vars.', 503, [clearState])
    try {
      const tokenUrl = graphApiUrl('/oauth/access_token', env)
      tokenUrl.searchParams.set('client_id', env.INSTAGRAM_APP_ID)
      tokenUrl.searchParams.set('client_secret', env.INSTAGRAM_APP_SECRET)
      tokenUrl.searchParams.set('redirect_uri', redirectUri(request, env))
      tokenUrl.searchParams.set('code', code)
      const token = await graphJson<MetaToken>(tokenUrl)
      if (!token.access_token) throw new Error('Meta no devolvió un token de acceso.')
      const resolution = await resolveInstagramAccount({
        graph: (path, params) => graphRequest(path, params, env),
        accessToken: token.access_token,
        appToken: `${env.INSTAGRAM_APP_ID}|${env.INSTAGRAM_APP_SECRET}`,
        tokenUserId: token.user_id,
      })
      // Strategy report only: counts and notes, never tokens.
      console.info('Instagram account resolution:', describeResolution(resolution))
      const account = resolution.account
      if (!account) {
        return popupResult(request, 'error', resolutionFailureMessage(resolution), 422, [clearState])
      }
      // Limit the browser session even when the provider token has no expiry.
      const sessionMaxAge = Math.min(token.expires_in && token.expires_in > 0 ? token.expires_in : 86400, 86400)
      const expiresAt = Date.now() + sessionMaxAge * 1000
      const session = await encryptSession({ accessToken: token.access_token, accountId: account.id, username: account.username || 'Instagram', expiresAt }, env)
      return popupResult(request, 'connected', '', 200, [cookie(SESSION_COOKIE, session, request, sessionMaxAge), clearState])
    } catch (error) {
      const safeDetail = redactDetail(error instanceof Error ? error.message : 'Unknown error')
      console.error('Instagram OAuth callback failed:', safeDetail)
      return popupResult(request, 'error', `Meta rechazó el intercambio OAuth: ${safeDetail}`, 424, [clearState])
    }
  }

  if (url.pathname === '/api/instagram/debug-last' && method === 'GET') {
    // Local only: through the tunnel the hostname is the public one and this route does not exist.
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return responseError('Ruta de Instagram no encontrada.', 404)
    return Response.json(lastCallback ?? { none: true }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (url.pathname === '/api/instagram/status' && method === 'GET') {
    const session = await readSession(request, env)
    return Response.json({ connected: Boolean(session), username: session?.username || null, expiresAt: session ? new Date(session.expiresAt).toISOString() : null }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (url.pathname === '/api/instagram/disconnect' && method === 'POST') {
    return Response.json({ connected: false }, { headers: { 'Cache-Control': 'no-store', 'Set-Cookie': cookie(SESSION_COOKIE, '', request, 0) } })
  }

  if (url.pathname === '/api/instagram/comments' && method === 'POST') {
    const session = await readSession(request, env)
    if (!session) return responseError('Conectá una cuenta profesional de Instagram primero.', 401)
    let body: { postUrl?: string; stream?: boolean }
    try { body = await request.json() as { postUrl?: string; stream?: boolean } } catch { return responseError('El cuerpo de la solicitud no es válido.') }
    if (!body.postUrl) return responseError('Falta el enlace de la publicación.')
    if (body.stream) {
      // Progress as newline-delimited JSON, so a 7,000-comment import shows a live counter instead of a silent wait.
      if (!normalizeInstagramPostUrl(body.postUrl)) return responseError('Ingresá un enlace válido de una publicación o reel de Instagram.')
      const postUrl = body.postUrl
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
          try {
            const result = await fetchPostComments(session, postUrl, env, (progress) => send({ type: 'progress', ...progress }))
            send({ type: 'done', ...result })
          } catch (error) {
            send({ type: 'error', message: redactDetail(error instanceof Error ? error.message : 'No se pudieron cargar los comentarios.') })
          } finally {
            controller.close()
          }
        },
      })
      return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } })
    }
    try {
      const result = await fetchPostComments(session, body.postUrl, env)
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron cargar los comentarios.'
      return responseError(message, 424)
    }
  }

  return responseError('Ruta de Instagram no encontrada.', 404)
}
