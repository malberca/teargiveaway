import type { Winner } from '../logic/draw'
import type { RaffleConfig } from '../screens/App'
import type { ParsedComments } from './comments'

// Finished raffles ("Mis sorteos"). Only a summary is kept, never the imported comments: a 7,000-comment import
// would exhaust the browser's storage after a few raffles. The comments are covered by a SHA-256 fingerprint so a
// raffle can be audited later against the original list.
export const HISTORY_KEY = 'tear-sorteos:history:v1'
export const MAX_HISTORY = 200

export interface FinishedWinner {
  position: number
  username: string
  ticketNumber: number
  prize: string | null
}

export interface FinishedRaffle {
  id: string
  finishedAt: string
  title: string
  postUrl: string
  prizesRequested: number
  rules: {
    duplicates: RaffleConfig['duplicates']
    maxPerAccount: number
    minMentions: number
    requirements: RaffleConfig['requirements']
  }
  stats: {
    comments: number
    tickets: number
    uniqueAccounts: number
    excludedDuplicates: number
    excludedByMentions: number
  }
  winners: FinishedWinner[]
  fingerprint: string
}

export function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// Returns '' when the browser cannot hash (insecure context): the raffle is still saved, just without a fingerprint.
export async function sha256Hex(text: string): Promise<string> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    return ''
  }
}

export interface BuildInput {
  id: string
  now: Date
  config: RaffleConfig
  parsed: Pick<ParsedComments, 'commentsCount' | 'tickets' | 'entries' | 'excludedDuplicates' | 'excludedByMentions'>
  winners: Winner[]
  prizes: string[]
  fingerprint: string
}

export function buildFinishedRaffle(input: BuildInput): FinishedRaffle {
  const { config, parsed } = input
  return {
    id: input.id,
    finishedAt: input.now.toISOString(),
    title: config.title.trim(),
    postUrl: config.postUrl.trim(),
    prizesRequested: config.winnerCount,
    rules: {
      duplicates: config.duplicates,
      maxPerAccount: config.maxPerAccount,
      minMentions: config.minMentions,
      requirements: [...config.requirements],
    },
    stats: {
      comments: parsed.commentsCount,
      tickets: parsed.tickets.length,
      uniqueAccounts: parsed.entries.length,
      excludedDuplicates: parsed.excludedDuplicates,
      excludedByMentions: parsed.excludedByMentions,
    },
    winners: input.winners.map((winner, index) => ({
      position: index + 1,
      username: winner.username,
      ticketNumber: winner.ticketNumber,
      prize: input.prizes[index] ?? null,
    })),
    fingerprint: input.fingerprint,
  }
}

// Newest first, and never more than MAX_HISTORY.
export function addRaffle(history: FinishedRaffle[], raffle: FinishedRaffle): FinishedRaffle[] {
  return [raffle, ...history.filter((item) => item.id !== raffle.id)].slice(0, MAX_HISTORY)
}

export function removeRaffle(history: FinishedRaffle[], id: string): FinishedRaffle[] {
  return history.filter((item) => item.id !== id)
}

export function formatWinnersText(raffle: Pick<FinishedRaffle, 'winners'>): string {
  return raffle.winners.map((winner) => `Premio ${winner.position}: ${winner.username}${winner.prize ? ` — ${winner.prize}` : ''}`).join('\n')
}

const DUPLICATES = ['all', 'limit', 'one']
const REQUIREMENTS = ['follow', 'like', 'share', 'mention']

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function parseWinner(value: unknown): FinishedWinner | null {
  const record = asRecord(value)
  if (!record || typeof record.username !== 'string' || !isInteger(record.position, 1, 20) || !isInteger(record.ticketNumber, 1, Number.MAX_SAFE_INTEGER)) return null
  return { position: record.position, username: record.username, ticketNumber: record.ticketNumber, prize: typeof record.prize === 'string' ? record.prize : null }
}

function parseRaffle(value: unknown): FinishedRaffle | null {
  const record = asRecord(value)
  const rules = asRecord(record?.rules)
  const stats = asRecord(record?.stats)
  if (!record || !rules || !stats) return null
  if (typeof record.id !== 'string' || !record.id) return null
  if (typeof record.finishedAt !== 'string' || Number.isNaN(Date.parse(record.finishedAt))) return null
  if (!isInteger(record.prizesRequested, 1, 20)) return null
  if (!DUPLICATES.includes(rules.duplicates as string) || !isInteger(rules.maxPerAccount, 1, 1000) || !isInteger(rules.minMentions, 1, 5)) return null
  const numbers = ['comments', 'tickets', 'uniqueAccounts', 'excludedDuplicates', 'excludedByMentions'] as const
  if (!numbers.every((key) => isInteger(stats[key], 0, Number.MAX_SAFE_INTEGER))) return null
  const winners = Array.isArray(record.winners) ? record.winners.map(parseWinner).filter((winner): winner is FinishedWinner => winner !== null) : []
  return {
    id: record.id,
    finishedAt: record.finishedAt,
    title: typeof record.title === 'string' ? record.title : '',
    postUrl: typeof record.postUrl === 'string' ? record.postUrl : '',
    prizesRequested: record.prizesRequested,
    rules: {
      duplicates: rules.duplicates as FinishedRaffle['rules']['duplicates'],
      maxPerAccount: rules.maxPerAccount,
      minMentions: rules.minMentions,
      requirements: Array.isArray(rules.requirements)
        ? rules.requirements.filter((item): item is FinishedRaffle['rules']['requirements'][number] => REQUIREMENTS.includes(item as string))
        : [],
    },
    stats: {
      comments: stats.comments as number,
      tickets: stats.tickets as number,
      uniqueAccounts: stats.uniqueAccounts as number,
      excludedDuplicates: stats.excludedDuplicates as number,
      excludedByMentions: stats.excludedByMentions as number,
    },
    winners: winners.slice(0, record.prizesRequested),
    fingerprint: typeof record.fingerprint === 'string' ? record.fingerprint : '',
  }
}

// A corrupted or outdated value never breaks the app: invalid raffles are dropped and the rest are kept.
export function parseHistory(text: string | null): FinishedRaffle[] {
  if (!text) return []
  let data: unknown
  try { data = JSON.parse(text) } catch { return [] }
  if (!Array.isArray(data)) return []
  return data.map(parseRaffle).filter((raffle): raffle is FinishedRaffle => raffle !== null).slice(0, MAX_HISTORY)
}
