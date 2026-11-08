import type { Winner } from '../logic/draw'
import type { RaffleConfig, View } from '../screens/App'

// Everything that would be lost on a page refresh. Transient animation state is not saved.
export const STORAGE_KEY = 'tear-sorteos:v1'

export interface SavedState {
  view: View
  config: RaffleConfig
  raw: string
  winners: Winner[]
}

const VIEWS: View[] = ['home', 'setup', 'entries']
const DUPLICATE_POLICIES = ['all', 'limit', 'one']
const REQUIREMENTS = ['follow', 'like', 'share', 'mention']

function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

// A corrupted or outdated value must never break the app: anything unexpected falls back to the defaults.
export function parseSavedState(text: string | null, defaults: RaffleConfig): SavedState | null {
  if (!text) return null
  let data: Record<string, unknown> | null
  try { data = asRecord(JSON.parse(text)) } catch { return null }
  if (!data) return null

  const saved = asRecord(data.config) ?? {}
  const config: RaffleConfig = {
    title: typeof saved.title === 'string' ? saved.title : defaults.title,
    postUrl: typeof saved.postUrl === 'string' ? saved.postUrl : defaults.postUrl,
    prizes: typeof saved.prizes === 'string' ? saved.prizes : defaults.prizes,
    winnerCount: isInteger(saved.winnerCount, 1, 20) ? saved.winnerCount : defaults.winnerCount,
    duplicates: DUPLICATE_POLICIES.includes(saved.duplicates as string) ? saved.duplicates as RaffleConfig['duplicates'] : defaults.duplicates,
    maxPerAccount: isInteger(saved.maxPerAccount, 2, 50) ? saved.maxPerAccount : defaults.maxPerAccount,
    minMentions: isInteger(saved.minMentions, 1, 5) ? saved.minMentions : defaults.minMentions,
    requirements: Array.isArray(saved.requirements)
      ? saved.requirements.filter((item): item is RaffleConfig['requirements'][number] => REQUIREMENTS.includes(item as string))
      : defaults.requirements,
  }

  const winners = Array.isArray(data.winners)
    ? data.winners.flatMap((item): Winner[] => {
      const record = asRecord(item)
      return typeof record?.username === 'string' && isInteger(record.ticketNumber, 1, Number.MAX_SAFE_INTEGER)
        ? [{ username: record.username, ticketNumber: record.ticketNumber }]
        : []
    }).slice(0, config.winnerCount)
    : []

  return {
    view: VIEWS.includes(data.view as View) ? data.view as View : 'home',
    config,
    raw: typeof data.raw === 'string' ? data.raw : '',
    winners,
  }
}
