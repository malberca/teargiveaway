export interface Participant {
  id: string
  username: string
  chances: number
}

export interface ParsedComments {
  entries: Participant[]
  tickets: string[]
  errors: string[]
  commentsCount: number
  excludedDuplicates: number
  excludedByMentions: number
}

export interface CommentRules {
  // How many valid comments each account may have: Infinity accepts all, 1 rejects repeats, N keeps the first N.
  maxPerAccount: number
  requireMentions: boolean
  minMentions: number
}

const commentPattern = /^\s*(@[\p{L}\p{N}._]+)\s*:\s*(.*)$/u
const mentionPattern = /@[\p{L}\p{N}._]+/gu

export function parseComments(input: string, rules: CommentRules = {
  maxPerAccount: Number.POSITIVE_INFINITY,
  requireMentions: false,
  minMentions: 1,
}): ParsedComments {
  const byUser = new Map<string, Participant>()
  const tickets: string[] = []
  const errors: string[] = []
  const acceptedByUser = new Map<string, number>()
  let commentsCount = 0
  let excludedDuplicates = 0
  let excludedByMentions = 0

  input.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return
    const match = line.match(commentPattern)
    if (!match) {
      errors.push(line)
      return
    }

    const username = match[1].toLocaleLowerCase()
    const body = match[2]
    const mentions = body.match(mentionPattern)?.length ?? 0
    if (rules.requireMentions && mentions < rules.minMentions) {
      excludedByMentions += 1
      return
    }
    // The first N valid comments of each account count, in the order they were imported.
    if ((acceptedByUser.get(username) ?? 0) >= rules.maxPerAccount) {
      excludedDuplicates += 1
      return
    }
    const chances = 1 + mentions
    const participant = byUser.get(username) ?? { id: username, username, chances: 0 }
    participant.chances += chances
    byUser.set(username, participant)
    acceptedByUser.set(username, (acceptedByUser.get(username) ?? 0) + 1)
    commentsCount += 1
    for (let chance = 0; chance < chances; chance += 1) tickets.push(username)
  })

  return { entries: [...byUser.values()], tickets, errors, commentsCount, excludedDuplicates, excludedByMentions }
}
