import type { Env } from './index'

const GRAPH_ROOT = 'https://graph.facebook.com'
const OAUTH_ROOT = 'https://www.facebook.com/v27.0/dialog/oauth'
const SESSION_COOKIE = 'tear_ig_session'
const STATE_COOKIE = 'tear_ig_state'

interface InstagramSession {
  accessToken: string
  accountId: string
  username: string
  expiresAt: number
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

function graphApiUrl(path: string, env: Env): URL {
  const version = env.INSTAGRAM_GRAPH_VERSION || 'v27.0'
  if (!/^v\d+\.0$/.test(version)) throw new Error('INSTAGRAM_GRAPH_VERSION must look like v27.0.')
  return new URL(`${GRAPH_ROOT}/${version}/${path.replace(/^\//, '')}`)
}

function popupResponse(request: Request, result: 'connected' | 'error', message = ''): Response {
  const origin = JSON.stringify(new URL(request.url).origin)
  const payload = JSON.stringify({ type: 'tear-instagram-oauth', result, message })
  const html = `<!doctype html><meta charset="utf-8"><title>Instagram · TEAR</title><p>${result === 'connected' ? 'Cuenta conectada. Esta ventana se cerrará.' : 'No se pudo conectar Instagram. Volvé a TEAR e intentá de nuevo.'}</p><script>if(window.opener){window.opener.postMessage(${payload},${origin});window.close()}</script>`
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}

async function popupResult(request: Request, result: 'connected' | 'error', message: string, status = 200, cookies: string[] = []): Promise<Response> {
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
  for (const value of cookies) headers.append('Set-Cookie', value)
  return new Response(await popupResponse(request, result, message).text(), { status, headers })
}

async function readSession(request: Request, env: Env): Promise<InstagramSession | null> {
  const value = cookieValue(request, SESSION_COOKIE)
  return value ? decryptSession(value, env) : null
}

async function graphJson<T>(url: URL): Promise<T> {
  if (url.origin !== GRAPH_ROOT) throw new Error('Instagram returned an invalid pagination URL.')
  const response = await fetch(url)
  const body = await response.json() as T & MetaError
  if (!response.ok || body.error) {
    const meta = body.error
    throw new Error(meta?.message || 'Instagram API request failed.')
  }
  return body
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

async function fetchPostComments(session: InstagramSession, postUrl: string, env: Env): Promise<{ comments: InstagramComment[]; username: string; permalink: string }> {
  const target = normalizeInstagramPostUrl(postUrl)
  if (!target) throw new Error('Ingresá un enlace válido de una publicación o reel de Instagram.')

  const mediaUrl = graphApiUrl(`/${session.accountId}/media`, env)
  mediaUrl.searchParams.set('fields', 'id,permalink')
  mediaUrl.searchParams.set('limit', '100')
  mediaUrl.searchParams.set('access_token', session.accessToken)
  let matchingMedia: InstagramMedia | undefined
  let pages = 0
  let next: string | undefined = mediaUrl.toString()

  while (next && pages < 20 && !matchingMedia) {
    const page: MetaPage<InstagramMedia> = await graphJson<MetaPage<InstagramMedia>>(new URL(next))
    matchingMedia = page.data?.find((item) => normalizeInstagramPostUrl(item.permalink || '') === target)
    next = page.paging?.next
    pages += 1
  }
  if (!matchingMedia) throw new Error('No encontramos esa publicación entre las publicaciones accesibles de la cuenta conectada.')

  const comments: InstagramComment[] = []
  let commentsUrl: string | undefined
  const firstUrl = graphApiUrl(`/${encodeURIComponent(matchingMedia.id)}/comments`, env)
  firstUrl.searchParams.set('fields', 'id,text,username')
  firstUrl.searchParams.set('limit', '100')
  firstUrl.searchParams.set('access_token', session.accessToken)
  commentsUrl = firstUrl.toString()
  let commentPages = 0
  while (commentsUrl && commentPages < 100) {
    const page: MetaPage<InstagramComment> = await graphJson<MetaPage<InstagramComment>>(new URL(commentsUrl))
    comments.push(...(page.data || []))
    commentsUrl = page.paging?.next
    commentPages += 1
  }

  const accountUrl = graphApiUrl(`/${session.accountId}`, env)
  accountUrl.searchParams.set('fields', 'id,username')
  accountUrl.searchParams.set('access_token', session.accessToken)
  const account = await graphJson<InstagramAccount>(accountUrl)
  return { comments, username: account.username || session.username, permalink: matchingMedia.permalink || postUrl }
}

export async function handleInstagramRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const method = request.method.toUpperCase()

  if (url.pathname === '/api/instagram/connect' && method === 'GET') {
    if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET) return popupResult(request, 'error', 'Falta configurar la app de Instagram en .dev.vars.', 503)
    try { await encryptionKey(env) } catch { return popupResult(request, 'error', 'Configurá INSTAGRAM_SESSION_KEY en .dev.vars antes de conectar.', 503) }
    if (!env.INSTAGRAM_CONFIG_ID) return popupResult(request, 'error', 'Falta configurar INSTAGRAM_CONFIG_ID.', 503)
    const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
    const authorize = new URL(OAUTH_ROOT)
    authorize.searchParams.set('client_id', env.INSTAGRAM_APP_ID)
    authorize.searchParams.set('redirect_uri', redirectUri(request, env))
    authorize.searchParams.set('response_type', 'code')
    authorize.searchParams.set('config_id', env.INSTAGRAM_CONFIG_ID)
    authorize.searchParams.set('state', state)
    return new Response(null, { status: 302, headers: {
      Location: authorize.toString(),
      'Cache-Control': 'no-store',
      'Set-Cookie': cookie(STATE_COOKIE, state, request, 600),
    } })
  }

  if (url.pathname === '/api/instagram/callback' && method === 'GET') {
    const stateCookie = cookieValue(request, STATE_COOKIE)
    const state = url.searchParams.get('state')
    const code = url.searchParams.get('code')
    const providerError = url.searchParams.get('error_description') || url.searchParams.get('error')
    const clearState = cookie(STATE_COOKIE, '', request, 0)
    if (providerError) return popupResult(request, 'error', 'Autorización cancelada.', 200, [clearState])
    if (!state || !stateCookie || state !== stateCookie || !code) {
      return popupResult(request, 'error', 'La autorización venció.', 400, [clearState])
    }
    if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET) return popupResult(request, 'error', 'Falta configurar la app de Instagram en .dev.vars.', 503, [clearState])
    try {
      const tokenUrl = graphApiUrl('/oauth/access_token', env)
      tokenUrl.searchParams.set('client_id', env.INSTAGRAM_APP_ID)
      tokenUrl.searchParams.set('client_secret', env.INSTAGRAM_APP_SECRET)
      tokenUrl.searchParams.set('redirect_uri', redirectUri(request, env))
      tokenUrl.searchParams.set('code', code)
      const token = await graphJson<MetaToken>(tokenUrl)
      if (!token.access_token) throw new Error('Meta no devolvió un token de acceso.')
      const accountsUrl = graphApiUrl('/me/assigned_instagram_accounts', env)
      accountsUrl.searchParams.set('fields', 'id,username')
      accountsUrl.searchParams.set('access_token', token.access_token)
      const accounts = await graphJson<MetaPage<InstagramAccount>>(accountsUrl)
      if (accounts.data?.length !== 1 || !accounts.data[0].id) {
        throw new Error('Seleccioná exactamente una cuenta de Instagram al autorizar la app.')
      }
      const account = accounts.data[0]
      // Limit the browser session even when the provider token has no expiry.
      const sessionMaxAge = Math.min(token.expires_in && token.expires_in > 0 ? token.expires_in : 86400, 86400)
      const expiresAt = Date.now() + sessionMaxAge * 1000
      const session = await encryptSession({ accessToken: token.access_token, accountId: String(account.id), username: account.username || 'Instagram', expiresAt }, env)
      return popupResult(request, 'connected', '', 200, [cookie(SESSION_COOKIE, session, request, sessionMaxAge), clearState])
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error'
      const safeDetail = detail
        .replace(/([?&](?:access_token|client_secret|code)=)[^&\s]+/gi, '$1[redacted]')
        .replace(/\b[A-Za-z0-9_-]{64,}\b/g, '[redacted]')
      console.error('Instagram OAuth callback failed:', safeDetail)
      return popupResult(request, 'error', 'Falló el intercambio OAuth. Revisá la app de Meta, el callback y los permisos.', 502, [clearState])
    }
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
    let body: { postUrl?: string }
    try { body = await request.json() as { postUrl?: string } } catch { return responseError('El cuerpo de la solicitud no es válido.') }
    if (!body.postUrl) return responseError('Falta el enlace de la publicación.')
    try {
      const result = await fetchPostComments(session, body.postUrl, env)
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron cargar los comentarios.'
      return responseError(message, 502)
    }
  }

  return responseError('Ruta de Instagram no encontrada.', 404)
}
