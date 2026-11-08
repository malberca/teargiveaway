// Pure helpers for "Instagram API with Instagram Login" (Business Login for Instagram).
// Reference: Meta for Developers > Instagram Platform > Instagram API with Instagram Login > Business Login.
// It needs no Facebook Page and no business portfolio: the token exchange identifies the professional account.

export const INSTAGRAM_AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize'
export const INSTAGRAM_TOKEN_URL = 'https://api.instagram.com/oauth/access_token'
export const INSTAGRAM_GRAPH_ROOT = 'https://graph.instagram.com'
// Reading the account's own media and its comments.
export const INSTAGRAM_LOGIN_SCOPES = 'instagram_business_basic,instagram_business_manage_comments'
const SHORT_LIVED_SECONDS = 3600

export function buildAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }): URL {
  const url = new URL(INSTAGRAM_AUTHORIZE_URL)
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', INSTAGRAM_LOGIN_SCOPES)
  url.searchParams.set('state', input.state)
  return url
}

// Instagram appends "#_" to the redirect; it is not part of the code and a fragment never reaches the server,
// but a copied or proxied URL can still carry it.
export function cleanAuthorizationCode(code: string): string {
  return code.trim().replace(/#_?$/, '')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export interface ShortLivedToken {
  accessToken: string
  userId: string
  expiresIn: number
}

// The documented response is a `data` array; the live endpoint has also answered with a flat object. Both are accepted.
export function parseShortLivedToken(body: unknown): ShortLivedToken {
  const root = asRecord(body)
  const first = Array.isArray(root?.data) ? asRecord(root.data[0]) : null
  const record = first ?? root
  const accessToken = typeof record?.access_token === 'string' ? record.access_token : ''
  if (!accessToken) throw new Error('Instagram no devolvió un token de acceso.')
  // user_id arrives as a 17-digit integer that JSON.parse rounds; the caller should prefer the string id from /me.
  const rawId = record?.user_id
  const userId = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : ''
  return { accessToken, userId, expiresIn: SHORT_LIVED_SECONDS }
}

export interface LongLivedToken {
  accessToken: string
  expiresIn: number
}

export function parseLongLivedToken(body: unknown): LongLivedToken | null {
  const record = asRecord(body)
  const accessToken = typeof record?.access_token === 'string' ? record.access_token : ''
  const expiresIn = typeof record?.expires_in === 'number' && record.expires_in > 0 ? record.expires_in : 0
  return accessToken && expiresIn ? { accessToken, expiresIn } : null
}

// Instagram reports token errors as { error_type, code, error_message } and Graph errors as { error: { message } }.
export function describeTokenError(body: unknown): string {
  const record = asRecord(body)
  if (typeof record?.error_message === 'string') return record.error_message
  const nested = asRecord(record?.error)
  if (typeof nested?.message === 'string') return nested.message
  if (typeof record?.error_description === 'string') return record.error_description
  return 'Instagram rechazó el código de autorización.'
}
