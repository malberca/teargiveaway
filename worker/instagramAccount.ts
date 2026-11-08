// Resolves which Instagram professional account Meta authorized for a login.
// With Facebook Login for Business the token exchange does not return an Instagram user_id, and the
// documented ways to find the authorized assets differ by token type. So several documented
// strategies are tried, each one reports what it found, and the result explains itself.

export interface AccountCandidate {
  id: string
  username: string
}

export interface StrategyReport {
  strategy: 'token_user_id' | 'granular_scopes' | 'me_accounts' | 'assigned_instagram_accounts'
  ok: boolean
  found: number
  note?: string
}

export interface AccountResolution {
  account?: AccountCandidate
  candidates: AccountCandidate[]
  reports: StrategyReport[]
}

// `params` carries every query parameter, access_token included, so each call picks its own token.
export type GraphFetch = (path: string, params: Record<string, string>) => Promise<unknown>

export interface ResolveInput {
  graph: GraphFetch
  accessToken: string
  appToken: string
  tokenUserId?: string | number
}

const MAX_TARGET_LOOKUPS = 10

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function toCandidate(value: unknown): AccountCandidate | null {
  const record = asRecord(value)
  if (!record) return null
  const id = typeof record.id === 'string' || typeof record.id === 'number' ? String(record.id) : ''
  const username = typeof record.username === 'string' ? record.username.trim() : ''
  // Only Instagram accounts expose `username`; a Facebook user or Page must not be taken as one.
  return id && username ? { id, username } : null
}

export function redactDetail(detail: string): string {
  return detail
    .replace(/([?&](?:access_token|client_secret|input_token|code)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b[A-Za-z0-9_|-]{40,}\b/g, '[redacted]')
    .slice(0, 140)
}

function errorNote(error: unknown): string {
  return redactDetail(error instanceof Error ? error.message : 'unknown error')
}

export async function resolveInstagramAccount(input: ResolveInput): Promise<AccountResolution> {
  const { graph, accessToken, appToken, tokenUserId } = input
  const found = new Map<string, AccountCandidate>()
  const reports: StrategyReport[] = []
  const targetIds = new Set<string>()

  const lookup = async (id: string): Promise<AccountCandidate | null> => {
    const candidate = toCandidate(await graph(`/${encodeURIComponent(id)}`, { fields: 'id,username', access_token: accessToken }))
    if (candidate) found.set(candidate.id, candidate)
    return candidate
  }

  // 1. Instagram Login style: the token exchange itself returns the account id.
  if (tokenUserId !== undefined && tokenUserId !== '') {
    try {
      const candidate = await lookup(String(tokenUserId))
      reports.push({ strategy: 'token_user_id', ok: true, found: candidate ? 1 : 0, note: candidate ? undefined : 'id sin username de Instagram' })
    } catch (error) {
      reports.push({ strategy: 'token_user_id', ok: false, found: 0, note: errorNote(error) })
    }
  }

  // 2. Facebook Login for Business: the token's granular scopes list the assets the user selected.
  try {
    const debug = asRecord(await graph('/debug_token', { input_token: accessToken, access_token: appToken }))
    const scopes = asArray(asRecord(debug?.data)?.granular_scopes)
    for (const scope of scopes) {
      const record = asRecord(scope)
      if (typeof record?.scope !== 'string' || !record.scope.startsWith('instagram')) continue
      for (const id of asArray(record.target_ids)) {
        if (typeof id === 'string' || typeof id === 'number') targetIds.add(String(id))
      }
    }
    let matched = 0
    for (const id of [...targetIds].slice(0, MAX_TARGET_LOOKUPS)) {
      try { if (await lookup(id)) matched += 1 } catch { /* A target can be a Page or a business id; it is not an Instagram account. */ }
    }
    reports.push({ strategy: 'granular_scopes', ok: true, found: matched, note: `scopes instagram: ${scopes.length}, activos elegidos: ${targetIds.size}` })
  } catch (error) {
    reports.push({ strategy: 'granular_scopes', ok: false, found: 0, note: errorNote(error) })
  }

  // 3. Facebook Login: Pages the user manages, and the Instagram account linked to each.
  try {
    const pages = asArray(asRecord(await graph('/me/accounts', {
      fields: 'id,name,instagram_business_account{id,username}',
      limit: '100',
      access_token: accessToken,
    }))?.data)
    let linked = 0
    for (const page of pages) {
      const candidate = toCandidate(asRecord(page)?.instagram_business_account)
      if (candidate) { found.set(candidate.id, candidate); linked += 1 }
    }
    reports.push({ strategy: 'me_accounts', ok: true, found: linked, note: `páginas: ${pages.length}` })
  } catch (error) {
    reports.push({ strategy: 'me_accounts', ok: false, found: 0, note: errorNote(error) })
  }

  // 4. System user tokens: Instagram accounts assigned to the token owner.
  try {
    const assigned = asArray(asRecord(await graph('/me/assigned_instagram_accounts', {
      fields: 'id,username',
      limit: '100',
      access_token: accessToken,
    }))?.data)
    let count = 0
    for (const item of assigned) {
      const candidate = toCandidate(item)
      if (candidate) { found.set(candidate.id, candidate); count += 1 }
    }
    reports.push({ strategy: 'assigned_instagram_accounts', ok: true, found: count })
  } catch (error) {
    reports.push({ strategy: 'assigned_instagram_accounts', ok: false, found: 0, note: errorNote(error) })
  }

  const candidates = [...found.values()]
  let account: AccountCandidate | undefined
  if (candidates.length === 1) {
    account = candidates[0]
  } else if (candidates.length > 1 && targetIds.size > 0) {
    // The user picked the asset in Meta's dialog: the granular scopes say which one.
    const chosen = candidates.filter((candidate) => targetIds.has(candidate.id))
    if (chosen.length === 1) account = chosen[0]
  }
  return { account, candidates, reports }
}

export function describeResolution(resolution: AccountResolution): string {
  return resolution.reports
    .map((report) => `${report.strategy}=${report.ok ? 'ok' : 'error'}(${report.found}${report.note ? `; ${report.note}` : ''})`)
    .join(' | ')
}

export function resolutionFailureMessage(resolution: AccountResolution): string {
  const detail = describeResolution(resolution)
  if (resolution.candidates.length === 0) {
    return `Meta autorizó la app, pero no devolvió ninguna cuenta de Instagram profesional. Detalle: ${detail}`
  }
  const names = resolution.candidates.map((candidate) => `@${candidate.username}`).join(', ')
  return `Meta devolvió ${resolution.candidates.length} cuentas de Instagram (${names}) y no se pudo decidir cuál usar. Detalle: ${detail}`
}
